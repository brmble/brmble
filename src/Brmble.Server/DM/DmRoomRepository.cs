using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.DM;

public record DmRoomMapping(long UserIdLow, long UserIdHigh, string MatrixRoomId);

public record DmRoomForUser(string OtherMatrixUserId, string MatrixRoomId);

public class DmRoomRepository
{
    private readonly Database _db;

    public DmRoomRepository(Database db)
    {
        _db = db;
    }

    /// <summary>
    /// Look up the DM room for a canonical user pair (low &lt; high).
    /// </summary>
    public async Task<string?> GetRoomIdAsync(long userIdLow, long userIdHigh)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<string>(
            "SELECT matrix_room_id FROM dm_room_map WHERE user_id_low = @low AND user_id_high = @high",
            new { low = userIdLow, high = userIdHigh });
    }

    /// <summary>
    /// Insert a new DM room mapping. Uses INSERT OR IGNORE for idempotency.
    /// </summary>
    public async Task InsertAsync(long userIdLow, long userIdHigh, string matrixRoomId)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT OR IGNORE INTO dm_room_map (user_id_low, user_id_high, matrix_room_id) VALUES (@low, @high, @roomId)",
            new { low = userIdLow, high = userIdHigh, roomId = matrixRoomId });
    }

    /// <summary>
    /// Get all DM rooms for a given user, returning the other user's Matrix ID and the room ID.
    /// </summary>
    public async Task<List<DmRoomForUser>> GetAllForUserAsync(long userId)
    {
        using var conn = _db.CreateConnection();
        var rows = await conn.QueryAsync(
            """
            SELECT u.matrix_user_id AS other_matrix_user_id, d.matrix_room_id
            FROM dm_room_map d
            JOIN users u ON u.id = CASE WHEN d.user_id_low = @id THEN d.user_id_high ELSE d.user_id_low END
            WHERE d.user_id_low = @id OR d.user_id_high = @id
            """,
            new { id = userId });
        return rows.Select(r => new DmRoomForUser((string)r.other_matrix_user_id, (string)r.matrix_room_id)).ToList();
    }
}
