using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Hydra.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Hydra.Api.Tests;

public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("HYDRA_TEST_POSTGRES")))
            Skip = "Set HYDRA_TEST_POSTGRES to a disposable PostgreSQL connection string.";
    }
}
public sealed class PostgresTests
{
    [PostgresFact]
    public async Task DurableLeasesIdempotencyAndPublicationHoldAcrossReplicas()
    {
        var schema = "hydra_test_" + Guid.NewGuid().ToString("N");
        var baseConnection = Environment.GetEnvironmentVariable("HYDRA_TEST_POSTGRES")!;
        await using var administration = NpgsqlDataSource.Create(baseConnection);
        await using (var create = administration.CreateCommand($"CREATE SCHEMA {schema}")) await create.ExecuteNonQueryAsync();
        var builder = new NpgsqlConnectionStringBuilder(baseConnection) { SearchPath = schema };
        await using var source = NpgsqlDataSource.Create(builder.ConnectionString);
        try
        {
            var first = new HydraStore(source);
            var second = new HydraStore(source);
            await first.Initialize(default);
            var victim = new Target("chaos-demo", "victim-a", Guid.NewGuid().ToString(), true);
            var survivor = new Target("chaos-demo", "victim-b", Guid.NewGuid().ToString(), true);
            await first.Heartbeat(new([victim, survivor], 2, 2), default);
            var request = new StartExperiment(victim.Namespace, victim.Name, victim.Uid, false);
            var starts = await Task.WhenAll(first.Start(request, "operator", "same-key-001", default), second.Start(request, "operator", "same-key-001", default));
            Assert.Equal(starts[0].Id, starts[1].Id);
            Assert.Single(await first.Experiments(default));
            await Assert.ThrowsAsync<ApiFault>(() => first.Start(request with { DryRun = true }, "operator", "same-key-001", default));
            await Assert.ThrowsAsync<ApiFault>(() => second.Start(request with { PodName = survivor.Name, PodUid = survivor.Uid }, "operator", "another-key", default));
            var claims = await Task.WhenAll(first.Claim("agent-a", default), second.Claim("agent-b", default));
            var lease = Assert.Single(claims, x => x is not null)!;
            Assert.Equal(victim.Uid, lease.Target.Uid);
            await Assert.ThrowsAsync<ApiFault>(() => first.Report(lease.Id, new("invalid", "deleted", "bad lease"), default));
            await using (var expire = source.CreateCommand("UPDATE hydra_experiments SET lease_expires=now()-interval '1 second' WHERE id=@id"))
            {
                expire.Parameters.AddWithValue("id", lease.Id);
                await expire.ExecuteNonQueryAsync();
            }
            await Assert.ThrowsAsync<ApiFault>(() => second.Start(request with { PodName = survivor.Name, PodUid = survivor.Uid }, "operator", "expired-slot", default));
            var recoveredLease = await second.Claim("agent-restarted", default);
            Assert.NotNull(recoveredLease);
            Assert.Equal(lease.Id, recoveredLease.Id);
            Assert.Equal(victim.Uid, recoveredLease.Target.Uid);
            Assert.NotEqual(lease.LeaseToken, recoveredLease.LeaseToken);
            await Assert.ThrowsAsync<ApiFault>(() => first.Report(lease.Id, new(lease.LeaseToken, "deleted", "stale lease"), default));
            await second.Report(lease.Id, new(recoveredLease.LeaseToken, "deleted", "UID disappeared"), default);
            await Assert.ThrowsAsync<ApiFault>(() => first.Report(lease.Id, new(recoveredLease.LeaseToken, "recovered", "invented recovery", 1), default));
            var replacement = victim with { Name = "victim-c", Uid = Guid.NewGuid().ToString() };
            await first.Heartbeat(new([survivor, replacement], 2, 2), default);
            var completed = await second.Report(lease.Id, new(recoveredLease.LeaseToken, "recovered", "Measured recovery", 123), default);
            Assert.Equal(123, completed.RecoveryMs);
            var repeated = await first.Report(lease.Id, new(recoveredLease.LeaseToken, "recovered", "retry", 999), default);
            Assert.Equal(123, repeated.RecoveryMs);
            var page = await first.Events(0, 2, default);
            Assert.Equal(2, page.Items.Length);
            Assert.Equal(page.Items[^1].Sequence, page.LastSequence);
            var next = await second.Events(page.LastSequence, 200, default);
            Assert.All(next.Items, x => Assert.True(x.Sequence > page.LastSequence));
            var events = page.Items.Concat(next.Items).ToArray();
            Assert.Equal(events.Select(x => x.Sequence).Order(), events.Select(x => x.Sequence));
            await using (var outbox = source.CreateCommand("SELECT count(*) FROM hydra_outbox WHERE published_sequence IS NULL"))
                Assert.Equal(0L, (long)(await outbox.ExecuteScalarAsync())!);

            // Failed work holds its destructive slot until a later healthy observation.
            var failed = await first.Start(new(survivor.Namespace, survivor.Name, survivor.Uid, false), "operator", "failed-slot-001", default);
            var failedLease = await second.Claim("agent-a", default);
            await first.Report(failed.Id, new(failedLease!.LeaseToken, "failed", "Outcome uncertain"), default);
            await Assert.ThrowsAsync<ApiFault>(() => second.Start(new(replacement.Namespace, replacement.Name, replacement.Uid, false), "operator", "failed-slot-002", default));
            await second.Heartbeat(new([survivor, replacement], 2, 2), default);
            var dry = await first.Start(new(replacement.Namespace, replacement.Name, replacement.Uid, true), "operator", "dry-run-001", default);
            var dryLease = await second.Claim("agent-a", default);
            Assert.Equal(dry.Id, dryLease!.Id);
            await second.Report(dry.Id, new(dryLease.LeaseToken, "recovered", "Simulation completed; no pod deleted"), default);
            await CheckHttpSecurity(builder.ConnectionString);
        }
        finally
        {
            await source.DisposeAsync();
            await using var drop = administration.CreateCommand($"DROP SCHEMA {schema} CASCADE");
            await drop.ExecuteNonQueryAsync();
        }
    }
    private static async Task CheckHttpSecurity(string connectionString)
    {
        var settings = SafetyTests.LocalSettings;
        // Program validates configuration before Build. Set process settings before its entry point starts.
        var values = new Dictionary<string, string>
        {
            ["Hydra__AuthMode"] = "local", ["Hydra__AllowLocalAuth"] = "true",
            ["Hydra__AgentToken"] = settings.AgentToken, ["Hydra__DataProtectionKey"] = settings.DataProtectionKey,
            ["ConnectionStrings__Hydra"] = connectionString
        };
        var previous = values.Keys.ToDictionary(k => k, Environment.GetEnvironmentVariable);
        foreach (var value in values) Environment.SetEnvironmentVariable(value.Key, value.Value);
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host => host.UseEnvironment("Development"));
            using var client = factory.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
            var session = await client.GetFromJsonAsync<JsonElement>("/api/session");
            Assert.True(session.GetProperty("operator").GetBoolean());
            var unauthorizedAgent = await client.PostAsJsonAsync("/internal/jobs/claim", new { agentId = "pretender" });
            Assert.Equal(HttpStatusCode.Unauthorized, unauthorizedAgent.StatusCode);
            var noCsrf = await client.PostAsJsonAsync("/api/experiments", new { @namespace = "chaos-demo", podName = "victim", podUid = Guid.NewGuid(), dryRun = true });
            Assert.Equal(HttpStatusCode.BadRequest, noCsrf.StatusCode);
            var missingDryRun = await client.PostAsJsonAsync("/api/experiments", new { @namespace = "chaos-demo", podName = "victim", podUid = Guid.NewGuid() });
            Assert.Equal(HttpStatusCode.BadRequest, missingDryRun.StatusCode);
            using var authorized = new HttpRequestMessage(HttpMethod.Post, "/internal/jobs/claim");
            authorized.Headers.Authorization = new("Bearer", settings.AgentToken);
            authorized.Content = JsonContent.Create(new { agentId = "legitimate-agent" });
            Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(authorized)).StatusCode);

            var csrfToken = session.GetProperty("csrfToken").GetString()!;
            var observed = await client.GetFromJsonAsync<TargetSnapshot>("/api/targets");
            var chosen = observed!.Items[0];
            async Task<Experiment> SubmitHttp()
            {
                using var submit = new HttpRequestMessage(HttpMethod.Post, "/api/experiments");
                submit.Headers.Add("X-CSRF-Token", csrfToken);
                submit.Headers.Add("Idempotency-Key", "http-dry-run-001");
                submit.Content = JsonContent.Create(new StartExperiment(chosen.Namespace, chosen.Name, chosen.Uid, true));
                using var response = await client.SendAsync(submit);
                Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
                return (await response.Content.ReadFromJsonAsync<Experiment>())!;
            }
            var submitted = await SubmitHttp();
            Assert.Equal(submitted.Id, (await SubmitHttp()).Id);
            using var claimHttp = new HttpRequestMessage(HttpMethod.Post, "/internal/jobs/claim");
            claimHttp.Headers.Authorization = new("Bearer", settings.AgentToken);
            claimHttp.Content = JsonContent.Create(new { agentId = "http-agent" });
            using var claimed = await client.SendAsync(claimHttp);
            var job = await claimed.Content.ReadFromJsonAsync<Job>();
            Assert.Equal(submitted.Id, job!.Id);
            using var reportHttp = new HttpRequestMessage(HttpMethod.Post, $"/internal/jobs/{job.Id}/report");
            reportHttp.Headers.Authorization = new("Bearer", settings.AgentToken);
            reportHttp.Content = JsonContent.Create(new ReportRequest(job.LeaseToken, "recovered", "HTTP dry-run completed"));
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(reportHttp)).StatusCode);

            using var replica = new WebApplicationFactory<Program>().WithWebHostBuilder(host => host.UseEnvironment("Development"));
            using var replicaClient = replica.CreateClient();
            var protectedValue = factory.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("Hydra.Tests").Protect("replica-session");
            Assert.Equal("replica-session", replica.Services.GetRequiredService<IDataProtectionProvider>().CreateProtector("Hydra.Tests").Unprotect(protectedValue));
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            using var socketA = await factory.Server.CreateWebSocketClient().ConnectAsync(new Uri("http://localhost/hubs/telemetry"), timeout.Token);
            using var socketB = await replica.Server.CreateWebSocketClient().ConnectAsync(new Uri("http://localhost/hubs/telemetry"), timeout.Token);
            await Handshake(socketA, timeout.Token);
            await Handshake(socketB, timeout.Token);
            var store = factory.Services.GetRequiredService<HydraStore>();
            var targets = await store.Snapshot(timeout.Token);
            var target = targets.Items[0];
            var broadcast = await store.Start(new(target.Namespace, target.Name, target.Uid, true), "operator", "fanout-replicas", timeout.Token);
            await Task.WhenAll(ReceiveEvent(socketA, broadcast.Id, timeout.Token), ReceiveEvent(socketB, broadcast.Id, timeout.Token));
            await CheckGitHubWiring();
        }
        finally { foreach (var value in previous) Environment.SetEnvironmentVariable(value.Key, value.Value); }
    }
    private static async Task CheckGitHubWiring()
    {
        // Dummy credentials test redirects and policy without calling GitHub or pretending to test login.
        var values = new Dictionary<string, string>
        {
            ["Hydra__AuthMode"] = "github", ["Hydra__GitHubClientId"] = "test-client",
            ["Hydra__GitHubClientSecret"] = "test-secret", ["Hydra__PublicOrigin"] = "https://hydra.example.com"
        };
        var previous = values.Keys.ToDictionary(k => k, Environment.GetEnvironmentVariable);
        foreach (var value in values) Environment.SetEnvironmentVariable(value.Key, value.Value);
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(host => host.UseEnvironment("Production"));
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://hydra.example.com"), AllowAutoRedirect = false });
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/targets")).StatusCode);
            using var login = await client.GetAsync("/auth/github");
            Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
            Assert.Equal("github.com", login.Headers.Location!.Host);
            Assert.Equal("https://hydra.example.com/auth/github/callback", QueryHelpers.ParseQuery(login.Headers.Location.Query)["redirect_uri"].ToString());
            Assert.Contains("code_challenge=", login.Headers.Location.Query);
            Assert.All(login.Headers.GetValues("Set-Cookie"), cookie => Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase));
            using var foreignOrigin = new HttpRequestMessage(HttpMethod.Get, "/hubs/telemetry");
            foreignOrigin.Headers.Add("Origin", "https://foreign.example.com");
            foreignOrigin.Headers.Add("Upgrade", "websocket");
            foreignOrigin.Headers.Connection.Add("Upgrade");
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(foreignOrigin)).StatusCode);
        }
        finally { foreach (var value in previous) Environment.SetEnvironmentVariable(value.Key, value.Value); }
    }
    private static async Task Handshake(WebSocket socket, CancellationToken ct)
    {
        await socket.SendAsync(Encoding.UTF8.GetBytes("{\"protocol\":\"json\",\"version\":1}\u001e"), WebSocketMessageType.Text, true, ct);
        var response = await ReceiveText(socket, ct);
        Assert.StartsWith("{}\u001e", response);
    }
    private static async Task ReceiveEvent(WebSocket socket, Guid id, CancellationToken ct)
    {
        while (true)
        {
            var text = await ReceiveText(socket, ct);
            if (text.Contains(id.ToString(), StringComparison.Ordinal))
            {
                Assert.Contains("\"target\":\"Event\"", text);
                return;
            }
        }
    }
    private static async Task<string> ReceiveText(WebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[65536];
        var length = 0;
        WebSocketReceiveResult message;
        do
        {
            message = await socket.ReceiveAsync(new ArraySegment<byte>(buffer, length, buffer.Length - length), ct);
            Assert.NotEqual(WebSocketMessageType.Close, message.MessageType);
            length += message.Count;
        } while (!message.EndOfMessage);
        return Encoding.UTF8.GetString(buffer, 0, length);
    }
}
