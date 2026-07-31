using Brmble.Server.Games.Duels;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Duels;

file sealed class FakeDuelRunner(string key) : IDuelMatchRunner
{
    public string RunnerKey => key;
    public event Func<MatchCompletion, Task>? MatchCompleted;
    public GameStartResult StartResult { get; set; } = new(true, 1, DateTimeOffset.UtcNow, null);
    public Dictionary<long, ActiveMatchReference> ActiveByUser { get; } = [];
    public List<(long matchId, long userId, string reason)> Forfeits { get; } = [];
    public DuelReservation? CompleteDuringStart { get; set; }
    public bool ThrowAfterCompletion { get; set; }
    public async Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        if (StartResult.Success)
        {
            var active = new ActiveMatchReference(
                StartResult.MatchId, reservation.ReservationId, reservation.ChannelId, RunnerKey);
            ActiveByUser[reservation.PlayerOne.UserId] = active;
            ActiveByUser[reservation.PlayerTwo.UserId] = active;
        }
        if (CompleteDuringStart is not null)
            await CompleteAsync(new MatchCompletion(
                StartResult.MatchId, reservation.ReservationId, reservation.ChannelId,
                reservation.PlayerOne, reservation.PlayerTwo, reservation.Configuration, DateTimeOffset.UtcNow));
        if (ThrowAfterCompletion)
            throw new InvalidOperationException("start failed after completion");
        return StartResult;
    }
    public bool TryGetActiveMatch(long userId, out ActiveMatchReference match) => ActiveByUser.TryGetValue(userId, out match!);
    public Task ForfeitAsync(long matchId, long userId, string reason)
    {
        Forfeits.Add((matchId, userId, reason));
        return Task.CompletedTask;
    }
    public Task CompleteAsync(MatchCompletion completion)
    {
        ActiveByUser.Remove(completion.PlayerOne.UserId);
        ActiveByUser.Remove(completion.PlayerTwo.UserId);
        return MatchCompleted?.Invoke(completion) ?? Task.CompletedTask;
    }
}

[TestClass]
public class DuelMatchRunnerRouterTests
{
    [TestMethod]
    public async Task RoutesStartLookupForfeitAndCompletionAcrossRunnerKinds()
    {
        var discrete = new FakeDuelRunner("discrete") { StartResult = new(true, 44, DateTimeOffset.UtcNow, null) };
        var continuous = new FakeDuelRunner("continuous") { StartResult = new(true, 55, DateTimeOffset.UtcNow, null) };
        continuous.ActiveByUser[200] = new ActiveMatchReference(55, 9, 7, "continuous");
        var router = new DuelMatchRunnerRouter([discrete, continuous], NullLogger<DuelMatchRunnerRouter>.Instance);
        MatchCompletion? forwarded = null;
        router.MatchCompleted += completion => { forwarded = completion; return Task.CompletedTask; };

        var reservation = Reservation("continuous");
        var started = await router.StartAsync(reservation);
        Assert.AreEqual(55L, started.MatchId);
        Assert.IsTrue(router.TryGetActiveMatch(200, out var active));
        Assert.AreEqual(55L, active.MatchId);

        await router.ForfeitAsync(55, 200, "disconnect");
        Assert.AreEqual((55L, 200L, "disconnect"), continuous.Forfeits.Single());

        await continuous.CompleteAsync(new MatchCompletion(
            55, reservation.ReservationId, reservation.ChannelId,
            reservation.PlayerOne, reservation.PlayerTwo, reservation.Configuration, DateTimeOffset.UtcNow));
        Assert.IsNotNull(forwarded);
        await router.ForfeitAsync(55, 200, "again");
        Assert.AreEqual(1, continuous.Forfeits.Count);
    }

    [TestMethod]
    public async Task UnknownOrFailedRunnerStart_DoesNotCreateMatchMapping()
    {
        var failed = new FakeDuelRunner("discrete") { StartResult = new(false, 77, null, "failed") };
        var router = new DuelMatchRunnerRouter([failed], NullLogger<DuelMatchRunnerRouter>.Instance);

        var unknown = await router.StartAsync(Reservation("missing"));
        var failure = await router.StartAsync(Reservation("discrete"));

        Assert.IsFalse(unknown.Success);
        Assert.AreEqual(0L, unknown.MatchId);
        Assert.IsNull(unknown.StartedAt);
        Assert.AreEqual("Runner 'missing' is unavailable.", unknown.Error);
        Assert.IsFalse(failure.Success);
        await router.ForfeitAsync(77, 100, "disconnect");
        Assert.AreEqual(0, failed.Forfeits.Count);
    }

    [TestMethod]
    public async Task CompletionDuringStart_DoesNotLeaveStaleForfeitMapping()
    {
        var runner = new FakeDuelRunner("continuous")
        {
            StartResult = new(true, 55, DateTimeOffset.UtcNow, null),
            CompleteDuringStart = Reservation("continuous")
        };
        var router = new DuelMatchRunnerRouter([runner], NullLogger<DuelMatchRunnerRouter>.Instance);

        await router.StartAsync(Reservation("continuous"));
        await router.ForfeitAsync(55, 100, "disconnect");

        Assert.AreEqual(0, runner.Forfeits.Count);
    }

    [TestMethod]
    public async Task CompletionThenStartException_DoesNotPoisonSameReservationRetry()
    {
        var reservation = Reservation("continuous");
        var runner = new FakeDuelRunner("continuous")
        {
            StartResult = new(true, 55, DateTimeOffset.UtcNow, null),
            CompleteDuringStart = reservation,
            ThrowAfterCompletion = true,
        };
        var router = new DuelMatchRunnerRouter([runner], NullLogger<DuelMatchRunnerRouter>.Instance);

        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() => router.StartAsync(reservation));
        runner.CompleteDuringStart = null;
        runner.ThrowAfterCompletion = false;

        var retried = await router.StartAsync(reservation);
        await router.ForfeitAsync(retried.MatchId, reservation.PlayerOne.UserId, "disconnect");

        Assert.IsTrue(retried.Success);
        Assert.AreEqual((55L, 100L, "disconnect"), runner.Forfeits.Single());
    }

    [TestMethod]
    public async Task ThrowingCompletionSubscriber_IsSwallowedAndRemainingSubscribersRun()
    {
        var runner = new FakeDuelRunner("continuous") { StartResult = new(true, 55, DateTimeOffset.UtcNow, null) };
        var router = new DuelMatchRunnerRouter([runner], NullLogger<DuelMatchRunnerRouter>.Instance);
        var reservation = Reservation("continuous");
        var secondSubscriberRan = false;
        router.MatchCompleted += _ => throw new InvalidOperationException("subscriber failed");
        router.MatchCompleted += _ => { secondSubscriberRan = true; return Task.CompletedTask; };

        await router.StartAsync(reservation);
        await runner.CompleteAsync(new MatchCompletion(
            55, reservation.ReservationId, reservation.ChannelId,
            reservation.PlayerOne, reservation.PlayerTwo, reservation.Configuration, DateTimeOffset.UtcNow));

        Assert.IsTrue(secondSubscriberRan);
    }

    private static DuelReservation Reservation(string runnerKey) => new(
        9, 7, new DuelPlayer(10, 100, "Alice"), new DuelPlayer(20, 200, "Bob"),
        new DuelConfiguration("rps", "bo3", 1,
            new Dictionary<string, object?> { ["bestOf"] = 3 }, runnerKey),
        DateTimeOffset.UtcNow, 1, null);
}
