using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Paint;

public sealed class PaintRoomCleanupService(
    PaintRoomCleanupRepository repository,
    IMatrixPaintService matrix,
    ILogger<PaintRoomCleanupService>? logger = null) : BackgroundService
{
    private const string MatrixDeleteFailureType = "MATRIX_ROOM_DELETE_FAILED";
    private const string ExceptionMode = "exception";

    public async Task ProcessPendingAsync(CancellationToken cancellationToken)
    {
        foreach (var record in await repository.GetPendingAsync(cancellationToken))
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
                    continue;
                }

                var error = result.Error ?? MatrixDeleteFailureType;
                await repository.MarkFailedAsync(record.Id, error[..Math.Min(error.Length, 256)], cancellationToken);
                logger?.LogWarning(
                    "Paint cleanup failed: {SessionId} {RoomId} {Attempt} {Mode} {FailureType}",
                    record.SessionId,
                    record.MatrixRoomId,
                    record.Attempts + 1,
                    result.Mode,
                    MatrixDeleteFailureType);
            }
            catch (Exception ex)
            {
                await repository.MarkFailedAsync(record.Id, ex.GetType().Name, cancellationToken);
                logger?.LogWarning(
                    "Paint cleanup threw: {SessionId} {RoomId} {Attempt} {Mode} {FailureType}",
                    record.SessionId,
                    record.MatrixRoomId,
                    record.Attempts + 1,
                    ExceptionMode,
                    ex.GetType().Name);
            }
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
}
