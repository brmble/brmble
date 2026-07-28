using System.Text.Json;

namespace Brmble.Server.Paint;

public sealed record MatrixPaintRoomCleanupResult(
    bool Removed,
    string Mode,
    string? Error,
    bool Terminal = false);

public interface IMatrixPaintService
{
    Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> invitedMatrixUserIds, CancellationToken cancellationToken);
    Task InvitePaintUserAsync(string roomId, string matrixUserId, CancellationToken cancellationToken);
    Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken cancellationToken);
    Task<string?> GetMembershipAsync(string roomId, string matrixUserId, CancellationToken cancellationToken);
    Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken cancellationToken);
    Task<byte[]> DownloadMediaAsync(string mxcUrl, long maxBytes, CancellationToken cancellationToken)
        => DownloadMediaAsync(mxcUrl, cancellationToken);
    Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken);
}
