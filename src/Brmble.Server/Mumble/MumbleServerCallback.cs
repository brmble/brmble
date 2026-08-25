using Brmble.Server.Auth;
using Brmble.Server.Events;
using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Spectators;
using Brmble.Server.LiveKit;
using Brmble.Server.Paint;

namespace Brmble.Server.Mumble;

public class MumbleServerCallback : MumbleServer.ServerCallbackDisp_
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly IMappingEventPublisher _publisher;
    private readonly IChannelMembershipService _channelMembership;
    private readonly ScreenShareTracker _screenShareTracker;
    private readonly ILiveKitParticipantRevocationScheduler _liveKitRevocationScheduler;
    private readonly LiveKitParticipantTracker _liveKitParticipantTracker;
    private readonly IDuelOrchestrator _duels;
    private readonly IPaintParticipationLifecycle _paintParticipation;
    private readonly ISpectatorLifecycle _spectators;
    private readonly ILogger<MumbleServerCallback> _logger;
    private MumbleServer.ServerPrx? _serverProxy;

    public MumbleServerCallback(
        IEnumerable<IMumbleEventHandler> handlers,
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        IMappingEventPublisher publisher,
        IChannelMembershipService channelMembership,
        ScreenShareTracker screenShareTracker,
        ILiveKitParticipantRevocationScheduler liveKitRevocationScheduler,
        LiveKitParticipantTracker liveKitParticipantTracker,
        IDuelOrchestrator duels,
        IPaintParticipationLifecycle paintParticipation,
        ISpectatorLifecycle spectators,
        ILogger<MumbleServerCallback> logger)
    {
        _handlers = handlers;
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
        _publisher = publisher;
        _channelMembership = channelMembership;
        _screenShareTracker = screenShareTracker;
        _liveKitRevocationScheduler = liveKitRevocationScheduler;
        _liveKitParticipantTracker = liveKitParticipantTracker;
        _duels = duels;
        _paintParticipation = paintParticipation;
        _spectators = spectators;
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

        // Ahead of every destructive step below: the session mapping and channel membership
        // this drop is decided against are both about to be torn down.
        await TryNotifySpectatorsAsync(
            () => _spectators.HandlePresenceLostAsync(user.SessionId, SpectatorCloseReason.Disconnected),
            "user disconnect", user.SessionId);

        // Check if user was sharing and stop all shares before removing session
        var snapshot = _sessionMapping.GetSnapshot();
        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
            await TryNotifyDuelsAsync(
                () => _duels.HandlePresenceLostAsync(mapping.UserId, user.SessionId, DuelCancelReason.Disconnected),
                "user disconnect", user.SessionId);
            DispatchPaintParticipation(
                () => _paintParticipation.HandleSessionDisconnectedAsync(user.SessionId),
                "disconnect",
                user.SessionId);
            stoppedRooms = _screenShareTracker.StopAllByUserId(mapping.UserId);
        }

        _liveKitParticipantTracker.MarkSessionRevoking(user.SessionId);
        var revokedRecords = _liveKitParticipantTracker.RemoveBySession(user.SessionId);
        // RemoveSession stays in place, ordered against the LiveKit and channel-membership
        // cleanup around it. The publish is hoisted here so the mutation and the revision read
        // are one atomic unit; PublishAsync only enqueues, so the fan-out is still awaited
        // below, in the position the broadcast previously occupied.
        var removalSend = _publisher.PublishAsync(
            () =>
            {
                _sessionMapping.RemoveSession(user.SessionId);
                return true;
            },
            envelope => new
            {
                type = "userMappingRemoved",
                instanceId = envelope.InstanceId,
                baseRevision = envelope.BaseRevision,
                revision = envelope.Revision,
                sessionId = user.SessionId
            });
        _channelMembership.Remove(user.SessionId);

        if (snapshot.TryGetValue(user.SessionId, out mapping))
        {
            foreach (var roomName in stoppedRooms)
            {
                await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = mapping.UserId });
            }
        }

        await _liveKitRevocationScheduler.RevokeParticipants(revokedRecords);

        await removalSend;
        await Task.WhenAll(_handlers.Select(h => h.OnUserDisconnected(user)));
    }

    public async Task DispatchUserStateChanged(MumbleUser user, int channelId)
    {
        var channelChanged = !_channelMembership.TryGetChannel(user.SessionId, out var previousChannel)
            || previousChannel != channelId;
        var snapshot = _sessionMapping.GetSnapshot();
        if (channelChanged && snapshot.TryGetValue(user.SessionId, out var mapped))
            await TryNotifyDuelsAsync(
                () => _duels.HandlePresenceLostAsync(mapped.UserId, user.SessionId, DuelCancelReason.LeftChannel),
                "channel change", user.SessionId);

        if (channelChanged)
            DispatchPaintParticipation(
                () => _paintParticipation.HandleSessionChannelChangedAsync(user.SessionId, previousChannel, channelId),
                "channel change",
                user.SessionId);

        // AUTHORITATIVE NOTE on this ordering. Two other comments point here rather than
        // restating it: the XML doc on SpectatorService.HandleChannelChangedAsync, and
        // DispatchUserStateChanged_DropsSpectatorSubscriptionBeforeMembershipUpdate.
        //
        // Ordered before the membership update because a redundant user-state dispatch — the
        // same channel reported twice — must not kill a live subscription, and the lifecycle
        // decides that by comparing channelId against its OWN subscription table.
        //
        // It does NOT read IChannelMembershipService, so this ordering is not what makes the
        // drop correct; inverting it would still drop the subscription. Inverting would in
        // fact be STRICTLY BETTER for one race, so this order is the worse of the two rather
        // than a neutral choice: as it stands, between here and Update a concurrent
        // SubscribeAsync for the OLD channel still sees the old membership via IGamePresence,
        // passes the same-channel gate, and re-subscribes a session that has already left.
        // With Update first, that subscribe fails NotSameChannel, and a subscribe for the NEW
        // channel writes _sessionChannel[session] = newChannelId so this call then sees
        // subscribed == newChannelId and correctly does nothing.
        //
        // The order is nevertheless mandated by the spectating spec and pinned by a test, so
        // leave it, and accept the race. Its consequence is a session subscribed to a channel
        // it has already left — cross-channel spectating, an explicit non-goal — until that
        // session's next channel move or disconnect drops the subscription.
        //
        // Moving SubscribeAsync's presence.TryGetChannel read under SpectatorService._gate
        // is a NO-OP for this race. Do not implement it and believe the race closed.
        // HandleChannelChangedAsync acquires and RELEASES _gate before returning, and only
        // then does Update run, so a SubscribeAsync landing entirely in that window reads the
        // old channel whether it reads inside the gate or outside it. The read is stale on
        // both sides of the gate; the race is a function of the CALL-SITE ordering here, not
        // of the lock scope. Only two things would actually close it:
        //   (a) inverting the order below — Update first — which the spec forbids and
        //       DispatchUserStateChanged_DropsSpectatorSubscriptionBeforeMembershipUpdate pins; or
        //   (b) having HandleChannelChangedAsync write _sessionChannel[sessionId] = newChannelId
        //       under the gate as a tombstone instead of merely removing the entry, so a later
        //       subscribe for the OLD channel is rejected against the service's own state
        //       rather than against stale presence.
        await TryNotifySpectatorsAsync(
            () => _spectators.HandleChannelChangedAsync(user.SessionId, channelId),
            "channel change", user.SessionId);

        _channelMembership.Update(user.SessionId, channelId);
        var currentRoom = $"channel-{channelId}";
        _liveKitParticipantTracker.MarkSessionRoom(user.SessionId, currentRoom);

        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
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
            await _liveKitRevocationScheduler.RevokeParticipants(revokedRecords);
        }
    }

    public Task DispatchChannelCreated(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelCreated(channel)));

    public async Task DispatchChannelRemoved(MumbleChannel channel)
    {
        await TryNotifySpectatorsAsync(
            () => _spectators.HandleChannelRemovedAsync(channel.Id), "channel removal", channel.Id);
        await TryNotifyDuelsAsync(() => _duels.HandleChannelRemovedAsync(channel.Id), "channel removal", channel.Id);
        await Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));
    }

    private async Task TryNotifyDuelsAsync(Func<Task> notify, string operation, long id)
    {
        try
        {
            await notify();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Duel cleanup failed during {Operation} for {Id}", operation, id);
        }
    }

    /// <summary>
    /// Mirrors <see cref="TryNotifyDuelsAsync"/>: spectator teardown is best-effort and must
    /// never break a Mumble dispatch. A failed drop leaves a subscription that the next
    /// teardown or an explicit unsubscribe will clear.
    /// </summary>
    private async Task TryNotifySpectatorsAsync(Func<Task> notify, string operation, long id)
    {
        try
        {
            await notify();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Spectator teardown failed during {Operation} for {Id}", operation, id);
        }
    }

    public Task DispatchChannelRenamed(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRenamed(channel)));

    public Task DispatchExistingUsersSnapshot(IReadOnlyDictionary<int, MumbleServer.User> users)
        => Task.WhenAll(users.Values.Select(state =>
            DispatchUserConnected(ToMumbleUser(state), state.channel)));

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

    private void DispatchPaintParticipation(Func<Task> operation, string operationName, int sessionId)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await operation();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Paint participation {Operation} failed for Mumble session {Session}", operationName, sessionId);
            }
        });
    }

    // Mappers — no cert hash in Ice User state; OG clients are never Brmble clients

    private static MumbleUser ToMumbleUser(MumbleServer.User state) =>
        new(state.name, string.Empty, state.session);

    private static MumbleChannel ToMumbleChannel(MumbleServer.Channel state) =>
        new(state.id, state.name);
}
