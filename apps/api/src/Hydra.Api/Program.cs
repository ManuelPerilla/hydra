using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Hydra.Api;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Http.Connections;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var settings = builder.Configuration.GetSection("Hydra").Get<HydraSettings>() ?? new();
settings.Validate(builder.Environment.IsDevelopment());
var connectionString = builder.Configuration.GetConnectionString("Hydra")
    ?? throw new InvalidOperationException("ConnectionStrings:Hydra is required.");
var connection = new NpgsqlConnectionStringBuilder(connectionString) { MaxPoolSize = 12, Timeout = 5, CommandTimeout = 10 };
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(NpgsqlDataSource.Create(connection.ConnectionString));
builder.Services.AddSingleton<HydraStore>();
builder.Services.AddSingleton<PostgresXmlRepository>();
builder.Services.AddSingleton<AesXmlEncryptor>();
builder.Services.AddDataProtection().SetApplicationName("Hydra");
builder.Services.AddOptions<KeyManagementOptions>().Configure<PostgresXmlRepository, AesXmlEncryptor>((options, repository, encryptor) =>
{
    options.XmlRepository = repository;
    options.XmlEncryptor = encryptor;
});
var secureCookies = settings.AuthMode == "github" ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-Token";
    options.Cookie.Name = "hydra.csrf";
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = secureCookies;
    options.Cookie.HttpOnly = true;
});
var auth = builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
{
    options.Cookie.Name = "hydra.session";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = secureCookies;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = false;
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
});
if (settings.AuthMode == "github") auth.AddOAuth("github", options =>
{
    options.ClientId = settings.GitHubClientId;
    options.ClientSecret = settings.GitHubClientSecret;
    options.CallbackPath = "/auth/github/callback";
    options.AuthorizationEndpoint = "https://github.com/login/oauth/authorize";
    options.TokenEndpoint = "https://github.com/login/oauth/access_token";
    options.UserInformationEndpoint = "https://api.github.com/user";
    options.SaveTokens = false;
    options.UsePkce = true;
    options.ClaimActions.MapJsonKey(ClaimTypes.NameIdentifier, "id");
    options.ClaimActions.MapJsonKey(ClaimTypes.Name, "login");
    options.Events.OnCreatingTicket = async context =>
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, context.Options.UserInformationEndpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", context.AccessToken);
        request.Headers.UserAgent.ParseAdd("Hydra/0.1");
        request.Headers.Accept.ParseAdd("application/vnd.github+json");
        using var response = await context.Backchannel.SendAsync(request, context.HttpContext.RequestAborted);
        response.EnsureSuccessStatusCode();
        using var user = JsonDocument.Parse(await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted));
        context.RunClaimActions(user.RootElement);
    };
    options.Events.OnRemoteFailure = context =>
    {
        context.HandleResponse();
        context.Response.StatusCode = 401;
        return context.Response.WriteAsJsonAsync(new { error = "GitHub authentication failed." });
    };
});
builder.Services.AddAuthorization();
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.RespectRequiredConstructorParameters = true);
builder.Services.AddSignalR(options =>
{
    options.MaximumReceiveMessageSize = 4096;
    options.MaximumParallelInvocationsPerClient = 1;
    options.StreamBufferCapacity = 10;
    options.EnableDetailedErrors = false;
});
builder.Services.AddHostedService<TelemetryPublisher>();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    foreach (var network in settings.TrustedProxyNetworks.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("experiments", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 8, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("reads", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 65536);
var app = builder.Build();
// Startup is fail-closed: no agent commands are accepted if the durable schema cannot be initialized.
await app.Services.GetRequiredService<HydraStore>().Initialize(CancellationToken.None);
app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Cache-Control"] = "no-store";
    try
    {
        if (settings.AuthMode == "github" && context.Request.Path.StartsWithSegments("/hubs/telemetry")
            && context.Request.Headers.Upgrade.ToString().Equals("websocket", StringComparison.OrdinalIgnoreCase))
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var supplied)
                || supplied.GetLeftPart(UriPartial.Authority) != new Uri(settings.PublicOrigin).GetLeftPart(UriPartial.Authority))
                throw new ApiFault(403, "Telemetry WebSockets require the configured public origin.");
        }
        await next(context);
    }
    catch (ApiFault fault) { context.Response.StatusCode = fault.Status; await context.Response.WriteAsJsonAsync(new { error = fault.Message }); }
    catch (AntiforgeryValidationException) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = "Invalid CSRF token." }); }
    catch (NpgsqlException exception)
    {
        app.Logger.LogError(exception, "Durable storage unavailable.");
        context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new { error = "Durable storage unavailable; no action was authorized." });
    }
});
app.UseAuthentication();
if (settings.AuthMode == "local") app.Use(async (context, next) =>
{
    context.User = new ClaimsPrincipal(new ClaimsIdentity([
        new Claim(ClaimTypes.NameIdentifier, "local-operator"), new Claim(ClaimTypes.Name, "Local operator")], "local"));
    await next(context);
});
app.UseAuthorization();
app.UseRateLimiter();
app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (HydraStore store, CancellationToken ct) =>
    await store.Ready(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));
