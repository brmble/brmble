namespace Brmble.Server.Mumble;

public class MumbleServerCallback
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;

    public MumbleServerCallback(IEnumerable<IMumbleEventHandler> handlers)
    {
        _handlers = handlers;
    }

    public Task DispatchTextMessage(MumbleUser sender, string text, int channelId)
        => Task.WhenAll(_handlers.Select(h => h.OnUserTextMessage(sender, text, channelId)));

    public Task DispatchUserConnected(MumbleUser user)
        => Task.WhenAll(_handlers.Select(h => h.OnUserConnected(user)));

    public Task DispatchUserDisconnected(MumbleUser user)
        => Task.WhenAll(_handlers.Select(h => h.OnUserDisconnected(user)));

    public Task DispatchChannelCreated(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelCreated(channel)));

    public Task DispatchChannelRemoved(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));

    public Task DispatchChannelRenamed(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRenamed(channel)));
}
