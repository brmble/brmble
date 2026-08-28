using System.Collections.Concurrent;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Continuous;

public sealed class ContinuousGameCoordinator : IDuelMatchRunner
{
    private readonly IReadOnlyDictionary<string, IContinuousGameDefinition> _definitions;
    private readonly TimeProvider _time;
    private readonly ICompletedMatchSink _sink;
    private readonly IGameEventPublisher _publisher;
    private readonly ILogger<ContinuousGameCoordinator> _logger;
    private readonly ConcurrentDictionary<long, ContinuousMatchState> _matches = new();
    private readonly ConcurrentDictionary<long, long> _matchByStableUser = new();
    private long _nextMatchId;

    public ContinuousGameCoordinator(
        IEnumerable<IContinuousGameDefinition> definitions,
        TimeProvider time,
        ICompletedMatchSink sink,
        IGameEventPublisher publisher,
        ILogger<ContinuousGameCoordinator> logger)
    {
        _definitions = definitions.ToDictionary(x => x.GameType, StringComparer.OrdinalIgnoreCase);
        _time = time;
        _sink = sink;
        _publisher = publisher;
        _logger = logger;
    }

    public string RunnerKey => "continuous";
    public event Func<MatchCompletion, Task>? MatchCompleted;

    public Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        if (!string.Equals(reservation.Configuration.RunnerKey, RunnerKey, StringComparison.Ordinal))
            return Task.FromResult(new GameStartResult(false, 0, null,
                $"Runner '{reservation.Configuration.RunnerKey}' is not supported."));

        if (!_definitions.TryGetValue(reservation.Configuration.GameType, out var definition))
            return Task.FromResult(new GameStartResult(false, 0, null,
                $"Continuous game '{reservation.Configuration.GameType}' is unavailable."));

        var matchId = Interlocked.Increment(ref _nextMatchId);
        var startedAt = _time.GetUtcNow();
        var state = new ContinuousMatchState(reservation, definition.Create(reservation), startedAt);
        _matches[matchId] = state;
        _matchByStableUser[reservation.PlayerOne.UserId] = matchId;
        _matchByStableUser[reservation.PlayerTwo.UserId] = matchId;

        // Scheduler, realtime sockets, and the participant attach gate are added by later tasks.
        return Task.FromResult(new GameStartResult(true, matchId, startedAt, null));
    }

    public bool TryGetActiveMatch(long stableUserId, out ActiveMatchReference match)
    {
        if (_matchByStableUser.TryGetValue(stableUserId, out var matchId)
            && _matches.TryGetValue(matchId, out var state))
        {
            match = new ActiveMatchReference(
                matchId, state.Reservation.ReservationId, state.Reservation.ChannelId, RunnerKey);
            return true;
        }

        match = null!;
        return false;
    }

    public async Task ForfeitAsync(long matchId, long stableUserId, string reason)
    {
        if (!_matchByStableUser.TryGetValue(stableUserId, out var ownedMatchId)
            || ownedMatchId != matchId
            || !_matches.TryRemove(matchId, out var state))
            return;

        _matchByStableUser.TryRemove(state.Reservation.PlayerOne.UserId, out _);
        _matchByStableUser.TryRemove(state.Reservation.PlayerTwo.UserId, out _);

        // Persistence, publishing, and completion metadata are added by later tasks.
        _ = reason;
        _ = _sink;
        _ = _publisher;
        _ = _logger;
        var completion = new MatchCompletion(
            matchId,
            state.Reservation.ReservationId,
            state.Reservation.ChannelId,
            state.Reservation.PlayerOne,
            state.Reservation.PlayerTwo,
            state.Reservation.Configuration,
            _time.GetUtcNow());
        var handlers = MatchCompleted;
        if (handlers is null)
            return;

        foreach (Func<MatchCompletion, Task> handler in handlers.GetInvocationList())
            await handler(completion);
    }

    private sealed record ContinuousMatchState(
        DuelReservation Reservation,
        IContinuousSimulation Simulation,
        DateTimeOffset StartedAt);
}
