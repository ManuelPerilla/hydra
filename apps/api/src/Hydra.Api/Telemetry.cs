using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Hydra.Api;

[Authorize]
public sealed class TelemetryHub : Hub { }

public sealed class TelemetryPublisher(HydraStore store, IHubContext<TelemetryHub> hub, ILogger<TelemetryPublisher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        long cursor = 0;
        var initialized = false;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!initialized)
                {
                    // Existing history belongs to REST replay; a restarting replica sends new commits.
                    cursor = await store.LatestSequence(stoppingToken);
                    initialized = true;
                }
                var page = await store.Events(cursor, 200, stoppingToken);
                if (page.ResetRequired) cursor = page.LastSequence;
                else foreach (var item in page.Items)
                {
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                    timeout.CancelAfter(TimeSpan.FromSeconds(5));
                    await hub.Clients.All.SendAsync("Event", item, timeout.Token);
                    cursor = item.Sequence;
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogWarning(exception, "Telemetry delivery interrupted; durable cursor will be retried."); }
            await Task.Delay(TimeSpan.FromMilliseconds(500), stoppingToken);
        }
    }
}
