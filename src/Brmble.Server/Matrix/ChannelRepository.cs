using Brmble.Server.Data;

namespace Brmble.Server.Matrix;

public record ChannelRoomMapping(int MumbleChannelId, string MatrixRoomId);

public class ChannelRepository
{
    private readonly Database _db;

    public ChannelRepository(Database db)
    {
        _db = db;
    }

    // TODO: GetRoomId(int mumbleChannelId) → string?
    // TODO: Insert(int mumbleChannelId, string matrixRoomId)
    // TODO: Delete(int mumbleChannelId)
}
