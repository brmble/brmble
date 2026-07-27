using System.Text.Json;
using Brmble.Server.Matrix;

namespace Brmble.Server.Paint;

public sealed class MatrixPaintService(IMatrixAppService matrixAppService) : IMatrixPaintService
{
    public Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> invitedMatrixUserIds, CancellationToken cancellationToken)
        => matrixAppService.CreatePaintRoom(name, invitedMatrixUserIds);

    public Task InvitePaintUserAsync(string roomId, string matrixUserId, CancellationToken cancellationToken)
        => matrixAppService.InvitePaintUser(roomId, matrixUserId);

    public Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken cancellationToken)
        => matrixAppService.GetRoomEvent(roomId, eventId);

    public Task<string?> GetMembershipAsync(string roomId, string matrixUserId, CancellationToken cancellationToken)
        => matrixAppService.GetRoomMembership(roomId, matrixUserId);

    public Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken cancellationToken)
        => matrixAppService.DownloadMedia(mxcUrl, cancellationToken);

    public Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken)
        => matrixAppService.DeletePaintRoomAsync(roomId, cancellationToken);
}
