using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Companions;

public sealed class CustomCompanionRepository(Database database)
{
    public async Task<string?> GetRoomIdAsync()
    {
        using var connection = database.CreateConnection();
        return await connection.QuerySingleOrDefaultAsync<string>(
            "SELECT matrix_room_id FROM custom_companion_gallery_room WHERE singleton_id = 1");
    }

    public async Task SetRoomIdAsync(string roomId)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync("""
            INSERT INTO custom_companion_gallery_room (singleton_id, matrix_room_id, created_at_utc)
            VALUES (1, @RoomId, @CreatedAtUtc)
            ON CONFLICT(singleton_id) DO UPDATE SET matrix_room_id = excluded.matrix_room_id
            """, new { RoomId = roomId, CreatedAtUtc = ToUtcString(DateTimeOffset.UtcNow) });
    }

    public async Task<CustomCompanionRecord?> GetActiveByEventIdAsync(string eventId)
    {
        using var connection = database.CreateConnection();
        var row = await connection.QuerySingleOrDefaultAsync<CustomCompanionRow>("""
            SELECT event_id EventId, state_key StateKey, matrix_room_id RoomId,
                   uploader_user_id UploaderUserId, uploader_matrix_user_id UploaderMatrixUserId,
                   uploader_display_name UploaderDisplayName, name Name, media_uri MediaUri,
                   mime_type MimeType, width Width, height Height, frame_count FrameCount,
                   byte_size ByteSize, created_at_utc CreatedAtUtc, deleted_at_utc DeletedAtUtc,
                   deleted_by_user_id DeletedByUserId
            FROM custom_companion_gallery
            WHERE event_id = @EventId AND deleted_at_utc IS NULL
            """, new { EventId = eventId });
        return row is null ? null : ToRecord(row);
    }

    public async Task<IReadOnlyList<CustomCompanionRecord>> GetActiveAsync()
    {
        using var connection = database.CreateConnection();
        var rows = await connection.QueryAsync<CustomCompanionRow>("""
            SELECT event_id EventId, state_key StateKey, matrix_room_id RoomId,
                   uploader_user_id UploaderUserId, uploader_matrix_user_id UploaderMatrixUserId,
                   uploader_display_name UploaderDisplayName, name Name, media_uri MediaUri,
                   mime_type MimeType, width Width, height Height, frame_count FrameCount,
                   byte_size ByteSize, created_at_utc CreatedAtUtc, deleted_at_utc DeletedAtUtc,
                   deleted_by_user_id DeletedByUserId
            FROM custom_companion_gallery
            WHERE deleted_at_utc IS NULL
            ORDER BY created_at_utc DESC, event_id ASC
            """);
        return rows.Select(ToRecord).ToArray();
    }

    public async Task<int> CountActiveForUserAsync(long userId)
    {
        using var connection = database.CreateConnection();
        return await connection.ExecuteScalarAsync<int>("""
            SELECT COUNT(*) FROM custom_companion_gallery
            WHERE uploader_user_id = @UserId AND deleted_at_utc IS NULL
            """, new { UserId = userId });
    }

    public async Task<int> CountActiveAsync()
    {
        using var connection = database.CreateConnection();
        return await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM custom_companion_gallery WHERE deleted_at_utc IS NULL");
    }

    public async Task InsertAsync(CustomCompanionRecord record)
    {
        using var connection = database.CreateConnection();
        await connection.ExecuteAsync("""
            INSERT INTO custom_companion_gallery (
                event_id, state_key, matrix_room_id, uploader_user_id, uploader_matrix_user_id,
                uploader_display_name, name, media_uri, mime_type, width, height, frame_count,
                byte_size, created_at_utc, deleted_at_utc, deleted_by_user_id)
            VALUES (
                @EventId, @StateKey, @RoomId, @UploaderUserId, @UploaderMatrixUserId,
                @UploaderDisplayName, @Name, @MediaUri, @MimeType, @Width, @Height, @FrameCount,
                @ByteSize, @CreatedAtUtc, @DeletedAtUtc, @DeletedByUserId)
            """, new
        {
            record.EventId,
            record.StateKey,
            record.RoomId,
            record.UploaderUserId,
            record.UploaderMatrixUserId,
            record.UploaderDisplayName,
            record.Name,
            record.MediaUri,
            record.MimeType,
            record.Width,
            record.Height,
            record.FrameCount,
            record.ByteSize,
            CreatedAtUtc = ToUtcString(record.CreatedAt),
            DeletedAtUtc = record.DeletedAt is null ? null : ToUtcString(record.DeletedAt.Value),
            record.DeletedByUserId
        });
    }

    public async Task<bool> MarkDeletedAsync(string eventId, long deletedByUserId, DateTimeOffset deletedAt)
    {
        using var connection = database.CreateConnection();
        var affected = await connection.ExecuteAsync("""
            UPDATE custom_companion_gallery
            SET deleted_at_utc = @DeletedAtUtc, deleted_by_user_id = @DeletedByUserId
            WHERE event_id = @EventId AND deleted_at_utc IS NULL
            """, new
        {
            EventId = eventId,
            DeletedByUserId = deletedByUserId,
            DeletedAtUtc = ToUtcString(deletedAt)
        });
        return affected == 1;
    }

    public async Task<IReadOnlyList<long>> ResetSelectionsAsync(string eventId)
    {
        using var connection = database.CreateConnection();
        connection.Open();
        using var transaction = connection.BeginTransaction();
        var companionId = CustomCompanionId.FromEventId(eventId);
        var userIds = (await connection.QueryAsync<long>(
            "SELECT id FROM users WHERE companion_id = @CompanionId ORDER BY id", new { CompanionId = companionId }, transaction)).ToArray();
        await connection.ExecuteAsync(
            "UPDATE users SET companion_id = 'floppy' WHERE companion_id = @CompanionId",
            new { CompanionId = companionId }, transaction);
        transaction.Commit();
        return userIds;
    }

    private static string ToUtcString(DateTimeOffset value) => value.ToUniversalTime().ToString("O");

    private static CustomCompanionRecord ToRecord(CustomCompanionRow row) => new(
        row.EventId, row.StateKey, row.RoomId, row.UploaderUserId, row.UploaderMatrixUserId,
        row.UploaderDisplayName, row.Name, row.MediaUri, row.MimeType, row.Width, row.Height,
        row.FrameCount, row.ByteSize, DateTimeOffset.Parse(row.CreatedAtUtc),
        row.DeletedAtUtc is null ? null : DateTimeOffset.Parse(row.DeletedAtUtc), row.DeletedByUserId);

    private sealed class CustomCompanionRow
    {
        public required string EventId { get; init; }
        public required string StateKey { get; init; }
        public required string RoomId { get; init; }
        public long UploaderUserId { get; init; }
        public required string UploaderMatrixUserId { get; init; }
        public required string UploaderDisplayName { get; init; }
        public required string Name { get; init; }
        public required string MediaUri { get; init; }
        public required string MimeType { get; init; }
        public int Width { get; init; }
        public int Height { get; init; }
        public int FrameCount { get; init; }
        public long ByteSize { get; init; }
        public required string CreatedAtUtc { get; init; }
        public string? DeletedAtUtc { get; init; }
        public long? DeletedByUserId { get; init; }
    }
}
