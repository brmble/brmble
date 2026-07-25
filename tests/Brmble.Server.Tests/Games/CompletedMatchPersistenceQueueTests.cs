using Brmble.Server.Games;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

file sealed class RecordingRetrySchedule : ICompletedMatchRetrySchedule
{
    public List<TimeSpan> Delays { get; } = [];
    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        Delays.Add(delay);
        return Task.CompletedTask;
    }
}

[TestClass]
public class CompletedMatchPersistenceQueueTests
{
    [TestMethod]
    public async Task Worker_RetriesFailuresOnRequiredSchedule_WithoutBlockingEnqueue()
    {
        var attempts = 0;
        var persisted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var schedule = new RecordingRetrySchedule();
        var queue = new CompletedMatchPersistenceQueue(
            _ =>
            {
                attempts++;
                if (attempts < 5) throw new InvalidOperationException("database unavailable");
                persisted.TrySetResult();
                return Task.CompletedTask;
            }, schedule, NullLogger<CompletedMatchPersistenceQueue>.Instance);
        var match = CreateMatch();

        await queue.StartAsync(CancellationToken.None);
        queue.Enqueue(match);
        await persisted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await queue.StopAsync(CancellationToken.None);

        Assert.AreEqual(5, attempts);
        CollectionAssert.AreEqual(
            new[] { TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(60) },
            schedule.Delays);
    }

    [TestMethod]
    public async Task Shutdown_CancelsPendingRetryCleanly()
    {
        var delayEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var schedule = new BlockingRetrySchedule(delayEntered);
        var queue = new CompletedMatchPersistenceQueue(
            _ => throw new InvalidOperationException("database unavailable"),
            schedule, NullLogger<CompletedMatchPersistenceQueue>.Instance);

        await queue.StartAsync(CancellationToken.None);
        queue.Enqueue(CreateMatch());
        await delayEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await queue.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
    }

    private static CompletedMatch CreateMatch() => new(
        "rps", 7, "bo5", 3, "decided", null,
        DateTimeOffset.UtcNow.AddSeconds(-1), DateTimeOffset.UtcNow,
        [new CompletedParticipant(100, 1, 3, "win"), new CompletedParticipant(200, 2, 0, "loss")]);

    private sealed class BlockingRetrySchedule(TaskCompletionSource entered) : ICompletedMatchRetrySchedule
    {
        public async Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
        {
            entered.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }
    }
}
