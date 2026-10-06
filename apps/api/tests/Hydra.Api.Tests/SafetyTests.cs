using System.Security.Cryptography;
using System.Xml.Linq;
using System.Security.Claims;
using System.Text.Json;
using Hydra.Api;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Hydra.Api.Tests;

public sealed class SafetyTests
{
    public static HydraSettings LocalSettings => new() { AuthMode = "local", AllowLocalAuth = true,
        AgentToken = new string('x', 32), DataProtectionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) };
    [Fact]
    public void LocalAuthRequiresDevelopmentAndExplicitFlag()
    {
        Assert.Throws<InvalidOperationException>(() => LocalSettings.Validate(false));
        var noFlag = new HydraSettings { AuthMode = "local", AgentToken = new string('x', 32), DataProtectionKey = LocalSettings.DataProtectionKey };
        Assert.Throws<InvalidOperationException>(() => noFlag.Validate(true));
        LocalSettings.Validate(true);
    }
    [Theory]
    [InlineData("hydra-system", "victim", "11111111-1111-1111-1111-111111111111")]
    [InlineData("chaos-demo", "../victim", "11111111-1111-1111-1111-111111111111")]
    [InlineData("chaos-demo", "victim", "no-uid")]
    public void RejectsTargetsOutsideExplicitScope(string ns, string name, string uid) =>
        Assert.Throws<ApiFault>(() => Safety.ValidateTarget(new(ns, name, uid)));
    [Fact]
    public void SnapshotRejectsInventedCountsAndDuplicateTargets()
    {
        var pod = new Target("chaos-demo", "victim", Guid.NewGuid().ToString(), true);
        Assert.Throws<ApiFault>(() => Safety.ValidateSnapshot(new([pod], 2, 2)));
        Assert.Throws<ApiFault>(() => Safety.ValidateSnapshot(new([pod, pod], 2, 2)));
    }
    [Fact]
    public void StaleOrDegradedSnapshotCannotAuthorizeDestruction()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.False(Safety.Healthy(new("chaos-demo", [], 2, 2, now.AddMinutes(-1)), now));
        Assert.False(Safety.Healthy(new("chaos-demo", [], 1, 2, now), now));
        Assert.False(Safety.Healthy(new("chaos-demo", [], 1, 1, now), now));
    }
    [Fact]
    public void ReportsCannotInventDeletionOrDowngradeProgress()
    {
        Assert.Throws<ApiFault>(() => Safety.NextStatus("running", true, "deleted"));
        Assert.Throws<ApiFault>(() => Safety.NextStatus("running", false, "recovered"));
        Assert.Equal("deleted", Safety.NextStatus("deleted", false, "running"));
        Assert.Throws<ApiFault>(() => Safety.NextStatus("recovered", false, "running"));
    }
    [Fact]
    public void GitHubNumericIdentifierMapsToStableOperatorClaim()
    {
        var options = new OAuthOptions();
        options.ClaimActions.MapJsonKey(ClaimTypes.NameIdentifier, "id");
        using var document = JsonDocument.Parse("{\"id\":123456,\"login\":\"operator\"}");
        var identity = new ClaimsIdentity("github");
        foreach (var action in options.ClaimActions) action.Run(document.RootElement, identity, "github");
        Assert.Equal("123456", identity.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    }
    [Fact]
    public void ProtectedKeyRoundtripDetectsTamperingAndContainsNoPlaintext()
    {
        var settings = LocalSettings;
        using var services = new ServiceCollection().AddSingleton(settings).BuildServiceProvider();
        var encrypted = new AesXmlEncryptor(settings).Encrypt(new XElement("key", "sensitive-test-material"));
        Assert.DoesNotContain("sensitive-test-material", encrypted.EncryptedElement.ToString());
        Assert.Equal("sensitive-test-material", new AesXmlDecryptor(services).Decrypt(encrypted.EncryptedElement).Value);
        encrypted.EncryptedElement.Element("tag")!.Value = Convert.ToBase64String(new byte[16]);
        Assert.Throws<AuthenticationTagMismatchException>(() => new AesXmlDecryptor(services).Decrypt(encrypted.EncryptedElement));
    }
    [Theory]
    [InlineData("different", "expected", false)]
    [InlineData("expected", "expected", true)]
    [InlineData(null, "expected", false)]
    public void CredentialsUseFixedLengthDigestComparison(string? received, string expected, bool matches) =>
        Assert.Equal(matches, Safety.SafeEquals(received, expected));
}
