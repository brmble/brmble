using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Paint;

public sealed class PaintSessionExpirationService(PaintSessionManager manager, ILogger<PaintSessionExpirationService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await manager.ExpireInactiveAsync(stoppingToken); }
            catch (Exception exception) { logger.LogError(exception, "Unable to expire inactive paint sessions."); }
        }
    }
}
