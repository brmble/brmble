using Brmble.Server.Matrix;

namespace Brmble.Server.Companions;

public sealed class CustomCompanionGalleryService(
    CustomCompanionRepository repository,
    IMatrixAppService matrixAppService)
{
    private readonly SemaphoreSlim _roomCreationLock = new(1, 1);

    public async Task<string> GetOrCreateRoomIdAsync(CancellationToken cancellationToken)
    {
        var existingRoomId = await repository.GetRoomIdAsync();
        if (existingRoomId is not null)
        {
            return existingRoomId;
        }

        await _roomCreationLock.WaitAsync(cancellationToken);
        try
        {
            existingRoomId = await repository.GetRoomIdAsync();
            if (existingRoomId is not null)
            {
                return existingRoomId;
            }

            var roomId = await matrixAppService.CreateCustomCompanionGalleryRoom();
            await repository.SetRoomIdAsync(roomId);
            return roomId;
        }
        finally
        {
            _roomCreationLock.Release();
        }
    }
}
