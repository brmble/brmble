using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public class MatrixEventHandler : IMumbleEventHandler
{
    private readonly MatrixService _matrixService;
    private readonly IActiveBrmbleSessions _activeSessions;

    public MatrixEventHandler(MatrixService matrixService, IActiveBrmbleSessions activeSessions)
    {
        _matrixService = matrixService;
        _activeSessions = activeSessions;
    }

    public Task OnUserConnected(MumbleUser user) => Task.CompletedTask;

    public Task OnUserDisconnected(MumbleUser user)
    {
        _activeSessions.UntrackMumbleName(user.Name);
        return Task.CompletedTask;
    }

    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId)
        => _matrixService.RelayMessage(sender, text, channelId);

    public Task OnChannelCreated(MumbleChannel channel)
        => _matrixService.EnsureChannelRoom(channel);

    public Task OnChannelRemoved(MumbleChannel channel)
        => _matrixService.DeleteChannelRoomAsync(channel.Id);

    public Task OnChannelRenamed(MumbleChannel channel)
        => _matrixService.RenameChannelRoom(channel);
}
