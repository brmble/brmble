using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Matrix;

public record ChannelRoomMapping(int MumbleChannelId, string MatrixRoomId);

public class ChannelRepository
{
    private readonly Database _db;

    public ChannelRepository(Database db)
    {
        _db = db;
    }

    public async Task<string?> GetRoomIdAsync(int mumbleChannelId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<string>(
            "SELECT matrix_room_id FROM channel_room_map WHERE mumble_channel_id = @id",
            new { id = mumbleChannelId });
    }

    public async Task InsertAsync(int mumbleChannelId, string matrixRoomId)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "INSERT OR IGNORE INTO channel_room_map (mumble_channel_id, matrix_room_id) VALUES (@channelId, @roomId)",
            new { channelId = mumbleChannelId, roomId = matrixRoomId });
    }

    public async Task DeleteAsync(int mumbleChannelId)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "DELETE FROM channel_room_map WHERE mumble_channel_id = @id",
            new { id = mumbleChannelId });
    }

    public async Task<List<ChannelRoomMapping>> GetAllAsync()
    {
        using var conn = _db.CreateConnection();
        // SQLite INTEGER maps to Int64; cast to int for the public record
        var rows = await conn.QueryAsync(
            "SELECT mumble_channel_id, matrix_room_id FROM channel_room_map");
        return rows.Select(r => new ChannelRoomMapping((int)(long)r.mumble_channel_id, (string)r.matrix_room_id)).ToList();
    }
}
