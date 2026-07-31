using System.Collections.Concurrent;

namespace Brmble.Server.Games.Duels;

public sealed class DuelMatchRunnerRouter : IDuelMatchRunnerRouter
{
    private readonly IReadOnlyDictionary<string, IDuelMatchRunner> _runners;
    private readonly ConcurrentDictionary<long, IDuelMatchRunner> _matchRunners = new();
    private readonly HashSet<long> _startingReservations = [];
    private readonly HashSet<long> _completedDuringStart = [];
    private readonly object _mappingLock = new();
    private readonly ILogger<DuelMatchRunnerRouter> _logger;

    public DuelMatchRunnerRouter(IEnumerable<IDuelMatchRunner> runners, ILogger<DuelMatchRunnerRouter> logger)
    {
        _logger = logger;
        _runners = runners.ToDictionary(runner => runner.RunnerKey, StringComparer.Ordinal);
        foreach (var runner in _runners.Values)
            runner.MatchCompleted += OnMatchCompletedAsync;
    }

    public event Func<MatchCompletion, Task>? MatchCompleted;

    public async Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        if (!_runners.TryGetValue(reservation.Configuration.RunnerKey, out var runner))
            return new GameStartResult(false, 0, null,
                $"Runner '{reservation.Configuration.RunnerKey}' is unavailable.");

        lock (_mappingLock)
            _startingReservations.Add(reservation.ReservationId);

        GameStartResult result;
        try
        {
            result = await runner.StartAsync(reservation);
        }
        catch
        {
            lock (_mappingLock)
            {
                _startingReservations.Remove(reservation.ReservationId);
                _completedDuringStart.Remove(reservation.ReservationId);
            }
            throw;
        }

        lock (_mappingLock)
        {
            _startingReservations.Remove(reservation.ReservationId);
            var completed = _completedDuringStart.Remove(reservation.ReservationId);
            if (result.Success && !completed)
                _matchRunners[result.MatchId] = runner;
        }
        return result;
    }

    public bool TryGetActiveMatch(long userId, out ActiveMatchReference match)
    {
        foreach (var runner in _runners.Values)
        {
            if (runner.TryGetActiveMatch(userId, out match))
                return true;
        }

        match = null!;
        return false;
    }

    public Task ForfeitAsync(long matchId, long userId, string reason) =>
        _matchRunners.TryGetValue(matchId, out var runner)
            ? runner.ForfeitAsync(matchId, userId, reason)
            : Task.CompletedTask;

    private async Task OnMatchCompletedAsync(MatchCompletion completion)
    {
        lock (_mappingLock)
        {
            _matchRunners.TryRemove(completion.MatchId, out _);
            if (_startingReservations.Contains(completion.ReservationId))
                _completedDuringStart.Add(completion.ReservationId);
        }
        var handlers = MatchCompleted;
        if (handlers is null) return;

        foreach (Func<MatchCompletion, Task> handler in handlers.GetInvocationList())
        {
            // Raised from a runner's completion path: a throwing subscriber must never
            // break match cleanup, nor stop the remaining subscribers from being notified.
            try
            {
                await handler(completion);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Match completion subscriber failed for match {MatchId} (reservation {ReservationId}). Duel queue advancement may be stalled.",
                    completion.MatchId, completion.ReservationId);
            }
        }
    }
}
