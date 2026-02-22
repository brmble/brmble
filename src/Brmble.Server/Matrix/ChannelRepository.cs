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

    public string? GetRoomId(int mumbleChannelId)
    {
        using var conn = _db.CreateConnection();
        return conn.QuerySingleOrDefault<string>(
            "SELECT matrix_room_id FROM channel_room_map WHERE mumble_channel_id = @id",
            new { id = mumbleChannelId });
    }

    public void Insert(int mumbleChannelId, string matrixRoomId)
    {
        using var conn = _db.CreateConnection();
        conn.Execute(
            "INSERT OR IGNORE INTO channel_room_map (mumble_channel_id, matrix_room_id) VALUES (@channelId, @roomId)",
            new { channelId = mumbleChannelId, roomId = matrixRoomId });
    }

    public void Delete(int mumbleChannelId)
    {
        using var conn = _db.CreateConnection();
        conn.Execute(
            "DELETE FROM channel_room_map WHERE mumble_channel_id = @id",
            new { id = mumbleChannelId });
    }

    public List<ChannelRoomMapping> GetAll()
    {
        using var conn = _db.CreateConnection();
        return conn.Query("SELECT mumble_channel_id, matrix_room_id FROM channel_room_map")
            .Select(row => new ChannelRoomMapping((int)(long)row.mumble_channel_id, (string)row.matrix_room_id))
            .ToList();
    }
}
