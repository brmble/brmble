using Dapper;

namespace Brmble.Server.Data;

public class SyncFailedAssignment
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string AssignmentId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? ErrorMessage { get; set; }
    public int RetryCount { get; set; }
    public DateTime NextRetryAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class SyncFailedAssignmentRepository
{
    private readonly Database _db;
    private static readonly int[] RetryDelays = { 30, 60, 120, 240, 480 };

    public SyncFailedAssignmentRepository(Database db)
    {
        _db = db;
    }

    public async Task AddAsync(string assignmentId, string action, string errorMessage)
    {
        using var conn = _db.CreateConnection();
        var failed = new SyncFailedAssignment
        {
            AssignmentId = assignmentId,
            Action = action,
            ErrorMessage = errorMessage,
            RetryCount = 0,
            NextRetryAt = DateTime.UtcNow.AddSeconds(RetryDelays[0])
        };
        await conn.ExecuteAsync(
            @"INSERT INTO sync_failed_assignments (id, assignment_id, action, error_message, retry_count, next_retry_at, created_at)
              VALUES (@Id, @AssignmentId, @Action, @ErrorMessage, @RetryCount, @NextRetryAt, @CreatedAt)",
            failed);
    }

    public async Task<IReadOnlyList<SyncFailedAssignment>> GetPendingAsync()
    {
        using var conn = _db.CreateConnection();
        var result = await conn.QueryAsync<SyncFailedAssignment>(
            "SELECT * FROM sync_failed_assignments WHERE next_retry_at <= @Now ORDER BY next_retry_at",
            new { Now = DateTime.UtcNow });
        return result.ToList();
    }

    public async Task IncrementRetryAsync(string id, string errorMessage)
    {
        using var conn = _db.CreateConnection();
        
        var sql = @"
            UPDATE sync_failed_assignments 
            SET retry_count = retry_count + 1,
                next_retry_at = datetime('now', '+' || 
                    CASE 
                        WHEN retry_count = 0 THEN 30
                        WHEN retry_count = 1 THEN 60
                        WHEN retry_count = 2 THEN 120
                        WHEN retry_count = 3 THEN 240
                        ELSE 480
                    END || ' seconds'),
                error_message = @ErrorMessage
            WHERE id = @Id";
        
        await conn.ExecuteAsync(sql, new { Id = id, ErrorMessage = errorMessage });
    }

    public async Task RemoveAsync(string id)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("DELETE FROM sync_failed_assignments WHERE id = @Id", new { Id = id });
    }
}
