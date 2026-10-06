using System.Text.Json;

namespace Hydra.Api;

public sealed record Target(string Namespace, string Name, string Uid, bool Ready);
public sealed record TargetRef(string Namespace, string Name, string Uid);
public sealed record TargetSnapshot(string Namespace, Target[] Items, int Ready, int Total, DateTimeOffset? UpdatedAt);
public sealed record StartExperiment(string Namespace, string PodName, string PodUid, bool DryRun);
public sealed record Experiment(Guid Id, string Status, bool DryRun, TargetRef Target, DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt = null, DateTimeOffset? CompletedAt = null, long? RecoveryMs = null,
    string? Message = null, string? TweetDraft = null);
public sealed record TelemetryEvent(long Sequence, string Type, Guid? ExperimentId, DateTimeOffset At, JsonElement Data);
public sealed record EventPage(TelemetryEvent[] Items, long LastSequence, bool ResetRequired);
public sealed record AgentHeartbeat(Target[] Targets, int Ready, int Total);
public sealed record ClaimRequest(string AgentId);
public sealed record Job(Guid Id, string LeaseToken, TargetRef Target, bool DryRun);
public sealed record ReportRequest(string LeaseToken, string Status, string? Message, long? RecoveryMs = null, string? TweetDraft = null);
public sealed class ApiFault(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed class HydraSettings
{
    public string AuthMode { get; init; } = "github";
    public bool AllowLocalAuth { get; init; }
    public string AgentToken { get; init; } = "";
    public string DataProtectionKey { get; init; } = "";
    public string GitHubClientId { get; init; } = "";
    public string GitHubClientSecret { get; init; } = "";
    public string AllowedGitHubIds { get; init; } = "";
    public string PublicOrigin { get; init; } = "";
    public string TrustedProxyNetworks { get; init; } = "";
    public const string ChaosNamespace = "chaos-demo";
    public void Validate(bool development)
    {
        if (AuthMode is not ("local" or "github")) throw new InvalidOperationException("Hydra:AuthMode must be local or github.");
        if (AuthMode == "local" && (!development || !AllowLocalAuth))
            throw new InvalidOperationException("Local authentication requires Development and Hydra:AllowLocalAuth=true.");
        if (AgentToken.Length < 32) throw new InvalidOperationException("Hydra:AgentToken must contain at least 32 characters.");
        byte[] key;
        try { key = Convert.FromBase64String(DataProtectionKey); }
        catch (FormatException) { throw new InvalidOperationException("Hydra:DataProtectionKey must be a base64 AES-256 key."); }
        if (key.Length != 32) throw new InvalidOperationException("Hydra:DataProtectionKey must encode exactly 32 bytes.");
        if (AuthMode == "github" && (string.IsNullOrWhiteSpace(GitHubClientId) || string.IsNullOrWhiteSpace(GitHubClientSecret)
            || !Uri.TryCreate(PublicOrigin, UriKind.Absolute, out var origin) || origin.Scheme != "https" || origin.AbsolutePath != "/"))
            throw new InvalidOperationException("GitHub mode requires OAuth credentials and an HTTPS Hydra:PublicOrigin without a path.");
    }
    public bool IsOperator(string? id) => AuthMode == "local" && id == "local-operator"
        || id is not null && AllowedGitHubIds.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Contains(id, StringComparer.Ordinal);
}
