using System.Threading.Channels;

namespace Brmble.Server.Games;

public interface ICompletedMatchSink
{
    void Enqueue(CompletedMatch match);
}

internal interface ICompletedMatchRetrySchedule
{
    Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken);
}

internal sealed class CompletedMatchRetrySchedule : ICompletedMatchRetrySchedule
{
    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken) =>
        Task.Delay(delay, cancellationToken);
}

public sealed class CompletedMatchPersistenceQueue : BackgroundService, ICompletedMatchSink
{
    private static readonly TimeSpan[] RetryDelays =
    [
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(30),
        TimeSpan.FromSeconds(60),
    ];

    private readonly Channel<CompletedMatch> _queue = Channel.CreateUnbounded<CompletedMatch>(
        new UnboundedChannelOptions { SingleReader = true });
    private readonly Func<CompletedMatch, Task> _persist;
    private readonly ICompletedMatchRetrySchedule _schedule;
    private readonly ILogger<CompletedMatchPersistenceQueue> _logger;

    public CompletedMatchPersistenceQueue(
        GameRepository repository,
        ILogger<CompletedMatchPersistenceQueue> logger)
        : this(match => repository.SaveCompletedMatchAsync(match), new CompletedMatchRetrySchedule(), logger)
    {
    }

    internal CompletedMatchPersistenceQueue(
        Func<CompletedMatch, Task> persist,
        ICompletedMatchRetrySchedule schedule,
        ILogger<CompletedMatchPersistenceQueue> logger)
    {
        _persist = persist;
        _schedule = schedule;
        _logger = logger;
    }

    public void Enqueue(CompletedMatch match)
    {
        if (!_queue.Writer.TryWrite(match))
            throw new InvalidOperationException("The completed match persistence queue is unavailable.");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var match in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            var failureCount = 0;
            while (true)
            {
                try
                {
                    await _persist(match);
                    break;
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    var delay = RetryDelays[Math.Min(failureCount, RetryDelays.Length - 1)];
                    failureCount++;
                    _logger.LogError(ex,
                        "Failed to persist completed {GameType} match; retrying in {Delay}",
                        match.GameType, delay);
                    await _schedule.DelayAsync(delay, stoppingToken);
                }
            }
        }
    }
}
