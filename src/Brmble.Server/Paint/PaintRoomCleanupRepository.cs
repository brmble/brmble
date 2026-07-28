using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Paint;

public sealed record PaintRoomCleanupRecord(long Id, Guid SessionId, string MatrixRoomId, string Status, int Attempts, string? LastError, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset NextAttemptAt);

public class PaintRoomCleanupRepository(Database database, TimeSpan? pendingGracePeriod = null)
{
    /// <summary>
    /// Grace period before a newly recorded cleanup row becomes eligible for the sweeper.
    /// The row is written *before* the session's terminal state transition, so that a crash
    /// between the two cannot leak the Matrix room. That ordering means the sweeper must not
    /// be able to observe the row until the caller has had a chance to compensate
    /// (<see cref="DeletePendingAsync"/>) if the transition is rejected or cancelled.
    /// Without this delay the sweeper could delete the room of a still-live session.
    /// </summary>
    public static readonly TimeSpan DefaultPendingGracePeriod = TimeSpan.FromMinutes(1);

    private readonly TimeSpan _pendingGracePeriod = pendingGracePeriod ?? DefaultPendingGracePeriod;

    public virtual async Task RecordPendingAsync(Guid sessionId, string matrixRoomId, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        var now = DateTimeOffset.UtcNow;
        await connection.ExecuteAsync(new CommandDefinition("""
            INSERT INTO paint_room_cleanup (session_id, matrix_room_id, status, created_at, updated_at, next_attempt_at)
            VALUES (@SessionId, @MatrixRoomId, 'pending', @Now, @Now, @NextAttemptAt)
            ON CONFLICT(matrix_room_id) DO NOTHING
            """, new { SessionId = sessionId.ToString(), MatrixRoomId = matrixRoomId, Now = now, NextAttemptAt = now + _pendingGracePeriod }, cancellationToken: cancellationToken));
    }

    public virtual async Task DeletePendingAsync(Guid sessionId, string matrixRoomId, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("""
            DELETE FROM paint_room_cleanup
            WHERE session_id = @SessionId AND matrix_room_id = @MatrixRoomId AND status = 'pending'
            """, new { SessionId = sessionId.ToString(), MatrixRoomId = matrixRoomId }, cancellationToken: cancellationToken));
    }

    public async Task MarkSucceededAsync(long id, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("UPDATE paint_room_cleanup SET status = 'succeeded', last_error = NULL, updated_at = @Now WHERE id = @Id", new { Id = id, Now = DateTimeOffset.UtcNow }, cancellationToken: cancellationToken));
    }

    public Task MarkFailedAsync(long id, string error, CancellationToken cancellationToken = default)
        => MarkFailedAsync(id, error, DateTimeOffset.UtcNow.AddMinutes(1), cancellationToken);

    public async Task MarkFailedAsync(long id, string error, DateTimeOffset nextAttemptAt, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("UPDATE paint_room_cleanup SET status = 'pending', attempts = attempts + 1, last_error = @Error, updated_at = @Now, next_attempt_at = @NextAttemptAt WHERE id = @Id", new { Id = id, Error = error, Now = DateTimeOffset.UtcNow, NextAttemptAt = nextAttemptAt }, cancellationToken: cancellationToken));
    }

    public async Task MarkTerminalAsync(long id, string error, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("UPDATE paint_room_cleanup SET status = 'terminal', attempts = attempts + 1, last_error = @Error, updated_at = @Now WHERE id = @Id", new { Id = id, Error = error, Now = DateTimeOffset.UtcNow }, cancellationToken: cancellationToken));
    }

    public async Task<IReadOnlyList<PaintRoomCleanupRecord>> GetPendingAsync(CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        var rows = await connection.QueryAsync<PaintRoomCleanupRow>(new CommandDefinition("""
            SELECT id Id, session_id SessionId, matrix_room_id MatrixRoomId, status Status, attempts Attempts,
                   last_error LastError, created_at CreatedAt, updated_at UpdatedAt, next_attempt_at NextAttemptAt
            FROM paint_room_cleanup
            WHERE status = 'pending' AND next_attempt_at <= @Now
            ORDER BY id
            """, new { Now = DateTimeOffset.UtcNow }, cancellationToken: cancellationToken));
        return rows.Select(r => new PaintRoomCleanupRecord(r.Id, Guid.Parse(r.SessionId), r.MatrixRoomId, r.Status, r.Attempts, r.LastError,
            DateTimeOffset.Parse(r.CreatedAt), DateTimeOffset.Parse(r.UpdatedAt), DateTimeOffset.Parse(r.NextAttemptAt))).ToArray();
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
        public required string NextAttemptAt { get; init; }
    }
}
