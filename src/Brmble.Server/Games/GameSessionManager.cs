using System.Collections.Concurrent;

namespace Brmble.Server.Games;

public interface IGameEventPublisher
{
    Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message);
    Task PublishToChannelAsync(int channelId, object message);
}

public interface IGameAnnouncer
{
    Task AnnounceResultAsync(int channelId, string text);
}

public interface IGamePresence
{
    // Returns (channelId, isBrmble) if the user has a live Brmble session.
    bool TryGetChannel(long userId, out int channelId, out bool isBrmble);
}

public record InviteResult(bool Success, long MatchId, string? Error);

public sealed class GameSessionManager
{
    private static readonly TimeSpan InviteTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan TurnTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PenaltyTimeout = TimeSpan.FromSeconds(5);

    private readonly IReadOnlyDictionary<string, IGameEngine> _engines;
    private readonly IRandomSource _rng;
    private readonly IGamePresence _presence;
    private readonly IGameEventPublisher _publisher;
    private readonly IGameAnnouncer _announcer;
    private readonly GameRepository _repository;

    private readonly ConcurrentDictionary<long, LiveMatch> _matches = new();
    private readonly ConcurrentDictionary<long, long> _userToMatch = new();
    private long _matchIdCounter;

    public GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGamePresence presence,
        IGameEventPublisher publisher,
        IGameAnnouncer announcer,
        GameRepository repository)
    {
        _engines = engines.ToDictionary(e => e.GameType, StringComparer.OrdinalIgnoreCase);
        _rng = rng;
        _presence = presence;
        _publisher = publisher;
        _announcer = announcer;
        _repository = repository;
    }

    private sealed class LiveMatch
    {
        public required long MatchId;
        public required string GameType;
        public required IGameEngine Engine;
        public required object State;
        public required long[] Players; // [inviter, target]
        public required int ChannelId;
        public string Status = "pending"; // pending | live | done
        public DateTimeOffset StartedAt;
        public Timer? InviteTimer;
        public Timer? TurnTimer;
        public readonly object Lock = new();
    }

    public async Task<InviteResult> InviteAsync(long inviterUserId, long targetUserId, string gameType)
    {
        if (inviterUserId == targetUserId)
            return new InviteResult(false, 0, "You cannot invite yourself.");

        if (!_engines.TryGetValue(gameType, out var engine))
            return new InviteResult(false, 0, $"Unknown game type '{gameType}'.");

        if (!_presence.TryGetChannel(inviterUserId, out var inviterChannel, out var inviterBrmble) || !inviterBrmble)
            return new InviteResult(false, 0, "You must be connected to Brmble to start a game.");

        if (!_presence.TryGetChannel(targetUserId, out var targetChannel, out var targetBrmble) || !targetBrmble)
            return new InviteResult(false, 0, "The other player must be connected to Brmble.");

        if (inviterChannel != targetChannel)
            return new InviteResult(false, 0, "You must be in the same channel to start a game.");

        if (_userToMatch.ContainsKey(inviterUserId))
            return new InviteResult(false, 0, "You already have an active game.");

        if (_userToMatch.ContainsKey(targetUserId))
            return new InviteResult(false, 0, "The other player already has an active game.");

        var matchId = Interlocked.Increment(ref _matchIdCounter);
        var players = new[] { new GamePlayer(inviterUserId), new GamePlayer(targetUserId) };
        var match = new LiveMatch
        {
            MatchId = matchId,
            GameType = gameType,
            Engine = engine,
            State = engine.InitialState(players, _rng),
            Players = new[] { inviterUserId, targetUserId },
            ChannelId = inviterChannel,
        };

        if (!_userToMatch.TryAdd(inviterUserId, matchId))
            return new InviteResult(false, 0, "You already have an active game.");
        if (!_userToMatch.TryAdd(targetUserId, matchId))
        {
            _userToMatch.TryRemove(inviterUserId, out _);
            return new InviteResult(false, 0, "The other player already has an active game.");
        }

        _matches[matchId] = match;

        await _publisher.PublishToUsersAsync(
            new HashSet<long> { targetUserId },
            new { type = "game.invited", matchId, gameType, from = inviterUserId });

        match.InviteTimer = new Timer(_ => OnInviteExpired(matchId), null, InviteTimeout, Timeout.InfiniteTimeSpan);

        return new InviteResult(true, matchId, null);
    }

    private void OnInviteExpired(long matchId)
    {
        _ = DeclineOrExpireAsync(matchId);
    }

    public async Task RespondAsync(long matchId, long targetUserId, bool accept)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        if (accept)
        {
            List<Task> tasks = new();
            lock (match.Lock)
            {
                if (match.Status != "pending") return;
                if (match.Players[1] != targetUserId) return;
                match.InviteTimer?.Dispose();
                match.InviteTimer = null;
                match.Status = "live";
                match.StartedAt = DateTimeOffset.UtcNow;
            }
            await _publisher.PublishToUsersAsync(
                new HashSet<long>(match.Players),
                new
                {
                    type = "game.started",
                    matchId,
                    firstTurn = CurrentPlayer(match),
                    views = match.Players.Select(p => new { userId = p, view = match.Engine.PublicView(match.State, p) }).ToArray(),
                });
            StartTurnTimer(match, TurnTimeout);
        }
        else
        {
            await DeclineOrExpireAsync(matchId);
        }
    }

    private async Task DeclineOrExpireAsync(long matchId)
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
            new HashSet<long>(match.Players),
            new { type = "game.declined", matchId });
        foreach (var p in match.Players) _userToMatch.TryRemove(p, out _);
        _matches.TryRemove(matchId, out _);
    }

    public async Task ActionAsync(long matchId, long userId, IReadOnlyDictionary<string, object?> action)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        IReadOnlyList<GameEvent> events;
        bool finished;
        lock (match.Lock)
        {
            if (match.Status != "live") return;
            try
            {
                events = match.Engine.ApplyAction(match.State, userId, action, _rng);
            }
            catch (InvalidGameActionException ex)
            {
                _ = _publisher.PublishToUsersAsync(
                    new HashSet<long> { userId },
                    new { type = "game.actionRejected", matchId, reason = ex.Message });
                return;
            }
            finished = match.Engine.GetOutcome(match.State) is GameOutcome.Finished;
            if (!finished) StartTurnTimer(match, TurnTimeout);
            else DisposeTimers(match);
        }

        await _publisher.PublishToUsersAsync(
            new HashSet<long>(match.Players),
            new
            {
                type = "game.stateUpdated",
                matchId,
                views = match.Players.Select(p => new { userId = p, view = match.Engine.PublicView(match.State, p) }).ToArray(),
                events = events.Select(e => new { e.Kind, e.Data }).ToArray(),
            });

        if (finished) await CompleteMatchAsync(match);
    }

    private void StartTurnTimer(LiveMatch match, TimeSpan due)
    {
        match.TurnTimer?.Dispose();
        match.TurnTimer = new Timer(_ => OnTurnTimeout(match.MatchId), null, due, Timeout.InfiniteTimeSpan);
    }

    private void OnTurnTimeout(long matchId)
    {
        _ = HandleTurnTimeoutAsync(matchId);
    }

    private async Task HandleTurnTimeoutAsync(long matchId)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;

        IReadOnlyList<GameEvent> events;
        bool finished;
        lock (match.Lock)
        {
            if (match.Status != "live") return;
            events = match.Engine.ApplyTimeoutPenalty(match.State, _rng);
            finished = match.Engine.GetOutcome(match.State) is GameOutcome.Finished;
            if (!finished) StartTurnTimer(match, PenaltyTimeout);
            else DisposeTimers(match);
        }

        await _publisher.PublishToUsersAsync(
            new HashSet<long>(match.Players),
            new
            {
                type = "game.stateUpdated",
                matchId,
                views = match.Players.Select(p => new { userId = p, view = match.Engine.PublicView(match.State, p) }).ToArray(),
                events = events.Select(e => new { e.Kind, e.Data }).ToArray(),
            });

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
        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: "1v1",
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: outcome.Participants);

        await _repository.SaveCompletedMatchAsync(completed);

        await _publisher.PublishToUsersAsync(
            new HashSet<long>(match.Players),
            new { type = "game.ended", matchId = match.MatchId });

        var winner = outcome.Participants.FirstOrDefault(p => p.Placement == 1);
        var text = winner is not null
            ? $"Game over ({match.GameType}): user {winner.UserId} wins!"
            : $"Game over ({match.GameType}).";
        await _announcer.AnnounceResultAsync(match.ChannelId, text);

        foreach (var p in match.Players) _userToMatch.TryRemove(p, out _);
        _matches.TryRemove(match.MatchId, out _);
    }

    public async Task ForfeitAsync(long matchId, long userId, string reason)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;
        lock (match.Lock)
        {
            if (match.Status != "live") return;
            match.Status = "done";
            DisposeTimers(match);
        }

        var otherId = match.Players[0] == userId ? match.Players[1] : match.Players[0];
        var participants = new[]
        {
            new CompletedParticipant(otherId, Placement: 1, Score: null, Result: "win"),
            new CompletedParticipant(userId, Placement: 2, Score: null, Result: "abandoned"),
        };
        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: "1v1",
            Outcome: "abandoned",
            AbandonReason: reason,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: participants);

        await _repository.SaveCompletedMatchAsync(completed);

        await _publisher.PublishToUsersAsync(
            new HashSet<long>(match.Players),
            new { type = "game.ended", matchId, abandoned = true, reason });

        await _announcer.AnnounceResultAsync(match.ChannelId,
            $"Game over ({match.GameType}): user {userId} {reason}. User {otherId} wins.");

        foreach (var p in match.Players) _userToMatch.TryRemove(p, out _);
        _matches.TryRemove(matchId, out _);
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
        match.InviteTimer?.Dispose();
        match.InviteTimer = null;
        match.TurnTimer?.Dispose();
        match.TurnTimer = null;
    }
}
