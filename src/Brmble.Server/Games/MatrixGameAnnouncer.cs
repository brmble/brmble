using Brmble.Server.Matrix;

namespace Brmble.Server.Games;

public sealed class MatrixGameAnnouncer : IGameAnnouncer
{
    private readonly MatrixService _matrix;

    public MatrixGameAnnouncer(MatrixService matrix) => _matrix = matrix;

    public Task AnnounceResultAsync(int channelId, string text)
        => _matrix.SendChannelSystemMessageAsync(channelId, text);
}
