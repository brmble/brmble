using System.Collections.Concurrent;
using System.Text.Json;

namespace Brmble.Server.Games;

public interface IGameEventPublisher
{
    Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message);
    Task PublishToChannelAsync(int channelId, object message);
}

public interface IGamePresence
{
    // Resolves a live Brmble session id to its channel, Brmble status, and stable
    // database user id. Games operate in Mumble session-id space (the identity the
    // web/client speak); the stable userId is used only for routing and persistence.
    bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId);

    // Resolves a live session id to a human-readable display name for chat
    // announcements. Returns null if unknown.
    string? GetDisplayName(long sessionId);

    // Returns true if the given live session's user has blocked all game challenges.
    // Read live (per-invite) so runtime toggles take effect immediately.
    Task<bool> AreChallengesBlockedAsync(long sessionId);
}

public enum InviteRejectReason { None, Blocked, ChannelBusy }

public record InviteResult(bool Success, long MatchId, string? Error, InviteRejectReason Reason = InviteRejectReason.None);

public sealed class GameSessionManager
{
    private static readonly TimeSpan InviteTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan TurnTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PenaltyTimeout = TimeSpan.FromSeconds(5);
    private const int MetadataSchemaVersion = 1;

    private readonly IReadOnlyDictionary<string, IGameEngine> _engines;
    private readonly IRandomSource _rng;
    private readonly IGamePresence _presence;
    private readonly IGameEventPublisher _publisher;
    private readonly GameRepository _repository;

    private readonly ConcurrentDictionary<long, LiveMatch> _matches = new();
    private readonly ConcurrentDictionary<long, long> _userToMatch = new();
    private long _matchIdCounter;

