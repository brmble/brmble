using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Paint;

public sealed record PaintTemporaryCleanupRecord(
    Guid SessionId,
    string Status,
    int Attempts,
    string? LastError,
    DateTimeOffset NextAttemptAt);

public class PaintTemporaryCleanupRepository(Database database)
{
    public virtual async Task RecordPendingAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        var now = DateTimeOffset.UtcNow;
        await connection.ExecuteAsync(new CommandDefinition("""
            INSERT INTO paint_temporary_cleanup (session_id, status, attempts, last_error, created_at, updated_at, next_attempt_at)
            VALUES (@SessionId, 'pending', 0, NULL, @Now, @Now, @Now)
            ON CONFLICT(session_id) DO NOTHING
            """, new { SessionId = sessionId.ToString(), Now = now }, cancellationToken: cancellationToken));
    }

    public virtual async Task<IReadOnlyList<PaintTemporaryCleanupRecord>> GetDueAsync(CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        var rows = await connection.QueryAsync<PaintTemporaryCleanupRow>(new CommandDefinition("""
            SELECT session_id SessionId,
                   status Status,
                   attempts Attempts,
                   last_error LastError,
                   next_attempt_at NextAttemptAt
            FROM paint_temporary_cleanup
            WHERE status IN ('pending', 'failed')
              AND next_attempt_at <= @Now
            ORDER BY created_at, session_id
            """, new { Now = DateTimeOffset.UtcNow }, cancellationToken: cancellationToken));
        return rows.Select(ToRecord).ToArray();
    }

    public virtual async Task<IReadOnlyList<PaintTemporaryCleanupRecord>> GetTerminalAsync(CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        var rows = await connection.QueryAsync<PaintTemporaryCleanupRow>(new CommandDefinition("""
            SELECT session_id SessionId,
                   status Status,
                   attempts Attempts,
                   last_error LastError,
                   next_attempt_at NextAttemptAt
            FROM paint_temporary_cleanup
            WHERE status = 'terminal'
            ORDER BY updated_at DESC, session_id
            """, cancellationToken: cancellationToken));
        return rows.Select(ToRecord).ToArray();
    }

    public virtual async Task MarkFailedAsync(
        Guid sessionId,
        string errorType,
        DateTimeOffset nextAttemptAt,
        CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("""
            UPDATE paint_temporary_cleanup
            SET status = 'failed',
                attempts = attempts + 1,
                last_error = @ErrorType,
                updated_at = @Now,
                next_attempt_at = @NextAttemptAt
            WHERE session_id = @SessionId
            """, new
        {
            SessionId = sessionId.ToString(),
            ErrorType = errorType,
            Now = DateTimeOffset.UtcNow,
            NextAttemptAt = nextAttemptAt,
        }, cancellationToken: cancellationToken));
    }

    public virtual async Task MarkTerminalAsync(
        Guid sessionId,
        string errorType,
        CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("""
            UPDATE paint_temporary_cleanup
            SET status = 'terminal',
                attempts = attempts + 1,
                last_error = @ErrorType,
                updated_at = @Now
            WHERE session_id = @SessionId
            """, new
        {
            SessionId = sessionId.ToString(),
            ErrorType = errorType,
            Now = DateTimeOffset.UtcNow,
        }, cancellationToken: cancellationToken));
    }

    public virtual async Task<bool> RequeueTerminalAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        var affected = await connection.ExecuteAsync(new CommandDefinition("""
            UPDATE paint_temporary_cleanup
            SET status = 'failed',
                attempts = 0,
                updated_at = @Now,
                next_attempt_at = @Now
            WHERE session_id = @SessionId
              AND status = 'terminal'
            """, new
        {
            SessionId = sessionId.ToString(),
            Now = DateTimeOffset.UtcNow,
        }, cancellationToken: cancellationToken));
        return affected > 0;
    }

    public virtual async Task DeleteRecordAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync(new CommandDefinition("""
            DELETE FROM paint_temporary_cleanup
            WHERE session_id = @SessionId
            """, new { SessionId = sessionId.ToString() }, cancellationToken: cancellationToken));
    }

    private static PaintTemporaryCleanupRecord ToRecord(PaintTemporaryCleanupRow row)
        => new(
            Guid.Parse(row.SessionId),
            row.Status,
            row.Attempts,
            row.LastError,
            DateTimeOffset.Parse(row.NextAttemptAt));

    private sealed class PaintTemporaryCleanupRow
    {
        public required string SessionId { get; init; }
        public required string Status { get; init; }
        public int Attempts { get; init; }
        public string? LastError { get; init; }
        public required string NextAttemptAt { get; init; }
    }
}
