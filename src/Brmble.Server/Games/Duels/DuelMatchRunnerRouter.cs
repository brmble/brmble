using System.Collections.Concurrent;

namespace Brmble.Server.Games.Duels;

public sealed class DuelMatchRunnerRouter : IDuelMatchRunnerRouter
{
    private readonly IReadOnlyDictionary<string, IDuelMatchRunner> _runners;
    private readonly ConcurrentDictionary<long, IDuelMatchRunner> _matchRunners = new();
    private readonly HashSet<long> _startingReservations = [];
    private readonly HashSet<long> _completedDuringStart = [];
    private readonly object _mappingLock = new();

    public DuelMatchRunnerRouter(IEnumerable<IDuelMatchRunner> runners)
    {
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
                _startingReservations.Remove(reservation.ReservationId);
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

        List<Exception>? errors = null;
        foreach (Func<MatchCompletion, Task> handler in handlers.GetInvocationList())
        {
            try
            {
                await handler(completion);
            }
            catch (Exception ex)
            {
                (errors ??= []).Add(ex);
            }
        }

        if (errors is not null)
            throw new AggregateException(errors);
    }
}
