using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Hydra.Api;

public static partial class Safety
{
    [GeneratedRegex("^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$", RegexOptions.CultureInvariant)]
    private static partial Regex NamePattern();
    public static bool SafeEquals(string? received, string expected)
    {
        // Hashing normalizes the length before comparison; input length is bounded by HTTP limits.
        var actualHash = SHA256.HashData(Encoding.UTF8.GetBytes(received ?? ""));
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }
    public static void ValidateTarget(TargetRef target)
    {
        if (target.Namespace != HydraSettings.ChaosNamespace) throw new ApiFault(400, "Only chaos-demo is authorized.");
        if (string.IsNullOrEmpty(target.Name) || target.Name.Length > 253 || !NamePattern().IsMatch(target.Name)) throw new ApiFault(400, "Invalid pod name.");
        if (!Guid.TryParse(target.Uid, out _)) throw new ApiFault(400, "A Kubernetes pod UID is required.");
    }
    public static void ValidateIdempotencyKey(string key)
    {
        if (key.Length is < 8 or > 128 || key.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not '-' and not '_'))
            throw new ApiFault(400, "Idempotency-Key must contain 8-128 ASCII letters, numbers, '-' or '_'.");
    }
    public static string RequestFingerprint(StartExperiment request) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes($"{request.Namespace}\n{request.PodName}\n{request.PodUid}\n{request.DryRun}")));
    public static void ValidateSnapshot(AgentHeartbeat heartbeat)
    {
        if (heartbeat.Targets is null || heartbeat.Targets.Length > 100) throw new ApiFault(400, "At most 100 laboratory targets are accepted.");
        foreach (var target in heartbeat.Targets)
        {
            if (target is null) throw new ApiFault(400, "Invalid target.");
            ValidateTarget(new(target.Namespace, target.Name, target.Uid));
        }
        if (heartbeat.Targets.Select(x => x.Uid).Distinct().Count() != heartbeat.Targets.Length
            || heartbeat.Targets.Select(x => x.Name).Distinct().Count() != heartbeat.Targets.Length
            || heartbeat.Total != heartbeat.Targets.Length || heartbeat.Ready != heartbeat.Targets.Count(x => x.Ready))
            throw new ApiFault(400, "Snapshot counts and identities must match the target list.");
    }
    public static bool Healthy(TargetSnapshot snapshot, DateTimeOffset now) => snapshot.UpdatedAt is { } at
        && at > now.AddSeconds(-30) && snapshot.Total >= 2 && snapshot.Ready == snapshot.Total;
    public static string NextStatus(string current, bool dryRun, string requested)
    {
        if (requested is not ("running" or "deleted" or "recovered" or "failed")) throw new ApiFault(400, "Unknown report status.");
        if (current is "recovered" or "failed")
        {
            if (current == requested) return current;
            throw new ApiFault(409, "A terminal experiment cannot change status.");
        }
        if (requested == "running") return current == "deleted" ? "deleted" : "running";
        if (dryRun && requested == "deleted") throw new ApiFault(409, "A dry-run cannot report a deletion.");
        if (requested == "recovered" && !dryRun && current != "deleted") throw new ApiFault(409, "Deletion must be confirmed before recovery.");
        if (requested == "deleted" && current is not ("running" or "deleted")) throw new ApiFault(409, "Job must be running before deletion.");
        return requested;
    }
}
