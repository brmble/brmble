using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public class MumbleServerCallback : MumbleServer.ServerCallbackDisp_
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly ILogger<MumbleServerCallback> _logger;
    private MumbleServer.ServerPrx? _serverProxy;

    public MumbleServerCallback(
        IEnumerable<IMumbleEventHandler> handlers,
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        ILogger<MumbleServerCallback> logger)
    {
        _handlers = handlers;
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
        _logger = logger;
    }

    internal void SetServerProxy(MumbleServer.ServerPrx proxy) => _serverProxy = proxy;

    // Ice overrides — called by ZeroC Ice runtime on Mumble server events.
    // Dispatch via Task.Run to avoid blocking the Ice callback thread.

    public override void userTextMessage(
        MumbleServer.User state,
        MumbleServer.TextMessage message,
        Ice.Current current)
    {
        var user = ToMumbleUser(state);
        var channelId = message.channels.FirstOrDefault();
        _logger.LogDebug("ICE callback: text message from {User} in channel {ChannelId} (length={Length})",
            user.Name, channelId, message.text?.Length ?? 0);
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

    // Dispatch methods

    public Task DispatchTextMessage(MumbleUser sender, string text, int channelId)
        => Task.WhenAll(_handlers.Select(h => h.OnUserTextMessage(sender, text, channelId)));

    public async Task DispatchUserConnected(MumbleUser user)
    {
        _sessionMapping.SetNameForSession(user.Name, user.SessionId);

        // Try cert-based resolution — await so handlers see the cert hash
        var enriched = await TryResolveCertAsync(user);

        await Task.WhenAll(_handlers.Select(h => h.OnUserConnected(enriched)));
    }

    public async Task DispatchUserDisconnected(MumbleUser user)
    {
        _sessionMapping.RemoveSession(user.SessionId);
        await _eventBus.BroadcastAsync(new { type = "userMappingRemoved", sessionId = user.SessionId });
        await Task.WhenAll(_handlers.Select(h => h.OnUserDisconnected(user)));
    }

    public Task DispatchChannelCreated(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelCreated(channel)));

    public Task DispatchChannelRemoved(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));

    public Task DispatchChannelRenamed(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRenamed(channel)));

    private async Task<MumbleUser> TryResolveCertAsync(MumbleUser user)
    {
        if (_serverProxy is null) return user;

        try
        {
            var certs = await _serverProxy.getCertificateListAsync(user.SessionId);
            if (certs is not { Length: > 0 }) return user;

            var hash = CertificateHasher.HashDer(certs[0]);
            _logger.LogDebug("Cert resolved for {User} session {Session}: hash={Hash}",
                user.Name, user.SessionId, hash);
            return user with { CertHash = hash };
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "getCertificateListAsync failed for session {Session}", user.SessionId);
            return user;
        }
    }

    // Mappers — no cert hash in Ice User state; OG clients are never Brmble clients

    private static MumbleUser ToMumbleUser(MumbleServer.User state) =>
        new(state.name, string.Empty, state.session);

    private static MumbleChannel ToMumbleChannel(MumbleServer.Channel state) =>
        new(state.id, state.name);
}
