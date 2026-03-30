using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Brmble.Server.Data;

namespace Brmble.Server.Moderator;

public class SyncRetryBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<SyncRetryBackgroundService> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);

    public SyncRetryBackgroundService(
        IServiceProvider serviceProvider,
        ILogger<SyncRetryBackgroundService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Sync retry background service started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessFailedSyncsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing failed syncs");
            }

            await Task.Delay(PollInterval, stoppingToken);
        }
    }

    private async Task ProcessFailedSyncsAsync(CancellationToken stoppingToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var syncFailedRepo = scope.ServiceProvider.GetRequiredService<SyncFailedAssignmentRepository>();
        var assignmentRepo = scope.ServiceProvider.GetRequiredService<ModeratorAssignmentRepository>();
        var mumbleSync = scope.ServiceProvider.GetRequiredService<IMumbleGroupSyncService>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<SyncRetryBackgroundService>>();

        var pending = await syncFailedRepo.GetPendingAsync();
        if (pending.Count == 0) return;

        logger.LogInformation("Processing {Count} pending sync failures", pending.Count);

        foreach (var failed in pending)
        {
            if (stoppingToken.IsCancellationRequested) break;

            if (failed.RetryCount >= 5)
            {
                logger.LogWarning("Max retries exceeded for sync {Id}, marking as failed permanently", failed.Id);
                await syncFailedRepo.RemoveAsync(failed.Id);
                continue;
            }

            var assignment = await assignmentRepo.GetByIdAsync(failed.AssignmentId);
            if (assignment == null)
            {
                logger.LogInformation("Assignment {Id} no longer exists, removing sync record", failed.AssignmentId);
                await syncFailedRepo.RemoveAsync(failed.Id);
                continue;
            }

            try
            {
                var success = await mumbleSync.SyncAssignmentAsync(
                    failed.AssignmentId,
                    assignment.UserId,
                    assignment.ChannelId,
                    failed.Action == "add");

                if (success)
                {
                    logger.LogInformation("Successfully synced assignment {Id} on retry", failed.AssignmentId);
                    await syncFailedRepo.RemoveAsync(failed.Id);
                }
                else
                {
                    await syncFailedRepo.IncrementRetryAsync(failed.Id, "Retry failed");
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error retrying sync {Id}", failed.Id);
                await syncFailedRepo.IncrementRetryAsync(failed.Id, ex.Message);
            }
        }
    }
}
