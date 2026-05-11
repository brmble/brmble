using Brmble.Server.Auth;
using Brmble.Server.Events;
using Brmble.Server.LiveKit;

namespace Brmble.Server.Mumble;

public class MumbleServerCallback : MumbleServer.ServerCallbackDisp_
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly IChannelMembershipService _channelMembership;
    private readonly ScreenShareTracker _screenShareTracker;
    private readonly ILiveKitParticipantRemover _liveKitParticipantRemover;
    private readonly LiveKitParticipantTracker _liveKitParticipantTracker;
    private readonly ILogger<MumbleServerCallback> _logger;
    private MumbleServer.ServerPrx? _serverProxy;

    public MumbleServerCallback(
        IEnumerable<IMumbleEventHandler> handlers,
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        IChannelMembershipService channelMembership,
        ScreenShareTracker screenShareTracker,
        ILiveKitParticipantRemover liveKitParticipantRemover,
        LiveKitParticipantTracker liveKitParticipantTracker,
        ILogger<MumbleServerCallback> logger)
    {
        _handlers = handlers;
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
        _channelMembership = channelMembership;
        _screenShareTracker = screenShareTracker;
        _liveKitParticipantRemover = liveKitParticipantRemover;
        _liveKitParticipantTracker = liveKitParticipantTracker;
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
            () => DispatchTextMessage(user, message.text ?? string.Empty, channelId),
            nameof(userTextMessage)));
    }

    public override void userConnected(MumbleServer.User state, Ice.Current current)
    {
        var user = ToMumbleUser(state);
        _logger.LogDebug("ICE callback: user connected {User}", user.Name);
        Task.Run(() => SafeDispatch(() => DispatchUserConnected(user, state.channel), nameof(userConnected)));
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

    public override void userStateChanged(MumbleServer.User state, Ice.Current current)
    {
        var user = ToMumbleUser(state);
        var channelId = state.channel;
        _logger.LogDebug("ICE callback: user state changed {User} channel={Channel}", user.Name, channelId);
        Task.Run(() => SafeDispatch(
            () => DispatchUserStateChanged(user, channelId),
            nameof(userStateChanged)));
    }

    // Dispatch methods

    public Task DispatchTextMessage(MumbleUser sender, string text, int channelId)
        => Task.WhenAll(_handlers.Select(h => h.OnUserTextMessage(sender, text, channelId)));

    public async Task DispatchUserConnected(MumbleUser user, int? initialChannelId = null)
    {
        _sessionMapping.SetNameForSession(user.Name, user.SessionId);

        if (initialChannelId.HasValue)
            _channelMembership.Update(user.SessionId, initialChannelId.Value);

        // Try cert-based resolution — await so handlers see the cert hash
        var enriched = await TryResolveCertAsync(user);

        await Task.WhenAll(_handlers.Select(h => h.OnUserConnected(enriched)));

        // Attempt to fetch Mumble user texture (avatar) for registered users
        if (_serverProxy is not null && user.SessionId > 0)
        {
            try
            {
                // Get the user state to check if they're registered (userid >= 0)
                var state = await _serverProxy.getStateAsync(user.SessionId);
                if (state.userid >= 0)
                {
                    var texture = await _serverProxy.getTextureAsync(state.userid);
                    if (texture is { Length: > 0 })
                    {
                        await Task.WhenAll(_handlers.Select(h => h.OnUserTextureAvailable(enriched, texture)));
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Could not fetch texture for user {User} session {Session}", user.Name, user.SessionId);
            }
        }
    }

    public async Task DispatchUserDisconnected(MumbleUser user)
    {
        IReadOnlyList<string> stoppedRooms = [];

        // Check if user was sharing and stop all shares before removing session
        var snapshot = _sessionMapping.GetSnapshot();
        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
            stoppedRooms = _screenShareTracker.StopAllByUserId(mapping.UserId);
        }

        _liveKitParticipantTracker.MarkSessionRevoking(user.SessionId);
        var revokedRecords = _liveKitParticipantTracker.RemoveBySession(user.SessionId);
        _sessionMapping.RemoveSession(user.SessionId);
        _channelMembership.Remove(user.SessionId);

        if (snapshot.TryGetValue(user.SessionId, out mapping))
        {
            foreach (var roomName in stoppedRooms)
            {
                await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = mapping.UserId });
            }
        }

        await RevokeParticipants(revokedRecords);

        await _eventBus.BroadcastAsync(new { type = "userMappingRemoved", sessionId = user.SessionId });
        await Task.WhenAll(_handlers.Select(h => h.OnUserDisconnected(user)));
    }

    public async Task DispatchUserStateChanged(MumbleUser user, int channelId)
    {
        _channelMembership.Update(user.SessionId, channelId);

        var snapshot = _sessionMapping.GetSnapshot();
        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
            var currentRoom = $"channel-{channelId}";
            var shareRooms = _screenShareTracker.GetSharesByUserId(mapping.UserId);
            foreach (var roomName in shareRooms)
            {
                if (roomName != currentRoom)
                {
                    _screenShareTracker.StopByUserId(roomName, mapping.UserId);
                    await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = mapping.UserId });
                }
            }

            var revokedRecords = _liveKitParticipantTracker.RemoveBySessionExceptRoom(user.SessionId, currentRoom);
            await RevokeParticipants(revokedRecords);
        }
    }

    public Task DispatchChannelCreated(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelCreated(channel)));

    public Task DispatchChannelRemoved(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));

    public Task DispatchChannelRenamed(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRenamed(channel)));

    private async Task RevokeParticipants(IReadOnlyList<LiveKitParticipantRecord> records)
    {
        foreach (var record in records)
        {
            await _liveKitParticipantRemover.RemoveParticipant(record.RoomName, record.MatrixUserId);
        }
    }

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
