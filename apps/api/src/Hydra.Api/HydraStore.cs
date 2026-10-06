using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;

namespace Hydra.Api;

public sealed class HydraStore(NpgsqlDataSource source)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const long MutationLock = 48219301;
    public async Task Initialize(CancellationToken ct)
    {
        await using var connection = await source.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        await Lock(connection, tx, ct);
        await Execute(connection, tx, """
            CREATE TABLE IF NOT EXISTS hydra_experiments (
              id uuid PRIMARY KEY, owner_id text NOT NULL, idempotency_key text NOT NULL,
              fingerprint text NOT NULL, dry_run boolean NOT NULL, status text NOT NULL,
              slot_active boolean NOT NULL, created_at timestamptz NOT NULL, document jsonb NOT NULL,
              lease_token_hash text, lease_expires timestamptz, leased_agent text,
              UNIQUE(owner_id,idempotency_key));
            CREATE UNIQUE INDEX IF NOT EXISTS hydra_one_destructive_slot
              ON hydra_experiments ((true)) WHERE slot_active;
            CREATE TABLE IF NOT EXISTS hydra_snapshot (
              id boolean PRIMARY KEY DEFAULT true CHECK (id), document jsonb NOT NULL);
            CREATE TABLE IF NOT EXISTS hydra_counter (
              id boolean PRIMARY KEY DEFAULT true CHECK (id), sequence bigint NOT NULL);
            INSERT INTO hydra_counter VALUES (true,0) ON CONFLICT DO NOTHING;
            CREATE TABLE IF NOT EXISTS hydra_outbox (
              id uuid PRIMARY KEY, type text NOT NULL, experiment_id uuid,
              at timestamptz NOT NULL, data jsonb NOT NULL, published_sequence bigint);
            CREATE TABLE IF NOT EXISTS hydra_events (
              sequence bigint PRIMARY KEY, type text NOT NULL, experiment_id uuid,
              at timestamptz NOT NULL, data jsonb NOT NULL);
            CREATE TABLE IF NOT EXISTS hydra_data_protection (
              id bigserial PRIMARY KEY, friendly_name text NOT NULL, xml text NOT NULL);
            """, ct);
        await tx.CommitAsync(ct);
    }
    public async Task<bool> Ready(CancellationToken ct)
    {
        await using var command = source.CreateCommand("SELECT EXISTS (SELECT 1 FROM hydra_counter)");
        return (bool)(await command.ExecuteScalarAsync(ct) ?? false);
    }
    public async Task<TargetSnapshot> Snapshot(CancellationToken ct)
    {
        await using var connection = await source.OpenConnectionAsync(ct);
        return await ReadSnapshot(connection, null, ct);
    }
    public async Task<long> LatestSequence(CancellationToken ct)
    {
        await using var command = source.CreateCommand("SELECT sequence FROM hydra_counter WHERE id");
        return (long)(await command.ExecuteScalarAsync(ct))!;
    }
    private static async Task<TargetSnapshot> ReadSnapshot(NpgsqlConnection connection, NpgsqlTransaction? tx, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("SELECT document::text FROM hydra_snapshot WHERE id", connection, tx);
        var json = await command.ExecuteScalarAsync(ct) as string;
        return json is null ? new(HydraSettings.ChaosNamespace, [], 0, 0, null) : JsonSerializer.Deserialize<TargetSnapshot>(json, Json)!;
    }
    public async Task<Experiment> Start(StartExperiment request, string owner, string key, CancellationToken ct)
    {
        Safety.ValidateTarget(new(request.Namespace, request.PodName, request.PodUid));
        Safety.ValidateIdempotencyKey(key);
        var fingerprint = Safety.RequestFingerprint(request);
        await using var connection = await source.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        await Lock(connection, tx, ct);
        await using (var existing = new NpgsqlCommand("SELECT fingerprint,document::text FROM hydra_experiments WHERE owner_id=@owner AND idempotency_key=@key", connection, tx))
        {
            existing.Parameters.AddWithValue("owner", owner);
            existing.Parameters.AddWithValue("key", key);
            await using var reader = await existing.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                if (reader.GetString(0) != fingerprint) throw new ApiFault(409, "Idempotency key was already used for another request.");
                return JsonSerializer.Deserialize<Experiment>(reader.GetString(1), Json)!;
            }
        }
        await Prune(connection, tx, ct);
        await using (var count = new NpgsqlCommand("SELECT count(*) FROM hydra_experiments", connection, tx))
            if ((long)(await count.ExecuteScalarAsync(ct))! >= 5000) throw new ApiFault(503, "Audit capacity reached; new experiments are paused.");
        var snapshot = await ReadSnapshot(connection, tx, ct);
        if (!Safety.Healthy(snapshot, DateTimeOffset.UtcNow)) throw new ApiFault(409, "A fresh, fully Ready laboratory with at least two pods is required.");
        if (!snapshot.Items.Any(p => p.Namespace == request.Namespace && p.Name == request.PodName && p.Uid == request.PodUid && p.Ready))
            throw new ApiFault(409, "The chosen pod UID is no longer a Ready target.");
        if (!request.DryRun)
        {
            await using var slot = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM hydra_experiments WHERE slot_active)", connection, tx);
            if ((bool)(await slot.ExecuteScalarAsync(ct))!) throw new ApiFault(409, "A destructive experiment is still active or requires reconciliation.");
        }
        var experiment = new Experiment(Guid.NewGuid(), "queued", request.DryRun,
            new(request.Namespace, request.PodName, request.PodUid), DateTimeOffset.UtcNow);
        await using (var insert = new NpgsqlCommand("""
            INSERT INTO hydra_experiments (id,owner_id,idempotency_key,fingerprint,dry_run,status,slot_active,created_at,document)
            VALUES (@id,@owner,@key,@fingerprint,@dry,'queued',@slot,@at,@doc::jsonb)
            """, connection, tx))
        {
            insert.Parameters.AddWithValue("id", experiment.Id);
            insert.Parameters.AddWithValue("owner", owner);
            insert.Parameters.AddWithValue("key", key);
            insert.Parameters.AddWithValue("fingerprint", fingerprint);
            insert.Parameters.AddWithValue("dry", request.DryRun);
            insert.Parameters.AddWithValue("slot", !request.DryRun);
            insert.Parameters.AddWithValue("at", experiment.CreatedAt);
            insert.Parameters.AddWithValue("doc", JsonSerializer.Serialize(experiment, Json));
            await insert.ExecuteNonQueryAsync(ct);
        }
        await AppendEvent(connection, tx, "experiment.queued", experiment.Id, experiment, ct);
        await tx.CommitAsync(ct);
        return experiment;
    }
    public async Task<Experiment[]> Experiments(CancellationToken ct)
    {
        await using var command = source.CreateCommand("SELECT document::text FROM hydra_experiments ORDER BY created_at DESC LIMIT 100");
        await using var reader = await command.ExecuteReaderAsync(ct);
        var items = new List<Experiment>();
        while (await reader.ReadAsync(ct)) items.Add(JsonSerializer.Deserialize<Experiment>(reader.GetString(0), Json)!);
        return [.. items];
    }
    public async Task Heartbeat(AgentHeartbeat heartbeat, CancellationToken ct)
    {
        Safety.ValidateSnapshot(heartbeat);
        var snapshot = new TargetSnapshot(HydraSettings.ChaosNamespace, heartbeat.Targets.OrderBy(x => x.Name, StringComparer.Ordinal).ToArray(),
            heartbeat.Ready, heartbeat.Total, DateTimeOffset.UtcNow);
        await using var connection = await source.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        await Lock(connection, tx, ct);
        var old = await ReadSnapshot(connection, tx, ct);
        await using (var command = new NpgsqlCommand("INSERT INTO hydra_snapshot VALUES (true,@doc::jsonb) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document", connection, tx))
        {
            command.Parameters.AddWithValue("doc", JsonSerializer.Serialize(snapshot, Json));
            await command.ExecuteNonQueryAsync(ct);
        }
        if (!old.Items.SequenceEqual(snapshot.Items)) await AppendEvent(connection, tx, "targets.updated", null, snapshot, ct);
        // A failed job retains its slot until a later healthy Kubernetes observation reconciles it.
        if (Safety.Healthy(snapshot, DateTimeOffset.UtcNow))
        {
            await using var command = new NpgsqlCommand("""
                UPDATE hydra_experiments SET slot_active=false
                WHERE slot_active AND status='failed' AND (document->>'completedAt')::timestamptz < @at
                RETURNING id
                """, connection, tx);
            command.Parameters.AddWithValue("at", snapshot.UpdatedAt!.Value);
            var reconciled = new List<Guid>();
            await using (var reader = await command.ExecuteReaderAsync(ct))
                while (await reader.ReadAsync(ct)) reconciled.Add(reader.GetGuid(0));
            foreach (var id in reconciled) await AppendEvent(connection, tx, "experiment.reconciled", id, new { id, message = "A fresh healthy laboratory observation released the destructive slot." }, ct);
        }
        await Prune(connection, tx, ct);
        await tx.CommitAsync(ct);
    }
    public async Task<Job?> Claim(string agentId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(agentId) || agentId.Length > 128) throw new ApiFault(400, "A bounded agentId is required.");
        await using var connection = await source.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        await Lock(connection, tx, ct);
        Experiment? experiment = null;
        await using (var command = new NpgsqlCommand("""
            SELECT document::text FROM hydra_experiments
            WHERE status IN ('queued','running','deleted') AND (lease_expires IS NULL OR lease_expires < now())
            ORDER BY slot_active DESC,created_at LIMIT 1 FOR UPDATE
            """, connection, tx))
        {
            var document = await command.ExecuteScalarAsync(ct) as string;
            if (document is not null) experiment = JsonSerializer.Deserialize<Experiment>(document, Json);
        }
        if (experiment is null) return null;
        var leaseToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        experiment = experiment with { Status = experiment.Status == "deleted" ? "deleted" : "running", StartedAt = experiment.StartedAt ?? DateTimeOffset.UtcNow };
        await using (var command = new NpgsqlCommand("""
            UPDATE hydra_experiments SET lease_token_hash=@hash,lease_expires=now()+interval '180 seconds',leased_agent=@agent,
            status=@status,document=@doc::jsonb WHERE id=@id
            """, connection, tx))
        {
            command.Parameters.AddWithValue("hash", TokenHash(leaseToken));
            command.Parameters.AddWithValue("agent", agentId);
            command.Parameters.AddWithValue("status", experiment.Status);
            command.Parameters.AddWithValue("doc", JsonSerializer.Serialize(experiment, Json));
            command.Parameters.AddWithValue("id", experiment.Id);
            await command.ExecuteNonQueryAsync(ct);
        }
        await AppendEvent(connection, tx, "experiment.claimed", experiment.Id, experiment, ct);
        await tx.CommitAsync(ct);
        return new(experiment.Id, leaseToken, experiment.Target, experiment.DryRun);
    }
    public async Task<Experiment> Report(Guid id, ReportRequest report, CancellationToken ct)
    {
        if (report.LeaseToken is null || report.LeaseToken.Length > 128 || report.Message?.Length > 1024 || report.TweetDraft?.Length > 1000
            || report.RecoveryMs is < 0 or > 86400000) throw new ApiFault(400, "Invalid or oversized job report.");
        await using var connection = await source.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        await Lock(connection, tx, ct);
        Experiment experiment;
        DateTimeOffset expires;
        await using (var command = new NpgsqlCommand("SELECT document::text,lease_token_hash,lease_expires FROM hydra_experiments WHERE id=@id FOR UPDATE", connection, tx))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) throw new ApiFault(404, "Experiment not found.");
            if (reader.IsDBNull(1) || !Safety.SafeEquals(TokenHash(report.LeaseToken), reader.GetString(1))) throw new ApiFault(409, "Invalid job lease.");
            experiment = JsonSerializer.Deserialize<Experiment>(reader.GetString(0), Json)!;
            expires = reader.GetFieldValue<DateTimeOffset>(2);
        }
        var next = Safety.NextStatus(experiment.Status, experiment.DryRun, report.Status);
        if (experiment.Status is "recovered" or "failed") return experiment;
        if (expires <= DateTimeOffset.UtcNow) throw new ApiFault(409, "Lease expired; reclaim the original job before reporting.");
        var terminal = next is "recovered" or "failed";
        if (next == "recovered" && !experiment.DryRun)
        {
            var snapshot = await ReadSnapshot(connection, tx, ct);
            if (!Safety.Healthy(snapshot, DateTimeOffset.UtcNow) || snapshot.Items.Any(p => p.Uid == experiment.Target.Uid))
                throw new ApiFault(409, "Recovery requires a fresh Ready snapshot without the deleted UID.");
        }
        var changed = next != experiment.Status;
        experiment = experiment with { Status = next, CompletedAt = terminal ? DateTimeOffset.UtcNow : null,
            RecoveryMs = next == "recovered" ? report.RecoveryMs : experiment.RecoveryMs,
            Message = report.Message ?? experiment.Message, TweetDraft = report.TweetDraft ?? experiment.TweetDraft };
        await using (var command = new NpgsqlCommand("""
            UPDATE hydra_experiments SET status=@status,document=@doc::jsonb,
            lease_expires=now()+interval '180 seconds',slot_active=CASE WHEN @release THEN false ELSE slot_active END WHERE id=@id
            """, connection, tx))
        {
            command.Parameters.AddWithValue("status", next);
            command.Parameters.AddWithValue("doc", JsonSerializer.Serialize(experiment, Json));
            command.Parameters.AddWithValue("release", next == "recovered");
            command.Parameters.AddWithValue("id", id);
            await command.ExecuteNonQueryAsync(ct);
        }
        if (changed) await AppendEvent(connection, tx, $"experiment.{next}", id, experiment, ct);
        await tx.CommitAsync(ct);
        return experiment;
    }
    public async Task<EventPage> Events(long after, int limit, CancellationToken ct)
    {
        if (after < 0) throw new ApiFault(400, "Cursor must be non-negative.");
        limit = Math.Clamp(limit, 1, 200);
        await using var connection = await source.OpenConnectionAsync(ct);
        // A consistent snapshot avoids a retention race between checking the floor and reading events.
        await using var tx = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
        long current;
        long? floor;
        await using (var command = new NpgsqlCommand("SELECT sequence,(SELECT min(sequence) FROM hydra_events) FROM hydra_counter WHERE id", connection, tx))
        {
            await using var reader = await command.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            current = reader.GetInt64(0);
            floor = reader.IsDBNull(1) ? null : reader.GetInt64(1);
        }
        var reset = after > current || (after > 0 && after < (floor ?? current + 1) - 1);
        var items = new List<TelemetryEvent>();
        if (!reset)
        {
            await using var command = new NpgsqlCommand("SELECT sequence,type,experiment_id,at,data::text FROM hydra_events WHERE sequence>@after ORDER BY sequence LIMIT @limit", connection, tx);
            command.Parameters.AddWithValue("after", after);
            command.Parameters.AddWithValue("limit", limit);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                using var data = JsonDocument.Parse(reader.GetString(4));
                items.Add(new(reader.GetInt64(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetGuid(2),
                    reader.GetFieldValue<DateTimeOffset>(3), data.RootElement.Clone()));
            }
        }
        await tx.CommitAsync(ct);
        // Return the last delivered cursor, never a watermark that skips an undisplayed page.
        return new([.. items], reset ? current : items.Count > 0 ? items[^1].Sequence : after, reset);
    }
    private static async Task AppendEvent(NpgsqlConnection connection, NpgsqlTransaction tx, string type, Guid? experimentId, object data, CancellationToken ct)
    {
        // MutationLock is held by the caller until commit: sequence order is also commit order.
        await using var command = new NpgsqlCommand("""
            INSERT INTO hydra_outbox(id,type,experiment_id,at,data)
              VALUES (@id,@type,@experiment,now(),@data::jsonb);
            UPDATE hydra_counter SET sequence=sequence+1 WHERE id;
            INSERT INTO hydra_events(sequence,type,experiment_id,at,data)
              SELECT cursor.sequence,event.type,event.experiment_id,event.at,event.data
              FROM hydra_counter cursor,hydra_outbox event WHERE cursor.id AND event.id=@id;
            UPDATE hydra_outbox SET published_sequence=(SELECT sequence FROM hydra_counter WHERE id) WHERE id=@id;
            """, connection, tx);
        command.Parameters.AddWithValue("id", Guid.NewGuid());
        command.Parameters.AddWithValue("type", type);
        command.Parameters.AddWithValue("experiment", (object?)experimentId ?? DBNull.Value);
        command.Parameters["experiment"].NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
        command.Parameters.AddWithValue("data", JsonSerializer.Serialize(data, Json));
        await command.ExecuteNonQueryAsync(ct);
    }
    private static async Task Prune(NpgsqlConnection connection, NpgsqlTransaction tx, CancellationToken ct) =>
        await Execute(connection, tx, """
            DELETE FROM hydra_events WHERE at < now()-interval '1 hour'
              OR sequence <= (SELECT greatest(sequence-20000,0) FROM hydra_counter WHERE id);
            DELETE FROM hydra_outbox WHERE published_sequence IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM hydra_events WHERE sequence=published_sequence);
            DELETE FROM hydra_experiments WHERE NOT slot_active AND status IN ('recovered','failed') AND created_at < now()-interval '7 days';
            """, ct);
    private static async Task Lock(NpgsqlConnection connection, NpgsqlTransaction tx, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(@key)", connection, tx);
        command.Parameters.AddWithValue("key", MutationLock);
        await command.ExecuteNonQueryAsync(ct);
    }
    private static async Task Execute(NpgsqlConnection connection, NpgsqlTransaction tx, string sql, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand(sql, connection, tx);
        await command.ExecuteNonQueryAsync(ct);
    }
    private static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
