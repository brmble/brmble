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

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        // Stop accepting new work so the drain loop can terminate on its own once the
        // buffer is empty, rather than being torn down mid-queue by the stopping token.
        _queue.Writer.TryComplete();
        await base.StopAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var match in _queue.Reader.ReadAllAsync(CancellationToken.None))
        {
            var failureCount = 0;
            while (true)
            {
                try
                {
                    await _persist(match);
                    break;
                }
                catch (Exception ex)
                {
                    failureCount++;
                    if (failureCount > RetryDelays.Length)
                    {
                        _logger.LogCritical(ex,
                            "Permanently dropping completed {GameType} match in channel {ChannelId} ended at {EndedAt} after {Attempts} attempts. Match history and derived stats for this match are lost.",
                            match.GameType, match.ChannelId, match.EndedAt, failureCount);
                        break;
                    }

                    var delay = RetryDelays[failureCount - 1];
                    _logger.LogError(ex,
                        "Failed to persist completed {GameType} match; retrying in {Delay}",
                        match.GameType, delay);

                    try
                    {
                        await _schedule.DelayAsync(delay, stoppingToken);
                    }
                    catch (OperationCanceledException)
                    {
                        _logger.LogCritical(ex,
                            "Dropping completed {GameType} match in channel {ChannelId} ended at {EndedAt} because the host is shutting down mid-retry.",
                            match.GameType, match.ChannelId, match.EndedAt);
                        break;
                    }
                }
            }
        }
    }
}
