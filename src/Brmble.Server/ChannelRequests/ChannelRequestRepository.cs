using Brmble.Server.Data;
using Dapper;
using Microsoft.Data.Sqlite;

namespace Brmble.Server.ChannelRequests;

public class ChannelRequestRepository : IChannelRequestRepository
{
    private static readonly int[] PendingSlots = [1, 2, 3];
    private readonly Database _db;

    public ChannelRequestRepository(Database db) => _db = db;

    public async Task<CreatePendingChannelRequestResult> CreatePendingAsync(CreateChannelRequestRecord record, int maxPendingRequestsPerUser)
    {
        using var conn = _db.CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction(System.Data.IsolationLevel.Serializable);
        var now = DateTime.UtcNow;

        var pendingCount = await conn.ExecuteScalarAsync<int>(
            """
            SELECT COUNT(*)
            FROM channel_requests
            WHERE requester_user_id = @RequesterUserId AND status = @Status
            """,
            new { record.RequesterUserId, Status = ChannelRequestStatus.Pending },
            tx);

        if (pendingCount >= maxPendingRequestsPerUser)
        {
            tx.Rollback();
            return new(CreatePendingChannelRequestOutcome.TooManyPending, null);
        }

        try
        {
            var slot = await FindAvailablePendingSlotAsync((SqliteConnection)conn, (SqliteTransaction)tx, record.RequesterUserId, maxPendingRequestsPerUser);
            if (slot is null)
            {
                tx.Rollback();
                return new(CreatePendingChannelRequestOutcome.TooManyPending, null);
            }

            var id = await conn.ExecuteScalarAsync<long>(
                """
                INSERT INTO channel_requests (
                    requester_user_id, requester_display_name, requested_channel_name, normalized_channel_name,
                    pending_slot, reason, status, created_at_utc, updated_at_utc, approval_attempt_count
                ) VALUES (
                    @RequesterUserId, @RequesterDisplayName, @RequestedChannelName, @NormalizedChannelName,
                    @PendingSlot, @Reason, @Status, @Now, @Now, 0
                );
                SELECT last_insert_rowid();
                """,
                new
                {
                    record.RequesterUserId,
                    record.RequesterDisplayName,
                    record.RequestedChannelName,
                    record.NormalizedChannelName,
                    PendingSlot = slot,
                    record.Reason,
                    Status = ChannelRequestStatus.Pending,
                    Now = now
                },
                tx);

            tx.Commit();
            return new(CreatePendingChannelRequestOutcome.Created, await GetByIdAsync(id));
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            tx.Rollback();
            return new(CreatePendingChannelRequestOutcome.DuplicatePending, null);
        }
    }

    public async Task<IReadOnlyList<ChannelRequest>> ListMineAsync(long requesterUserId, string? status, int limit)
    {
        using var conn = _db.CreateConnection();
        return (await conn.QueryAsync<ChannelRequest>(
            $"{SelectSql} WHERE requester_user_id = @requesterUserId AND (@status IS NULL OR status = @status) ORDER BY created_at_utc DESC LIMIT @limit",
            new { requesterUserId, status = NormalizeStatus(status), limit })).ToList();
    }

    public async Task<IReadOnlyList<ChannelRequest>> ListAdminAsync(string? status, int limit)
    {
        using var conn = _db.CreateConnection();
        return (await conn.QueryAsync<ChannelRequest>(
            $"{SelectSql} WHERE (@status IS NULL OR status = @status) ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at_utc DESC LIMIT @limit",
            new { status = NormalizeStatus(status), limit })).ToList();
    }

