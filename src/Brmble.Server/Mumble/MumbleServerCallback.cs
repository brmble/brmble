namespace Brmble.Server.Mumble;

public class MumbleServerCallback : MumbleServer.ServerCallbackDisp_
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;

    public MumbleServerCallback(IEnumerable<IMumbleEventHandler> handlers)
    {
        _handlers = handlers;
    }

    // Ice overrides — called by ZeroC Ice runtime on Mumble server events.
    // Dispatch via Task.Run to avoid blocking the Ice callback thread.

    public override void userTextMessage(
        MumbleServer.User state,
        MumbleServer.TextMessage message,
        Ice.Current current)
    {
        var user = ToMumbleUser(state);
        var channelId = message.channels.FirstOrDefault();
        Task.Run(() => DispatchTextMessage(user, message.text, channelId));
    }

    public override void userConnected(MumbleServer.User state, Ice.Current current)
    {
        Task.Run(() => DispatchUserConnected(ToMumbleUser(state)));
    }

    public override void userDisconnected(MumbleServer.User state, Ice.Current current)
    {
        Task.Run(() => DispatchUserDisconnected(ToMumbleUser(state)));
    }

    public override void channelCreated(MumbleServer.Channel state, Ice.Current current)
    {
        Task.Run(() => DispatchChannelCreated(ToMumbleChannel(state)));
    }

    public override void channelRemoved(MumbleServer.Channel state, Ice.Current current)
    {
        Task.Run(() => DispatchChannelRemoved(ToMumbleChannel(state)));
    }

    public override void channelStateChanged(MumbleServer.Channel state, Ice.Current current)
    {
        Task.Run(() => DispatchChannelRenamed(ToMumbleChannel(state)));
    }

    // Unused Ice callbacks — empty implementations required by the base class
    public override void userStateChanged(MumbleServer.User state, Ice.Current current) { }

    // Dispatch methods (tested in Task 6)

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

    // Mappers — no cert hash in Ice User state; OG clients are never Brmble clients

    private static MumbleUser ToMumbleUser(MumbleServer.User state) =>
        new(state.name, string.Empty, state.session);

    private static MumbleChannel ToMumbleChannel(MumbleServer.Channel state) =>
        new(state.id, state.name);
}