app.MapGet("/api/session", (HttpContext context, IAntiforgery csrf) =>
{
    var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    return Results.Ok(new { authenticated = context.User.Identity?.IsAuthenticated == true,
        @operator = settings.IsOperator(id), user = context.User.Identity?.Name, csrfToken = csrf.GetAndStoreTokens(context).RequestToken,
        mode = settings.AuthMode });
}).RequireRateLimiting("reads");
app.MapGet("/auth/github", (HttpContext context) =>
{
    if (settings.AuthMode != "github") return Results.BadRequest(new { error = "GitHub OAuth is disabled in local mode." });
    // A configured canonical origin prevents forwarded-host poisoning of the OAuth redirect URI.
    var origin = new Uri(settings.PublicOrigin);
    context.Request.Scheme = origin.Scheme;
    context.Request.Host = origin.IsDefaultPort ? new HostString(origin.Host) : new HostString(origin.Host, origin.Port);
    return Results.Challenge(new AuthenticationProperties { RedirectUri = "/" }, ["github"]);
}).RequireRateLimiting("reads");
app.MapPost("/auth/logout", async (HttpContext context, IAntiforgery csrf) =>
{
    await csrf.ValidateRequestAsync(context);
    await context.SignOutAsync();
    return Results.NoContent();
}).RequireAuthorization();
var api = app.MapGroup("/api").RequireAuthorization().RequireRateLimiting("reads");
api.MapGet("/targets", (HydraStore store, CancellationToken ct) => store.Snapshot(ct));
api.MapGet("/experiments", async (HydraStore store, CancellationToken ct) => new { items = await store.Experiments(ct) });
api.MapPost("/experiments", async (StartExperiment request, HttpContext context, IAntiforgery csrf, HydraStore store, CancellationToken ct) =>
{
    var owner = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!settings.IsOperator(owner)) throw new ApiFault(403, "An explicitly authorized operator is required.");
    await csrf.ValidateRequestAsync(context);
    var experiment = await store.Start(request, owner!, context.Request.Headers["Idempotency-Key"].ToString(), ct);
    return Results.Accepted($"/api/experiments", experiment);
}).RequireRateLimiting("experiments");
api.MapGet("/events", (long? after, HydraStore store, CancellationToken ct) => store.Events(after ?? 0, 200, ct));
var internalApi = app.MapGroup("/internal").AddEndpointFilter(async (context, next) =>
{
    var header = context.HttpContext.Request.Headers.Authorization.ToString();
    if (!header.StartsWith("Bearer ", StringComparison.Ordinal) || !Safety.SafeEquals(header[7..], settings.AgentToken))
        return Results.Unauthorized();
    return await next(context);
});
internalApi.MapPost("/agent/heartbeat", async (AgentHeartbeat heartbeat, HydraStore store, CancellationToken ct) =>
{
    await store.Heartbeat(heartbeat, ct);
    return Results.NoContent();
});
internalApi.MapPost("/jobs/claim", async (ClaimRequest request, HydraStore store, CancellationToken ct) =>
{
    var job = await store.Claim(request.AgentId, ct);
    return job is null ? Results.NoContent() : Results.Ok(job);
});
internalApi.MapPost("/jobs/{id:guid}/report", (Guid id, ReportRequest report, HydraStore store, CancellationToken ct) => store.Report(id, report, ct));
app.MapHub<TelemetryHub>("/hubs/telemetry", options =>
{
    options.Transports = HttpTransportType.WebSockets;
    options.ApplicationMaxBufferSize = 65536;
    options.TransportMaxBufferSize = 65536;
    options.WebSockets.CloseTimeout = TimeSpan.FromSeconds(5);
}).RequireAuthorization();
app.Run();

public partial class Program;