    public async Task<ChannelRequest?> GetByIdAsync(long id)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<ChannelRequest>(
            $"{SelectSql} WHERE id = @id",
            new { id });
    }

    public async Task<bool> TryMarkApprovedAsync(long id, long adminUserId, string adminDisplayName, int createdChannelId, string createdChannelName)
    {
        using var conn = _db.CreateConnection();
        var updated = await conn.ExecuteAsync(
            """
            UPDATE channel_requests
            SET status = @Approved,
                updated_at_utc = @Now,
                handled_at_utc = @Now,
                handled_by_user_id = @adminUserId,
                handled_by_display_name = @adminDisplayName,
                created_channel_id = @createdChannelId,
                created_channel_name = @createdChannelName,
                last_approval_error = NULL,
                approval_attempt_count = approval_attempt_count + 1,
                pending_slot = NULL
            WHERE id = @id AND status = @Pending
            """,
            new
            {
                id,
                adminUserId,
                adminDisplayName,
                createdChannelId,
                createdChannelName,
                Now = DateTime.UtcNow,
                Pending = ChannelRequestStatus.Pending,
                Approved = ChannelRequestStatus.Approved
            });

        return updated == 1;
    }

    public async Task<bool> TryMarkDeniedAsync(long id, long adminUserId, string adminDisplayName, string? decisionReason)
    {
        using var conn = _db.CreateConnection();
        var updated = await conn.ExecuteAsync(
            """
            UPDATE channel_requests
            SET status = @Denied,
                updated_at_utc = @Now,
                handled_at_utc = @Now,
                handled_by_user_id = @adminUserId,
                handled_by_display_name = @adminDisplayName,
                decision_reason = @decisionReason,
                pending_slot = NULL
            WHERE id = @id AND status = @Pending
            """,
            new
            {
                id,
                adminUserId,
                adminDisplayName,
                decisionReason,
                Now = DateTime.UtcNow,
                Pending = ChannelRequestStatus.Pending,
                Denied = ChannelRequestStatus.Denied
            });

        return updated == 1;
    }

    public async Task<bool> TryRecordApprovalFailureAsync(long id, string errorMessage)
    {
        using var conn = _db.CreateConnection();
        var updated = await conn.ExecuteAsync(
            """
            UPDATE channel_requests
            SET updated_at_utc = @Now,
                last_approval_error = @errorMessage,
                approval_attempt_count = approval_attempt_count + 1
            WHERE id = @id AND status = @Pending
            """,
            new { id, errorMessage, Now = DateTime.UtcNow });

        return updated == 1;
    }

    private const string SelectSql = """
        SELECT id AS Id,
               requester_user_id AS RequesterUserId,
               requester_display_name AS RequesterDisplayName,
               requested_channel_name AS RequestedChannelName,
               normalized_channel_name AS NormalizedChannelName,
               reason AS Reason,
               status AS Status,
               created_at_utc AS CreatedAtUtc,
               updated_at_utc AS UpdatedAtUtc,
               handled_at_utc AS HandledAtUtc,
               handled_by_user_id AS HandledByUserId,
               handled_by_display_name AS HandledByDisplayName,
               decision_reason AS DecisionReason,
               created_channel_id AS CreatedChannelId,
               created_channel_name AS CreatedChannelName,
               last_approval_error AS LastApprovalError,
               approval_attempt_count AS ApprovalAttemptCount
        FROM channel_requests
        """;

    private static string? NormalizeStatus(string? status) =>
        string.IsNullOrWhiteSpace(status) || string.Equals(status, "all", StringComparison.OrdinalIgnoreCase)
            ? null
            : status.Trim().ToLowerInvariant();

    private static async Task<int?> FindAvailablePendingSlotAsync(
        SqliteConnection conn,
        SqliteTransaction tx,
        long requesterUserId,
        int maxPendingRequestsPerUser)
    {
        foreach (var slot in PendingSlots.Take(maxPendingRequestsPerUser))
        {
            var inUse = await conn.ExecuteScalarAsync<int>(
                """
                SELECT COUNT(*)
                FROM channel_requests
                WHERE requester_user_id = @requesterUserId AND status = @status AND pending_slot = @slot
                """,
                new { requesterUserId, status = ChannelRequestStatus.Pending, slot },
                tx);

            if (inUse == 0)
            {
                return slot;
            }
        }

        return null;
    }
}
