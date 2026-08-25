using Brmble.Server.Games.Duels;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Games.Spectators;

/// <summary>
/// Channel-scoped spectator registry and fan-out.
///
/// Spectating is a CHANNEL mode, not a match view: you opt in once and keep watching
/// match after match until you explicitly stop, leave the channel, or disconnect.
/// That is why <see cref="SpectatorCloseReason"/> has no <c>MatchEnded</c> member and
/// <see cref="SpectatorSubscribeReason"/> has no <c>MatchNotLive</c> member.
///
/// Nothing here knows what a duel is. It is keyed on channel and match, so a future
/// many-player minigame fits without a contract change.
/// </summary>
public sealed class SpectatorService(
    IGameEventPublisher publisher,
    IGamePresence presence,
    ILogger<SpectatorService> logger) : ISpectatorCoordinator, ISpectatorLifecycle
{
    private const int SchemaVersion = 1;

    private sealed class ChannelEntry
    {
        /// <summary>Mumble session id → stable db user id. Both are needed: fan-out is by
        /// user id, but presence teardown arrives keyed by session id.</summary>
        public readonly Dictionary<long, long> Subscribers = [];
        public long? MatchId;
        public long LastSequence;
        public bool Ended;
        public SpectatorSnapshot? Latest;
        public IReadOnlySet<long> ParticipantUserIds = new HashSet<long>();
    }

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<int, ChannelEntry> _channels = [];
    private readonly Dictionary<long, int> _sessionChannel = [];

    // ---------- ISpectatorCoordinator: discrete, channel-scoped ----------

    public async Task<SpectatorSubscribeResult> SubscribeAsync(long sessionId, long userId, int channelId)
    {
        // Validate the requested channel against live membership rather than deriving
        // it. A concurrent channel move then fails loudly with notSameChannel instead
        // of silently subscribing the caller to the wrong channel.
        if (!presence.TryGetChannel(sessionId, out var liveChannel, out var isBrmble, out _) || !isBrmble)
            return new SpectatorSubscribeResult(false, null, SpectatorSubscribeReason.NotPresent);
        if (liveChannel != channelId)
            return new SpectatorSubscribeResult(false, null, SpectatorSubscribeReason.NotSameChannel);

        await _gate.WaitAsync();
        try
        {
            DropSessionLocked(sessionId);
            var entry = EntryLocked(channelId);
            entry.Subscribers[sessionId] = userId;
            _sessionChannel[sessionId] = channelId;

            // A participant is playing the match they were watching; they get
            // game.stateUpdated instead, so hand them no spectator snapshot for it.
            var match = entry.Ended || entry.ParticipantUserIds.Contains(userId) ? null : entry.Latest;
            return new SpectatorSubscribeResult(true, match, SpectatorSubscribeReason.None);
        }
        finally { _gate.Release(); }
    }

    public Task UnsubscribeAsync(long sessionId, long userId)
        => CloseSessionAsync(sessionId, SpectatorCloseReason.Unsubscribed);

    public async Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame)
    {
        HashSet<long> targets;
        SpectatorSnapshot snapshot;

        await _gate.WaitAsync();
        try
        {
            var entry = EntryLocked(frame.ChannelId);
            if (entry.MatchId != frame.MatchId)
            {
                // Sequences are monotonic PER MATCH, so a new match resets the mark.
                entry.MatchId = frame.MatchId;
                entry.LastSequence = 0;
                entry.Ended = false;
            }
            else if (frame.Sequence <= entry.LastSequence)
            {
                logger.LogDebug(
                    "Dropping stale spectator frame {Sequence} for match {MatchId} (have {Last}).",
                    frame.Sequence, frame.MatchId, entry.LastSequence);
                return;
            }

            entry.LastSequence = frame.Sequence;
            entry.ParticipantUserIds = frame.ParticipantUserIds;
            snapshot = new SpectatorSnapshot(
                SchemaVersion, frame.MatchId, frame.ChannelId,
                frame.Configuration.GameType, frame.Configuration.Format,
                frame.Configuration.RulesetVersion, frame.Players,
                frame.Sequence, frame.GeneratedAt, frame.View);
            entry.Latest = snapshot;
            targets = TargetsLocked(entry, frame.ParticipantUserIds);
        }
        finally { _gate.Release(); }

        if (targets.Count == 0) return;
        await publisher.PublishToUsersAsync(targets, SpectatorWire.ToSnapshotEvent(snapshot));
    }

    public async Task EndMatchAsync(
        long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome)
    {
        HashSet<long> targets;
        IReadOnlySet<long> participants;

        await _gate.WaitAsync();
        try
        {
            var entry = EntryLocked(channelId);
            // Forfeits fabricate no frame, so a match can end without ever having had
            // one; adopt the match id in that case rather than ignoring the end.
            if (entry.MatchId != matchId)
            {
                if (entry.MatchId is not null && entry.Ended is false && entry.LastSequence > 0) return;
                entry.MatchId = matchId;
                entry.LastSequence = finalSequence;
            }
            if (entry.Ended) return;

            entry.Ended = true;
            // The subscription survives — a match ending ends a match, not a
            // subscription — but the match is no longer live, so a NEW subscriber
            // must see idle rather than a finished board.
            entry.Latest = null;
            participants = entry.ParticipantUserIds;
            targets = TargetsLocked(entry, participants);
        }
        finally { _gate.Release(); }

        if (targets.Count == 0) return;
        await publisher.PublishToUsersAsync(
            targets, SpectatorWire.ToMatchEndedEvent(matchId, channelId, finalSequence, reason, outcome));
    }

    // ---------- ISpectatorCoordinator: frozen Arena surface ----------

    /// <summary>
    /// Frozen by docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md.
    /// Arena's per-match realtime ticket sits alongside channel-scoped discrete
    /// subscriptions. No continuous simulation frame may enter this service or the
    /// event bus, so there is nothing for this project to do here.
    /// </summary>
    public Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match) => Task.CompletedTask;

    /// <summary>Frozen by the Arena plan. Not read by the discrete path.</summary>
    public Task<SpectatorAuthorizationResult> AuthorizeAsync(
        long sessionId, long userId, long matchId, SpectatorRole role)
        => Task.FromResult(new SpectatorAuthorizationResult(false, role, SpectatorSubscribeReason.NotPresent));

    // ---------- ISpectatorLifecycle (bodies land in Task 4) ----------

    public Task HandleChannelChangedAsync(long sessionId, int newChannelId) => throw new NotImplementedException();
    public Task HandlePresenceLostAsync(long sessionId, SpectatorCloseReason reason) => throw new NotImplementedException();
    public Task HandleChannelRemovedAsync(int channelId) => throw new NotImplementedException();
    public Task HandleTransportDisconnectedAsync(long userId) => throw new NotImplementedException();

    // ---------- helpers (all callers hold _gate) ----------

    private ChannelEntry EntryLocked(int channelId)
    {
        if (!_channels.TryGetValue(channelId, out var entry))
            _channels[channelId] = entry = new ChannelEntry();
        return entry;
    }

    private static HashSet<long> TargetsLocked(ChannelEntry entry, IReadOnlySet<long> excluded)
        => entry.Subscribers.Values.Where(u => !excluded.Contains(u)).ToHashSet();

    private (int ChannelId, long UserId)? DropSessionLocked(long sessionId)
    {
        if (!_sessionChannel.TryGetValue(sessionId, out var channelId)) return null;
        _sessionChannel.Remove(sessionId);
        if (!_channels.TryGetValue(channelId, out var entry)) return null;
        if (!entry.Subscribers.Remove(sessionId, out var userId)) return null;
        return (channelId, userId);
    }

    /// <summary>Removes one session's subscription and tells it why. Shared by every teardown path.</summary>
    private async Task CloseSessionAsync(long sessionId, SpectatorCloseReason reason)
    {
        (int ChannelId, long UserId)? dropped;
        await _gate.WaitAsync();
        try { dropped = DropSessionLocked(sessionId); }
        finally { _gate.Release(); }

        if (dropped is null) return;
        await publisher.PublishToUsersAsync(
            new HashSet<long> { dropped.Value.UserId },
            SpectatorWire.ToClosedEvent(dropped.Value.ChannelId, reason));
    }
}
