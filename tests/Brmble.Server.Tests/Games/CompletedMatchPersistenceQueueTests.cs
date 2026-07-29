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

    [TestMethod]
    public async Task PoisonedMatch_IsDroppedSoLaterMatchesStillPersist()
    {
        var persistedGameTypes = new List<string>();
        var secondPersisted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var schedule = new RecordingRetrySchedule();
        var queue = new CompletedMatchPersistenceQueue(
            match =>
            {
                if (match.GameType == "poison") throw new InvalidOperationException("constraint violation");
                persistedGameTypes.Add(match.GameType);
                secondPersisted.TrySetResult();
                return Task.CompletedTask;
            }, schedule, NullLogger<CompletedMatchPersistenceQueue>.Instance);

        await queue.StartAsync(CancellationToken.None);
        queue.Enqueue(CreateMatch() with { GameType = "poison" });
        queue.Enqueue(CreateMatch() with { GameType = "rps" });

        await secondPersisted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await queue.StopAsync(CancellationToken.None);

        CollectionAssert.AreEqual(new[] { "rps" }, persistedGameTypes);
    }

    [TestMethod]
    public async Task Shutdown_DuringRetryDelay_StillDrainsRemainingQueuedMatches()
    {
        var retryEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var persisted = new List<int>();
        var queue = new CompletedMatchPersistenceQueue(
            match =>
            {
                if (match.ChannelId == 1) throw new InvalidOperationException("database unavailable");
                lock (persisted) persisted.Add(match.ChannelId);
                return Task.CompletedTask;
            },
            new BlockingRetrySchedule(retryEntered), NullLogger<CompletedMatchPersistenceQueue>.Instance);

        await queue.StartAsync(CancellationToken.None);
        queue.Enqueue(CreateMatch() with { ChannelId = 1 });
        queue.Enqueue(CreateMatch() with { ChannelId = 2 });
        queue.Enqueue(CreateMatch() with { ChannelId = 3 });
        await retryEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));

        await queue.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));

        CollectionAssert.AreEqual(new[] { 2, 3 }, persisted,
            "a match stuck in a retry delay must not discard the rest of the queue at shutdown");
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

