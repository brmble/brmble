using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Paint;

public sealed record PaintRoomCleanupRecord(long Id, Guid SessionId, string MatrixRoomId, string Status, int Attempts, string? LastError, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public class PaintRoomCleanupRepository(Database database)
{
    public virtual async Task RecordPendingAsync(Guid sessionId, string matrixRoomId, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("""
            INSERT INTO paint_room_cleanup (session_id, matrix_room_id, status, created_at, updated_at)
            VALUES (@SessionId, @MatrixRoomId, 'pending', @Now, @Now)
            """, new { SessionId = sessionId.ToString(), MatrixRoomId = matrixRoomId, Now = DateTimeOffset.UtcNow }, cancellationToken: cancellationToken));
    }

    public async Task MarkSucceededAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("UPDATE paint_room_cleanup SET status = 'succeeded', last_error = NULL, updated_at = @Now WHERE id = @Id", new { Id = id, Now = DateTimeOffset.UtcNow }, cancellationToken: cancellationToken));
    }

    public async Task MarkFailedAsync(long id, string error, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("UPDATE paint_room_cleanup SET status = 'pending', attempts = attempts + 1, last_error = @Error, updated_at = @Now WHERE id = @Id", new { Id = id, Error = error, Now = DateTimeOffset.UtcNow }, cancellationToken: cancellationToken));
    }

    public async Task<IReadOnlyList<PaintRoomCleanupRecord>> GetPendingAsync(CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        var rows = await connection.QueryAsync<PaintRoomCleanupRow>(new CommandDefinition("""
            SELECT id Id, session_id SessionId, matrix_room_id MatrixRoomId, status Status, attempts Attempts,
                   last_error LastError, created_at CreatedAt, updated_at UpdatedAt
            FROM paint_room_cleanup WHERE status = 'pending' ORDER BY id
            """, cancellationToken: cancellationToken));
        return rows.Select(r => new PaintRoomCleanupRecord(r.Id, Guid.Parse(r.SessionId), r.MatrixRoomId, r.Status, r.Attempts, r.LastError,
            DateTimeOffset.Parse(r.CreatedAt), DateTimeOffset.Parse(r.UpdatedAt))).ToArray();
    }

    private sealed class PaintRoomCleanupRow
    {
        public long Id { get; init; }
        public required string SessionId { get; init; }
        public required string MatrixRoomId { get; init; }
        public required string Status { get; init; }
        public int Attempts { get; init; }
        public string? LastError { get; init; }
        public required string CreatedAt { get; init; }
        public required string UpdatedAt { get; init; }
    }
}