    public GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGamePresence presence,
        IGameEventPublisher publisher,
        GameRepository repository)
    {
        _engines = engines.ToDictionary(e => e.GameType, StringComparer.OrdinalIgnoreCase);
        _rng = rng;
        _presence = presence;
        _publisher = publisher;
        _repository = repository;
    }

    private sealed class LiveMatch
    {
        public required long MatchId;
        public required string GameType;
        public required IGameEngine Engine;
        public required object State;
        public required long[] Players; // [inviter, target] as Mumble session ids
        public required IReadOnlyDictionary<long, long> SessionToUser; // session id -> stable db user id
        public required IReadOnlyDictionary<long, string> SessionToName; // session id -> display name
        public required int ChannelId;
        public string Status = "pending"; // pending | live | done
        public DateTimeOffset StartedAt;
        public Timer? InviteTimer;
        public Timer? TurnTimer;
        // Bumped every time a turn timer is (re)started. A queued timeout callback
        // whose generation is stale must bail — Timer.Dispose() doesn't wait for an
        // in-flight callback, so without this a penalty could hit the wrong player.
        public long TurnGeneration;
        public readonly object Lock = new();
    }

    public async Task<InviteResult> InviteAsync(long inviterSession, long targetSession, string gameType,
        IReadOnlyDictionary<string, object?>? options = null)
    {
        if (inviterSession == targetSession)
            return new InviteResult(false, 0, "You cannot invite yourself.");

        if (!_engines.TryGetValue(gameType, out var engine))
            return new InviteResult(false, 0, $"Unknown game type '{gameType}'.");

        if (!_presence.TryGetChannel(inviterSession, out var inviterChannel, out var inviterBrmble, out var inviterUserId) || !inviterBrmble)
            return new InviteResult(false, 0, "You must be connected to Brmble to start a game.");

        if (!_presence.TryGetChannel(targetSession, out var targetChannel, out var targetBrmble, out var targetUserId) || !targetBrmble)
            return new InviteResult(false, 0, "The other player must be connected to Brmble.");

        if (await _presence.AreChallengesBlockedAsync(targetSession))
            return new InviteResult(false, 0, "This player isn't accepting challenges.", InviteRejectReason.Blocked);

        if (inviterChannel != targetChannel)
            return new InviteResult(false, 0, "You must be in the same channel to start a game.");

        // One duel per channel: the spectator feed posts to the whole channel, so a
        // second concurrent (or even pending) duel would interleave confusingly.
        if (_matches.Values.Any(m => m.ChannelId == inviterChannel && m.Status != "done"))
            return new InviteResult(false, 0, "A duel is already in progress in this channel.", InviteRejectReason.ChannelBusy);

        if (_userToMatch.ContainsKey(inviterSession))
            return new InviteResult(false, 0, "You already have an active game.");

        if (_userToMatch.ContainsKey(targetSession))
            return new InviteResult(false, 0, "The other player already has an active game.");

        var matchId = Interlocked.Increment(ref _matchIdCounter);
        var players = new[] { new GamePlayer(inviterSession), new GamePlayer(targetSession) };
        var match = new LiveMatch
        {
            MatchId = matchId,
            GameType = gameType,
            Engine = engine,
            State = engine.InitialState(players, _rng, options),
            Players = new[] { inviterSession, targetSession },
            SessionToUser = new Dictionary<long, long>
            {
                [inviterSession] = inviterUserId,
                [targetSession] = targetUserId,
            },
            SessionToName = new Dictionary<long, string>
            {
                [inviterSession] = _presence.GetDisplayName(inviterSession) ?? $"user {inviterSession}",
                [targetSession] = _presence.GetDisplayName(targetSession) ?? $"user {targetSession}",
            },
            ChannelId = inviterChannel,
        };

        if (!_userToMatch.TryAdd(inviterSession, matchId))
            return new InviteResult(false, 0, "You already have an active game.");
        if (!_userToMatch.TryAdd(targetSession, matchId))
        {
            _userToMatch.TryRemove(inviterSession, out _);
            return new InviteResult(false, 0, "The other player already has an active game.");
        }

        _matches[matchId] = match;

        await _publisher.PublishToUsersAsync(
            new HashSet<long> { targetUserId },
            new { type = "game.invited", matchId, gameType, from = inviterSession, inviteMs = (int)InviteTimeout.TotalMilliseconds });

        // Tell the challenger their invite is pending so they can show a "waiting for
        // opponent" notification and cancel it. The WebView client posts invites
        // fire-and-forget (no response body), so this event is how it learns the
        // matchId of its own outgoing invite.
        await _publisher.PublishToUsersAsync(
            new HashSet<long> { inviterUserId },
            new { type = "game.invitePending", matchId, gameType, target = targetSession, inviteMs = (int)InviteTimeout.TotalMilliseconds });

        match.InviteTimer = new Timer(_ => OnInviteExpired(matchId), null, InviteTimeout, Timeout.InfiniteTimeSpan);

        // Mark the channel busy as soon as the invite is pending (not just when it goes
        // live): the server already treats a pending duel as busy for enforcement, so the
        // channel-tree badge should reflect that too.
        await PublishDuelStateAsync(match, active: true);

        return new InviteResult(true, matchId, null);
    }

    // Maps a match's Mumble session players to the stable db user ids used for
    // WebSocket routing.
    private static IReadOnlySet<long> RouteSet(LiveMatch match)
        => match.SessionToUser.Values.ToHashSet();

    private void OnInviteExpired(long matchId)
    {
        _ = EndPendingAsync(matchId, "game.expired");
    }

    // Test hook: simulate the 30s invite timer firing.
    internal Task ExpireInviteForTestAsync(long matchId) => EndPendingAsync(matchId, "game.expired");

    public async Task RespondAsync(long matchId, long targetSession, bool accept)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        if (accept)
        {
            object[] views;
            lock (match.Lock)
            {
                if (match.Status != "pending") return;
                if (match.Players[1] != targetSession) return;
                match.InviteTimer?.Dispose();
                match.InviteTimer = null;
                match.Status = "live";
                match.StartedAt = DateTimeOffset.UtcNow;
                views = match.Players
                    .Select(p => (object)new { userId = p, view = match.Engine.PublicView(match.State, p) })
                    .ToArray();
            }
            await _publisher.PublishToUsersAsync(
                RouteSet(match),
                new
                {
                    type = "game.started",
                    matchId,
                    gameType = match.GameType,
                    firstTurn = IsSimultaneous(match) ? (long?)null : CurrentPlayer(match),
                    turnMs = (int)TurnTimeout.TotalMilliseconds,
                    penalty = false,
                    views,
                });
            await PublishDuelStateAsync(match, active: true);
            var startLine = match.Engine.StartFeedLine(match.State, sid => NameOf(match, sid))
                ?? $"⚔️ {NameOf(match, match.Players[0])} vs {NameOf(match, match.Players[1])} — {GameName(match.GameType)} started";
            await PublishFeedAsync(match, startLine);
            StartTurnTimer(match, TurnTimeout);
        }
        else
        {
            // Only a participant may decline/cancel a pending invite. Match ids are a
            // guessable sequential counter, so without this any connected user could
            // cancel someone else's invite.
            if (match.Players[0] != targetSession && match.Players[1] != targetSession) return;
            await EndPendingAsync(matchId, "game.declined");
        }
    }

    private async Task EndPendingAsync(long matchId, string eventType)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;
        lock (match.Lock)
        {
            if (match.Status != "pending") return;
            match.Status = "done";
            match.InviteTimer?.Dispose();
            match.InviteTimer = null;
        }
        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new { type = eventType, matchId });
        // The pending invite made the channel busy; clear the badge now that it's gone.
        await PublishDuelStateAsync(match, active: false);
        foreach (var p in match.Players) _userToMatch.TryRemove(p, out _);
        _matches.TryRemove(matchId, out _);
    }

    public async Task ActionAsync(long matchId, long sessionId, IReadOnlyDictionary<string, object?> action)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        IReadOnlyList<GameEvent> events;
        bool finished;
        object[] views;
        lock (match.Lock)
        {
            if (match.Status != "live") return;
            try
            {
                events = match.Engine.ApplyAction(match.State, sessionId, action, _rng);
            }
            catch (InvalidGameActionException ex)
            {
                var rejectRoute = match.SessionToUser.TryGetValue(sessionId, out var rejectUserId)
                    ? new HashSet<long> { rejectUserId }
                    : new HashSet<long> { sessionId };
                _ = _publisher.PublishToUsersAsync(
                    rejectRoute,
                    new { type = "game.actionRejected", matchId, reason = ex.Message });
                return;
            }
            finished = match.Engine.GetOutcome(match.State) is GameOutcome.Finished;
            if (finished) DisposeTimers(match);
            // Alternating games advance the turn every action, so the timer always
            // restarts. Simultaneous games keep one commit window per round: only
            // restart when a round actually resolved (both players committed).
            else if (ShouldRestartTurnTimer(match, events)) StartTurnTimer(match, TurnTimeout);
            // Capture the snapshot inside the lock so a concurrent mutation can't
            // cause an inconsistent view to be broadcast.
            views = match.Players
                .Select(p => (object)new { userId = p, view = match.Engine.PublicView(match.State, p) })
                .ToArray();
        }

        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new
            {
                type = "game.stateUpdated",
                matchId,
                gameType = match.GameType,
                turnMs = (int)TurnTimeout.TotalMilliseconds,
                penalty = false,
                views,
                events = events.Select(e => new { e.Kind, e.Data }).ToArray(),
            });

        if (!finished) await BroadcastRollFeedAsync(match, events);
        if (finished) await CompleteMatchAsync(match);
    }

    private void StartTurnTimer(LiveMatch match, TimeSpan due)
    {
        match.TurnTimer?.Dispose();
        // Capture the generation this timer belongs to. If the callback is already
        // queued when we restart the timer, it will see a newer generation and bail.
        var generation = Interlocked.Increment(ref match.TurnGeneration);
        match.TurnTimer = new Timer(_ => OnTurnTimeout(match.MatchId, generation), null, due, Timeout.InfiniteTimeSpan);
    }

    private void OnTurnTimeout(long matchId, long generation)
    {
        _ = HandleTurnTimeoutAsync(matchId, generation);
    }

    private async Task HandleTurnTimeoutAsync(long matchId, long generation)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        IReadOnlyList<GameEvent> events;
        bool finished;
        bool simultaneous;
        object[] views;
        lock (match.Lock)
        {
            if (match.Status != "live") return;
            // Stale callback: the turn advanced (a roll restarted the timer) between
            // this timeout firing and acquiring the lock. Don't penalise the new
            // current player for the previous player's inaction.
            if (Interlocked.Read(ref match.TurnGeneration) != generation) return;
            simultaneous = IsSimultaneous(match);
            events = match.Engine.ApplyTimeoutPenalty(match.State, _rng);
            finished = match.Engine.GetOutcome(match.State) is GameOutcome.Finished;
            // Alternating (Deathroll): escalate with a shorter 5s penalty window.
            // Simultaneous (RPS): the round just resolved by timeout — the next round
            // gets a full commit window.
            if (!finished) StartTurnTimer(match, simultaneous ? TurnTimeout : PenaltyTimeout);
            else DisposeTimers(match);
            views = match.Players
                .Select(p => (object)new { userId = p, view = match.Engine.PublicView(match.State, p) })
                .ToArray();
        }

        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new
            {
                type = "game.stateUpdated",
                matchId,
                gameType = match.GameType,
                turnMs = (int)(simultaneous ? TurnTimeout : PenaltyTimeout).TotalMilliseconds,
                penalty = !simultaneous,
                views,
                events = events.Select(e => new { e.Kind, e.Data }).ToArray(),
            });

        if (!finished) await BroadcastRollFeedAsync(match, events);
        if (finished) await CompleteMatchAsync(match);
    }

    private async Task CompleteMatchAsync(LiveMatch match)
    {
        lock (match.Lock)
        {
            if (match.Status == "done") return;
            match.Status = "done";
            DisposeTimers(match);
        }

        var outcome = (GameOutcome.Finished)match.Engine.GetOutcome(match.State);
        // Engine participants are keyed by Mumble session id; translate to stable
        // db user ids for persistence so stats remain stable across reconnects.
        var persistedParticipants = outcome.Participants
            .Select(p =>
            {
                var meta = BuildParticipantMetadata(match, p.UserId); // p.UserId = session id here
                var dbId = match.SessionToUser.TryGetValue(p.UserId, out var id) ? id : p.UserId;
                return p with { UserId = dbId, MetadataJson = meta };
            })
            .ToArray();
        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: match.Engine.MatchFormat(match.State),
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: persistedParticipants,
            MetadataJson: BuildMatchMetadata(match));

        await _repository.SaveCompletedMatchAsync(completed);

        var winner = outcome.Participants.FirstOrDefault(p => p.Placement == 1);

        // winner.UserId is still a Mumble session id here (translation to db ids
        // happens in persistedParticipants above), which is what the client compares
        // against its own session id — so emit it directly as winnerId.
        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new { type = "game.ended", matchId = match.MatchId, gameType = match.GameType, winnerId = winner?.UserId });

        await PublishDuelStateAsync(match, active: false);

        var feedText = match.Engine.EndFeedLine(match.State, sid => NameOf(match, sid))
            ?? (winner is not null
                ? $"🏆 {NameOf(match, winner.UserId)} wins!"
                : $"{GameName(match.GameType)} over.");
        await PublishFeedAsync(match, feedText);

        foreach (var p in match.Players) _userToMatch.TryRemove(p, out _);
        _matches.TryRemove(match.MatchId, out _);
    }

    public async Task ForfeitAsync(long matchId, long sessionId, string reason)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        // Only an actual participant may forfeit. Match ids are a guessable
        // sequential counter and /games/forfeit only proves a valid session, so
        // without this any authenticated user could end any live match (and get
        // persisted as a bogus loser via the SessionToUser fallback below).
        if (!match.SessionToUser.ContainsKey(sessionId)) return;

        // A pending (not-yet-accepted) invite has no result to persist. Cancel it
        // outright so a disconnect/channel-change while an invite is in flight
        // doesn't leave both players blocked until the 30s invite timer expires.
        if (match.Status == "pending")
        {
            await EndPendingAsync(matchId, "game.expired");
            return;
        }

        lock (match.Lock)
        {
            if (match.Status != "live") return;
            match.Status = "done";
            DisposeTimers(match);
        }

        var otherId = match.Players[0] == sessionId ? match.Players[1] : match.Players[0];
        var winnerDbId = match.SessionToUser.TryGetValue(otherId, out var wId) ? wId : otherId;
        var loserDbId = match.SessionToUser.TryGetValue(sessionId, out var lId) ? lId : sessionId;
        var participants = new[]
        {
            new CompletedParticipant(winnerDbId, Placement: 1, Score: null, Result: "win",
                MetadataJson: BuildParticipantMetadata(match, otherId)),
            new CompletedParticipant(loserDbId, Placement: 2, Score: null, Result: "abandoned",
                MetadataJson: BuildParticipantMetadata(match, sessionId)),
        };
        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: match.Engine.MatchFormat(match.State),
            Outcome: "abandoned",
            AbandonReason: reason,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: participants,
            MetadataJson: BuildMatchMetadata(match));

        await _repository.SaveCompletedMatchAsync(completed);

        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new { type = "game.ended", matchId, gameType = match.GameType, abandoned = true, reason, winnerId = otherId });

        await PublishDuelStateAsync(match, active: false);

        await PublishFeedAsync(match,
            $"🏳️ {NameOf(match, sessionId)} forfeited — {NameOf(match, otherId)} wins!");

        foreach (var p in match.Players) _userToMatch.TryRemove(p, out _);
        _matches.TryRemove(matchId, out _);
    }

    private static string NameOf(LiveMatch match, long sessionId)
        => match.SessionToName.TryGetValue(sessionId, out var name) ? name : $"user {sessionId}";

    private static string BuildMatchMetadata(LiveMatch match)
        => JsonSerializer.Serialize(new
        {
            schemaVersion = MetadataSchemaVersion,
            summary = match.Engine.MatchSummary(match.State),
        });

    // Keyed by SESSION id (matches SessionToName and engine state keys).
    private static string BuildParticipantMetadata(LiveMatch match, long sessionId)
    {
        var envelope = new Dictionary<string, object?>
        {
            ["schemaVersion"] = MetadataSchemaVersion,
            ["displayName"] = NameOf(match, sessionId),
        };
        var stats = match.Engine.ParticipantStats(match.State, sessionId);
        if (stats is not null) envelope[match.GameType] = stats;
        return JsonSerializer.Serialize(envelope);
    }

    // Ephemeral spectator feed: composed by the server and broadcast to everyone
    // in the match's channel. Never persisted to Matrix — reconnecting users
    // never see it.
    private Task PublishFeedAsync(LiveMatch match, string text)
        => _publisher.PublishToChannelAsync(match.ChannelId, new
        {
            type = "game.feed",
            channelId = match.ChannelId,
            gameType = match.GameType,
            matchId = match.MatchId,
            text,
        });

    // Turns non-terminal engine events (rolls, RPS rounds, timeout penalties) into
    // feed lines using the engine's own wording. Terminal loss/forfeit lines are
    // emitted by CompleteMatchAsync/ForfeitAsync.
    private async Task BroadcastRollFeedAsync(LiveMatch match, IReadOnlyList<GameEvent> events)
    {
        foreach (var e in events)
        {
            var text = match.Engine.EventFeedLine(e, sid => NameOf(match, sid));
            if (text is not null) await PublishFeedAsync(match, text);
        }
    }

    // Signals the whole channel that a duel is pending/live or has ended so clients can
    // show a "duel in progress" indicator. Fired when an invite is created (pending),
    // when it goes live, and when it ends (declined/expired/completed/abandoned).
    private Task PublishDuelStateAsync(LiveMatch match, bool active)
        => _publisher.PublishToChannelAsync(match.ChannelId, new
        {
            type = "game.duelState",
            channelId = match.ChannelId,
            gameType = match.GameType,
            matchId = match.MatchId,
            active,
        });

    private static bool IsSimultaneous(LiveMatch match)
        => match.Engine.InteractionModel == InteractionModel.SimultaneousCommit;

    // Whether an applied action should restart the turn timer. Alternating games
    // advance the turn every action; simultaneous games keep one commit window per
    // round and only restart when a round resolves (signalled by a roundResult event).
    private static bool ShouldRestartTurnTimer(LiveMatch match, IReadOnlyList<GameEvent> events)
        => !IsSimultaneous(match) || events.Any(e => e.Kind == "roundResult");

    private static string GameName(string gameType)
        => string.IsNullOrEmpty(gameType) ? gameType : char.ToUpperInvariant(gameType[0]) + gameType[1..];

    public bool TryGetActiveMatch(long userId, out long matchId)
        => _userToMatch.TryGetValue(userId, out matchId);

    public bool IsMatchLive(long matchId)
        => _matches.TryGetValue(matchId, out var match) && match.Status == "live";

    public long GetCurrentPlayer(long matchId)
        => _matches.TryGetValue(matchId, out var match) ? CurrentPlayer(match) : 0;

    private static long CurrentPlayer(LiveMatch match)
    {
        foreach (var p in match.Players)
            if (match.Engine.IsUsersTurn(match.State, p)) return p;
        return 0;
    }

    private static void DisposeTimers(LiveMatch match)
    {
        match.InviteTimer?.Dispose();
        match.InviteTimer = null;
        match.TurnTimer?.Dispose();
        match.TurnTimer = null;
    }
}
