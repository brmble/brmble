using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public class MatrixEventHandler : IMumbleEventHandler
{
    private readonly MatrixService _matrixService;

    public MatrixEventHandler(MatrixService matrixService)
    {
        _matrixService = matrixService;
    }

    public Task OnUserConnected(MumbleUser user) => Task.CompletedTask;

    public Task OnUserDisconnected(MumbleUser user) => Task.CompletedTask;

    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId)
        => _matrixService.RelayMessage(sender, text, channelId);

    public Task OnChannelCreated(MumbleChannel channel)
        => _matrixService.EnsureChannelRoom(channel);

    public Task OnChannelRemoved(MumbleChannel channel)
    {
        _matrixService.DeleteChannelRoom(channel.Id);
        return Task.CompletedTask;
    }

    public Task OnChannelRenamed(MumbleChannel channel)
        => _matrixService.RenameChannelRoom(channel);
}
