using System.Collections.Concurrent;
using System.Text.Json;
using Brmble.Server.Games.Duels;

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

internal interface IGameTimerFactory
{
    IDisposable Create(TimerCallback callback, object? state, TimeSpan due);
}

internal sealed class GameTimerFactory : IGameTimerFactory
{
    public IDisposable Create(TimerCallback callback, object? state, TimeSpan due) =>
        new Timer(callback, state, due, Timeout.InfiniteTimeSpan);
}

public sealed class GameSessionManager : IDuelMatchRunner
{
    private static readonly TimeSpan TurnTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PenaltyTimeout = TimeSpan.FromSeconds(5);
    private const int MetadataSchemaVersion = 1;

    private readonly IReadOnlyDictionary<string, IGameEngine> _engines;
    private readonly IRandomSource _rng;
    private readonly IGameEventPublisher _publisher;
    private readonly ICompletedMatchSink _completedMatches;
    private readonly IGameTimerFactory _timerFactory;

    private readonly ConcurrentDictionary<long, LiveMatch> _matches = new();
    private readonly ConcurrentDictionary<long, long> _stableUserToMatch = new();
    private long _matchIdCounter;

    public GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGameEventPublisher publisher,
        ICompletedMatchSink completedMatches)
        : this(engines, rng, publisher, completedMatches, new GameTimerFactory())
    {
    }

    internal GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGameEventPublisher publisher,
        ICompletedMatchSink completedMatches,
        IGameTimerFactory timerFactory)
    {
        _engines = engines.ToDictionary(e => e.GameType, StringComparer.OrdinalIgnoreCase);
        _rng = rng;
        _publisher = publisher;
        _completedMatches = completedMatches;
        _timerFactory = timerFactory;
    }

    private sealed class LiveMatch
    {
        public required long MatchId;
        public required long ReservationId;
        public required string GameType;
        public required IGameEngine Engine;
        public required object State;
        public required long[] Players; // [inviter, target] as Mumble session ids
        public required IReadOnlyDictionary<long, long> SessionToUser; // session id -> stable db user id
        public required IReadOnlyDictionary<long, string> SessionToName; // session id -> display name
        public required int ChannelId;
        public required DuelPlayer PlayerOne;
        public required DuelPlayer PlayerTwo;
        public required DuelConfiguration Configuration;
        public string Status = "starting"; // starting | live | done
        public DateTimeOffset StartedAt;
        public IDisposable? TurnTimer;
        // Bumped every time a turn timer is (re)started. A queued timeout callback
        // whose generation is stale must bail — Timer.Dispose() doesn't wait for an
        // in-flight callback, so without this a penalty could hit the wrong player.
        public long TurnGeneration;
        public readonly object Lock = new();
    }

    public string RunnerKey => "discrete";
    public event Func<MatchCompletion, Task>? MatchCompleted;

    public async Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        if (!_engines.TryGetValue(reservation.Configuration.GameType, out var engine))
            return new GameStartResult(false, 0, null,
                $"Unknown game type '{reservation.Configuration.GameType}'.");

        var matchId = Interlocked.Increment(ref _matchIdCounter);
        var startedAt = DateTimeOffset.UtcNow;
        var match = new LiveMatch
        {
            MatchId = matchId,
            ReservationId = reservation.ReservationId,
            GameType = reservation.Configuration.GameType,
            Engine = engine,
            State = engine.InitialState(
                [new GamePlayer(reservation.PlayerOne.SessionId), new GamePlayer(reservation.PlayerTwo.SessionId)],
                _rng, reservation.Configuration.Options),
            Players = [reservation.PlayerOne.SessionId, reservation.PlayerTwo.SessionId],
            SessionToUser = new Dictionary<long, long>
            {
                [reservation.PlayerOne.SessionId] = reservation.PlayerOne.UserId,
                [reservation.PlayerTwo.SessionId] = reservation.PlayerTwo.UserId,
            },
            SessionToName = new Dictionary<long, string>
            {
                [reservation.PlayerOne.SessionId] = reservation.PlayerOne.DisplayName,
                [reservation.PlayerTwo.SessionId] = reservation.PlayerTwo.DisplayName,
            },
            ChannelId = reservation.ChannelId,
            PlayerOne = reservation.PlayerOne,
            PlayerTwo = reservation.PlayerTwo,
            Configuration = reservation.Configuration,
            Status = "starting",
            StartedAt = startedAt,
        };

        if (!_stableUserToMatch.TryAdd(reservation.PlayerOne.UserId, matchId))
            return new GameStartResult(false, 0, null, "Player one already has an active game.");
        if (!_stableUserToMatch.TryAdd(reservation.PlayerTwo.UserId, matchId))
        {
            RemoveIndex(_stableUserToMatch, reservation.PlayerOne.UserId, matchId);
            return new GameStartResult(false, 0, null, "Player two already has an active game.");
        }
        if (!_matches.TryAdd(matchId, match))
        {
            RemoveRuntime(match);
            return new GameStartResult(false, 0, null, "The match could not be started.");
        }

        try
        {
            var views = match.Players
                .Select(player => (object)new { userId = player, view = engine.PublicView(match.State, player) })
                .ToArray();
            lock (match.Lock)
            {
                if (match.Status != "starting" || !_matches.TryGetValue(matchId, out var current) || !ReferenceEquals(current, match))
                    return StartInterrupted(matchId);
                match.Status = "live";
            }
            await _publisher.PublishToUsersAsync(RouteSet(match), new
            {
                type = "game.started",
                matchId,
                gameType = match.GameType,
                format = match.Configuration.Format,
                rulesetVersion = match.Configuration.RulesetVersion,
                options = match.Configuration.Options,
                firstTurn = IsSimultaneous(match) ? (long?)null : CurrentPlayer(match),
                turnMs = (int)TurnTimeout.TotalMilliseconds,
                penalty = false,
                views,
            });
            if (!IsMatchLiveReference(match))
                return StartInterrupted(matchId);

            lock (match.Lock)
            {
                if (match.Status != "live" || !_matches.TryGetValue(matchId, out var current) || !ReferenceEquals(current, match))
                    return StartInterrupted(matchId);
                StartTurnTimer(match, TurnTimeout);
            }

            await PublishAdvisoryAsync(() => PublishDuelStateAsync(match, active: true));
            if (!IsMatchLiveReference(match))
                return StartInterrupted(matchId);

            var startLine = engine.StartFeedLine(match.State, sid => NameOf(match, sid))
                ?? $"⚔️ {NameOf(match, match.Players[0])} vs {NameOf(match, match.Players[1])} — {GameName(match.GameType)} started";
            await PublishAdvisoryAsync(() => PublishFeedAsync(match, startLine));
            if (!IsMatchLiveReference(match))
                return StartInterrupted(matchId);
            return new GameStartResult(true, matchId, startedAt, null);
        }
        catch (Exception ex)
        {
            RemoveRuntime(match);
            return new GameStartResult(false, 0, null, ex.Message);
        }
    }

    private async Task PublishAdvisoryAsync(Func<Task> publish)
    {
        try { await publish(); }
        catch { }
    }

    // Maps a match's Mumble session players to the stable db user ids used for
    // WebSocket routing.
    private static IReadOnlySet<long> RouteSet(LiveMatch match)
        => match.SessionToUser.Values.ToHashSet();

    // Test-only: synchronously drive a turn-timeout for the current turn generation,
    // mirroring what the real TurnTimer callback does. Lets tests exercise AFK paths
    // without waiting on wall-clock timers.
    internal Task FireTurnTimeoutForTestAsync(long matchId)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return Task.CompletedTask;
        var generation = Interlocked.Read(ref match.TurnGeneration);
        return HandleTurnTimeoutAsync(matchId, generation);
    }

    public async Task ActionAsync(long matchId, long sessionId, IReadOnlyDictionary<string, object?> action)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        IReadOnlyList<GameEvent> events;
        bool finished;
        object[] views;
        // Whether this action (re)started the shared commit window. Simultaneous games
        // (RPS) keep one 15s window for the whole round, so the first player's pick must
        // NOT restart the timer for the opponent — only a resolved round does.
        bool turnStarted = false;
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
            else if (ShouldRestartTurnTimer(match, events))
            {
                StartTurnTimer(match, TurnTimeout);
                turnStarted = true;
            }
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
                turnStarted,
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
        match.TurnTimer = _timerFactory.Create(_ => OnTurnTimeout(match.MatchId, generation), null, due);
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
                turnStarted = !finished,
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
        // A match with no single winner (all participants "draw") is a real draw:
        // persist Outcome "draw" and emit no winnerId.
        var isDraw = outcome.Participants.All(p => p.Result == "draw");

        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: match.Configuration.Format,
            RulesetVersion: match.Configuration.RulesetVersion,
            Outcome: isDraw ? "draw" : "decided",
            AbandonReason: null,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: persistedParticipants,
            MetadataJson: BuildMatchMetadata(match));
        var winner = isDraw ? null : outcome.Participants.FirstOrDefault(p => p.Placement == 1);
        RemoveRuntime(match);

        try
        {
            _completedMatches.Enqueue(completed);
            // winner.UserId remains a Mumble session id for the client view.
            await _publisher.PublishToUsersAsync(
                RouteSet(match),
                new
                {
                    type = "game.ended",
                    matchId = match.MatchId,
                    gameType = match.GameType,
                    format = match.Configuration.Format,
                    rulesetVersion = match.Configuration.RulesetVersion,
                    options = match.Configuration.Options,
                    winnerId = winner?.UserId,
                    draw = isDraw,
                });
            await PublishAdvisoryAsync(() => PublishDuelStateAsync(match, active: false));
            var feedText = match.Engine.EndFeedLine(match.State, sid => NameOf(match, sid))
                ?? (winner is not null
                    ? $"🏆 {NameOf(match, winner.UserId)} wins!"
                    : $"{GameName(match.GameType)} over.");
            await PublishAdvisoryAsync(() => PublishFeedAsync(match, feedText));
        }
        finally
        {
            await RaiseMatchCompletedAsync(match, completed.EndedAt);
        }
    }

    public Task ForfeitAsync(long matchId, long userId, string reason)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return Task.CompletedTask;

        var player = match.PlayerOne.UserId == userId ? match.PlayerOne
            : match.PlayerTwo.UserId == userId ? match.PlayerTwo
            : null;
        return player is null ? Task.CompletedTask : ForfeitPlayerAsync(match, player, reason);
    }

    [Obsolete("Use DuelOrchestrator after Task 5")]
    public Task ForfeitBySessionAsync(long matchId, long sessionId, string reason)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return Task.CompletedTask;

        var player = match.PlayerOne.SessionId == sessionId ? match.PlayerOne
            : match.PlayerTwo.SessionId == sessionId ? match.PlayerTwo
            : null;
        return player is null ? Task.CompletedTask : ForfeitPlayerAsync(match, player, reason);
    }

    private async Task ForfeitPlayerAsync(LiveMatch match, DuelPlayer player, string reason)
    {
        var matchId = match.MatchId;

        // Only an actual participant may forfeit. Match ids are a guessable
        // sequential counter, so identity must resolve to one of the match players.

        lock (match.Lock)
        {
            if (match.Status is not ("starting" or "live")) return;
            match.Status = "done";
            DisposeTimers(match);
        }

        var sessionId = player.SessionId;
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
            Format: match.Configuration.Format,
            RulesetVersion: match.Configuration.RulesetVersion,
            Outcome: "abandoned",
            AbandonReason: reason,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: participants,
            MetadataJson: BuildMatchMetadata(match));
        RemoveRuntime(match);

        try
        {
            _completedMatches.Enqueue(completed);
            await _publisher.PublishToUsersAsync(
                RouteSet(match),
                new
                {
                    type = "game.ended",
                    matchId,
                    gameType = match.GameType,
                    format = match.Configuration.Format,
                    rulesetVersion = match.Configuration.RulesetVersion,
                    options = match.Configuration.Options,
                    abandoned = true,
                    reason,
                    winnerId = otherId,
                });
            await PublishAdvisoryAsync(() => PublishDuelStateAsync(match, active: false));
            await PublishAdvisoryAsync(() => PublishFeedAsync(match,
                $"🏳️ {NameOf(match, sessionId)} forfeited — {NameOf(match, otherId)} wins!"));
        }
        finally
        {
            await RaiseMatchCompletedAsync(match, completed.EndedAt);
        }
    }

    private static string NameOf(LiveMatch match, long sessionId)
        => match.SessionToName.TryGetValue(sessionId, out var name) ? name : $"user {sessionId}";

    private bool IsMatchLiveReference(LiveMatch match)
    {
        lock (match.Lock)
            return match.Status == "live"
                && _matches.TryGetValue(match.MatchId, out var current)
                && ReferenceEquals(current, match);
    }

    private static GameStartResult StartInterrupted(long matchId) =>
        new(false, matchId, null, "The match completed during startup.");

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
            if (text is not null) await PublishAdvisoryAsync(() => PublishFeedAsync(match, text));
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

    public bool TryGetActiveMatch(long userId, out ActiveMatchReference match)
    {
        if (_stableUserToMatch.TryGetValue(userId, out var matchId)
            && _matches.TryGetValue(matchId, out var liveMatch))
        {
            match = new ActiveMatchReference(
                matchId, liveMatch.ReservationId, liveMatch.ChannelId, liveMatch.Configuration.RunnerKey);
            return true;
        }

        match = null!;
        return false;
    }

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
        match.TurnTimer?.Dispose();
        match.TurnTimer = null;
    }

    private void RemoveRuntime(LiveMatch match)
    {
        DisposeTimers(match);
        RemoveIndex(_stableUserToMatch, match.PlayerOne.UserId, match.MatchId);
        RemoveIndex(_stableUserToMatch, match.PlayerTwo.UserId, match.MatchId);
        RemoveMatch(match);
    }

    private static void RemoveIndex(ConcurrentDictionary<long, long> index, long key, long matchId) =>
        ((ICollection<KeyValuePair<long, long>>)index).Remove(new(key, matchId));

    private void RemoveMatch(LiveMatch match) =>
        ((ICollection<KeyValuePair<long, LiveMatch>>)_matches).Remove(new(match.MatchId, match));

    private async Task RaiseMatchCompletedAsync(LiveMatch match, DateTimeOffset endedAt)
    {
        var handlers = MatchCompleted;
        if (handlers is null) return;

        var completion = new MatchCompletion(
            match.MatchId,
            match.ReservationId,
            match.ChannelId,
            match.PlayerOne,
            match.PlayerTwo,
            match.Configuration,
            endedAt);
        foreach (Func<MatchCompletion, Task> handler in handlers.GetInvocationList())
            await handler(completion);
    }
}
