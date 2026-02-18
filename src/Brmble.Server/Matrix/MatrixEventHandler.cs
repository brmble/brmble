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

    public Task OnChannelCreated(MumbleChannel channel) => Task.CompletedTask;

    public Task OnChannelRemoved(MumbleChannel channel) => Task.CompletedTask;

    public Task OnChannelRenamed(MumbleChannel channel) => Task.CompletedTask;

    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId)
    {
        // TODO: return _matrixService.RelayMessage(sender.Name, sender.CertHash, text, channelId);
        return Task.CompletedTask;
    }
}
