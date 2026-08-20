using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Paint;

public sealed class PaintTemporaryCleanupService(
    PaintTemporaryCleanupRepository repository,
    IPaintTemporarySourceStore store,
    IPaintTemporaryDataLifetime lifetime,
    ILogger<PaintTemporaryCleanupService>? logger = null) : BackgroundService
{
    private const int MaxCleanupAttempts = 5;
    private readonly SemaphoreSlim _sweepGate = new(1, 1);

    public async Task ProcessPendingAsync(CancellationToken cancellationToken)
    {
        if (!await _sweepGate.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            await DiscoverUnownedSessionsAsync(cancellationToken);
            foreach (var record in await repository.GetDueAsync(cancellationToken))
            {
                if (lifetime.ShouldRetainTemporaryData(record.SessionId))
                {
                    continue;
                }

                try
                {
                    await store.DeleteAsync(record.SessionId, cancellationToken);
                    if (await TryDeleteCleanupRecordAsync(record.SessionId, cancellationToken))
                    {
                        logger?.LogInformation(
                            "Paint temporary cleanup succeeded: {SessionId} {Attempt}",
                            record.SessionId,
                            record.Attempts + 1);
                    }
                }
                catch (DirectoryNotFoundException)
                {
                    await TryDeleteCleanupRecordAsync(record.SessionId, cancellationToken);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    await RecordFailureAsync(record, ex.GetType().Name, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger?.LogWarning(
                "Paint temporary cleanup sweep failed: {FailureType}",
                ex.GetType().Name);
        }
        finally
        {
            _sweepGate.Release();
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await ProcessPendingAsync(stoppingToken);

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await ProcessPendingAsync(stoppingToken);
        }
    }

    private async Task DiscoverUnownedSessionsAsync(CancellationToken cancellationToken)
    {
        foreach (var sessionId in await store.ListSessionIdsAsync(cancellationToken))
        {
            if (lifetime.ShouldRetainTemporaryData(sessionId))
            {
                continue;
            }

            try
            {
                await repository.RecordPendingAsync(sessionId, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger?.LogWarning(
                    "Paint temporary cleanup registration failed: {SessionId} {FailureType}",
                    sessionId,
                    ex.GetType().Name);
            }
        }
    }

    private async Task<bool> TryDeleteCleanupRecordAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        try
        {
            await repository.DeleteRecordAsync(sessionId, cancellationToken);
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger?.LogWarning(
                "Paint temporary cleanup state removal failed: {SessionId} {FailureType}",
                sessionId,
                ex.GetType().Name);
            return false;
        }
    }

    private async Task RecordFailureAsync(
        PaintTemporaryCleanupRecord record,
        string failureType,
        CancellationToken cancellationToken)
    {
        var attempt = record.Attempts + 1;
        try
        {
            if (attempt >= MaxCleanupAttempts)
            {
                await repository.MarkTerminalAsync(record.SessionId, failureType, cancellationToken);
                logger?.LogWarning(
                    "Paint temporary cleanup terminal failure: {SessionId} {Attempt} {FailureType}",
                    record.SessionId,
                    attempt,
                    failureType);
            }
            else
            {
                var delay = TimeSpan.FromMinutes(Math.Min(60, 1 << Math.Min(attempt - 1, 6)));
                await repository.MarkFailedAsync(
                    record.SessionId,
                    failureType,
                    DateTimeOffset.UtcNow.Add(delay),
                    cancellationToken);
                logger?.LogWarning(
                    "Paint temporary cleanup failed: {SessionId} {Attempt} {FailureType}",
                    record.SessionId,
                    attempt,
                    failureType);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger?.LogWarning(
                "Paint temporary cleanup state update failed: {SessionId} {Attempt} {FailureType}",
                record.SessionId,
                attempt,
                ex.GetType().Name);
        }
    }
}
