using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Paint;

public sealed class PaintRoomCleanupService(
    PaintRoomCleanupRepository repository,
    IMatrixPaintService matrix,
    ILogger<PaintRoomCleanupService>? logger = null) : BackgroundService
{
    private const string MatrixDeleteFailureType = "MATRIX_ROOM_DELETE_FAILED";
    private const string MatrixAdminTokenMissingFailureType = "MATRIX_ADMIN_TOKEN_MISSING";
    private const string ExceptionMode = "exception";
    private const int MaxCleanupAttempts = 5;

    public async Task ProcessPendingAsync(CancellationToken cancellationToken)
    {
        try
        {
            foreach (var record in await repository.GetPendingAsync(cancellationToken))
            {
                await ProcessRecordAsync(record, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger?.LogWarning("Paint cleanup sweep failed: {FailureType}", ex.GetType().Name);
        }
    }

    private async Task ProcessRecordAsync(PaintRoomCleanupRecord record, CancellationToken cancellationToken)
    {
        try
        {
            var result = await matrix.DeletePaintRoomAsync(record.MatrixRoomId, cancellationToken);
            if (result.Removed)
            {
                await repository.MarkSucceededAsync(record.Id, cancellationToken);
                logger?.LogInformation(
                    "Paint cleanup succeeded: {SessionId} {RoomId} {Attempt} {Mode}",
                    record.SessionId,
                    record.MatrixRoomId,
                    record.Attempts + 1,
                    result.Mode);
                return;
            }

            var error = result.Error ?? MatrixDeleteFailureType;
            await RecordFailureAsync(record, error[..Math.Min(error.Length, 256)], result.Mode,
                error == MatrixAdminTokenMissingFailureType ? error : MatrixDeleteFailureType, result.Terminal, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            await RecordFailureAsync(record, ex.GetType().Name, ExceptionMode, ex.GetType().Name, false, cancellationToken);
        }
    }

    private async Task RecordFailureAsync(
        PaintRoomCleanupRecord record,
        string error,
        string mode,
        string failureType,
        bool terminal,
        CancellationToken cancellationToken)
    {
        try
        {
            var attempt = record.Attempts + 1;
            if (terminal || failureType == MatrixAdminTokenMissingFailureType || attempt >= MaxCleanupAttempts)
            {
                await repository.MarkTerminalAsync(record.Id, error, cancellationToken);
            }
            else
            {
                await repository.MarkFailedAsync(record.Id, error, DateTimeOffset.UtcNow.Add(BackoffFor(attempt)), cancellationToken);
            }
            logger?.LogWarning(
                "Paint cleanup failed: {SessionId} {RoomId} {Attempt} {Mode} {FailureType}",
                record.SessionId,
                record.MatrixRoomId,
                record.Attempts + 1,
                mode,
                failureType);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger?.LogWarning(
                "Paint cleanup state update failed: {SessionId} {RoomId} {Attempt} {Mode} {FailureType}",
                record.SessionId,
                record.MatrixRoomId,
                record.Attempts + 1,
                mode,
                ex.GetType().Name);
        }
    }

    private static TimeSpan BackoffFor(int attempt)
        => TimeSpan.FromMinutes(Math.Min(60, 1 << Math.Min(attempt - 1, 6)));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await ProcessPendingAsync(stoppingToken);

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await ProcessPendingAsync(stoppingToken);
        }
    }
}
