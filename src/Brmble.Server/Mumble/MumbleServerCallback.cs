namespace Brmble.Server.Mumble;

public class MumbleServerCallback : MumbleServer.ServerCallbackDisp_
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;
    private readonly ILogger<MumbleServerCallback> _logger;

    public MumbleServerCallback(IEnumerable<IMumbleEventHandler> handlers, ILogger<MumbleServerCallback> logger)
    {
        _handlers = handlers;
        _logger = logger;
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
        _logger.LogDebug("ICE callback: text message from {User} in channel {ChannelId}", user.Name, channelId);
        Task.Run(() => SafeDispatch(
            () => DispatchTextMessage(user, message.text, channelId),
            nameof(userTextMessage)));
    }

    public override void userConnected(MumbleServer.User state, Ice.Current current)
    {
        var user = ToMumbleUser(state);
        _logger.LogDebug("ICE callback: user connected {User}", user.Name);
        Task.Run(() => SafeDispatch(() => DispatchUserConnected(user), nameof(userConnected)));
    }

    public override void userDisconnected(MumbleServer.User state, Ice.Current current)
    {
        var user = ToMumbleUser(state);
        _logger.LogDebug("ICE callback: user disconnected {User}", user.Name);
        Task.Run(() => SafeDispatch(() => DispatchUserDisconnected(user), nameof(userDisconnected)));
    }

    public override void channelCreated(MumbleServer.Channel state, Ice.Current current)
    {
        var channel = ToMumbleChannel(state);
        _logger.LogDebug("ICE callback: channel created {Channel}", channel.Name);
        Task.Run(() => SafeDispatch(() => DispatchChannelCreated(channel), nameof(channelCreated)));
    }

    public override void channelRemoved(MumbleServer.Channel state, Ice.Current current)
    {
        var channel = ToMumbleChannel(state);
        _logger.LogDebug("ICE callback: channel removed {Channel}", channel.Name);
        Task.Run(() => SafeDispatch(() => DispatchChannelRemoved(channel), nameof(channelRemoved)));
    }

    public override void channelStateChanged(MumbleServer.Channel state, Ice.Current current)
    {
        var channel = ToMumbleChannel(state);
        _logger.LogDebug("ICE callback: channel renamed {Channel}", channel.Name);
        Task.Run(() => SafeDispatch(() => DispatchChannelRenamed(channel), nameof(channelStateChanged)));
    }

    private async Task SafeDispatch(Func<Task> dispatch, string callbackName)
    {
        try
        {
            await dispatch();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception dispatching {Callback}", callbackName);
        }
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
