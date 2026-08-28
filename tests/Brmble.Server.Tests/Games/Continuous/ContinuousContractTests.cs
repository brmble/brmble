using Brmble.Server.Games;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public class ContinuousContractTests
{
    [TestMethod]
    public async Task ArenaConfiguration_DispatchesToContinuousRunnerWithoutChangingReservation()
    {
        var reservation = TestReservation(gameType: "arena-knockoff", format: "bo3", rulesetVersion: 1,
            runnerKey: "continuous", playerOneSessionId: 10, playerOneUserId: 501,
            playerTwoSessionId: 20, playerTwoUserId: 502);
        var definition = new FakeContinuousDefinition("arena-knockoff", "bo3", 1);
        var continuous = ContinuousHarness.Coordinator(definition);
        IDuelMatchRunnerRouter router = new DuelMatchRunnerRouter([continuous], NullLogger<DuelMatchRunnerRouter>.Instance);

        var result = await router.StartAsync(reservation);

        Assert.IsTrue(result.Success);
        Assert.IsTrue(router.TryGetActiveMatch(501, out var active));
        Assert.AreEqual(result.MatchId, active.MatchId);
        Assert.AreEqual(reservation.ReservationId, active.ReservationId);
        Assert.AreEqual("continuous", active.RunnerKey);
    }

    [TestMethod]
    public void SharedCatalog_NormalizesFakeContinuousDefinition()
    {
        var definition = new FakeContinuousDefinition("arena-knockoff", "bo3", 1);

        var actual = new GameDefinitionCatalog([definition]).Create("arena-knockoff", null);

        Assert.AreEqual("arena-knockoff", actual.GameType);
        Assert.AreEqual("bo3", actual.Format);
        Assert.AreEqual(1, actual.RulesetVersion);
        Assert.AreEqual(0, actual.Options.Count);
        Assert.AreEqual("continuous", actual.RunnerKey);
        Assert.ThrowsException<InvalidGameConfigurationException>(() =>
            definition.NormalizeOptions(new Dictionary<string, object?> { ["bestOf"] = 5 }));
    }

    [TestMethod]
    public async Task ExistingRouter_ForfeitAndLookupUseStableUserId()
    {
        var h = await ContinuousHarness.Started(playerOneSessionId: 10, playerOneUserId: 501);

        Assert.IsTrue(h.Router.TryGetActiveMatch(501, out var active));
        Assert.IsFalse(h.Router.TryGetActiveMatch(10, out _));

        await h.Router.ForfeitAsync(active.MatchId, 501, "disconnect");

        Assert.IsFalse(h.Router.TryGetActiveMatch(501, out _));
        Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
    }

    [TestMethod]
    public async Task StartRejectsExistingOwnerWithoutReplacingOrLeakingOwnership()
    {
        var coordinator = ContinuousHarness.Coordinator(
            new FakeContinuousDefinition("arena-knockoff", "bo3", 1));
        var first = await coordinator.StartAsync(TestReservation(
            reservationId: 1, playerOneUserId: 501, playerTwoUserId: 502));

        var conflict = await coordinator.StartAsync(TestReservation(
            reservationId: 2, playerOneUserId: 503, playerTwoUserId: 502));
        var afterRollback = await coordinator.StartAsync(TestReservation(
            reservationId: 3, playerOneUserId: 503, playerTwoUserId: 504));

        Assert.IsTrue(first.Success);
        Assert.IsFalse(conflict.Success);
        Assert.IsTrue(afterRollback.Success);
        Assert.IsTrue(coordinator.TryGetActiveMatch(502, out var original));
        Assert.AreEqual(first.MatchId, original.MatchId);
    }

    [TestMethod]
    public async Task ForfeitRemovesBothOwnersAndEmitsCompletion()
    {
        var coordinator = ContinuousHarness.Coordinator(
            new FakeContinuousDefinition("arena-knockoff", "bo3", 1));
        var reservation = TestReservation();
        var started = await coordinator.StartAsync(reservation);
        MatchCompletion? emitted = null;
        coordinator.MatchCompleted += completion =>
        {
            emitted = completion;
            return Task.CompletedTask;
        };

        await coordinator.ForfeitAsync(started.MatchId, reservation.PlayerOne.UserId, "disconnect");

        Assert.IsFalse(coordinator.TryGetActiveMatch(reservation.PlayerOne.UserId, out _));
        Assert.IsFalse(coordinator.TryGetActiveMatch(reservation.PlayerTwo.UserId, out _));
        Assert.IsNotNull(emitted);
        Assert.AreEqual(started.MatchId, emitted.MatchId);
        Assert.AreEqual(reservation.ReservationId, emitted.ReservationId);
    }

    [TestMethod]
    public async Task ThrowingCompletionSubscriberDoesNotPreventLaterSubscribers()
    {
        var coordinator = ContinuousHarness.Coordinator(
            new FakeContinuousDefinition("arena-knockoff", "bo3", 1));
        var reservation = TestReservation();
        var started = await coordinator.StartAsync(reservation);
        var laterSubscriberRan = false;
        coordinator.MatchCompleted += _ => throw new InvalidOperationException("subscriber failed");
        coordinator.MatchCompleted += _ =>
        {
            laterSubscriberRan = true;
            return Task.CompletedTask;
        };

        await coordinator.ForfeitAsync(started.MatchId, reservation.PlayerOne.UserId, "disconnect");

        Assert.IsTrue(laterSubscriberRan);
    }

    private static DuelReservation TestReservation(
        long reservationId = 9,
        string gameType = "arena-knockoff",
        string format = "bo3",
        int rulesetVersion = 1,
        string runnerKey = "continuous",
        long playerOneSessionId = 10,
        long playerOneUserId = 501,
        long playerTwoSessionId = 20,
        long playerTwoUserId = 502) => new(
            reservationId,
            7,
            new DuelPlayer(playerOneSessionId, playerOneUserId, "Alice"),
            new DuelPlayer(playerTwoSessionId, playerTwoUserId, "Bob"),
            new DuelConfiguration(gameType, format, rulesetVersion, new Dictionary<string, object?>(), runnerKey),
            DateTimeOffset.UtcNow,
            1,
            null);

    private sealed class FakeContinuousDefinition : IDuelGameDefinition, IContinuousGameDefinition
    {
        private readonly string _format;

        public FakeContinuousDefinition(string gameType, string format, int rulesetVersion) =>
            (GameType, _format, RulesetVersion) = (gameType, format, rulesetVersion);

        public string GameType { get; }
        public string RunnerKey => "continuous";
        public int RulesetVersion { get; }
        public object PredictionConstants => new { };

        public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options)
        {
            if (options is { Count: > 0 })
                throw new InvalidGameConfigurationException("Arena options are not supported.");
            return new Dictionary<string, object?>();
        }

        public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) => _format;
        public IContinuousSimulation Create(DuelReservation reservation) => new FakeSimulation();
    }

    private sealed class FakeSimulation : IContinuousSimulation
    {
        public long Tick { get; private set; }
        public ContinuousMatchPhase Phase => ContinuousMatchPhase.Live;
        public void SetInput(long sessionId, ContinuousInput input) { }
        public void SetNeutralInput(long sessionId) { }
        public ContinuousStepResult Step()
        {
            Tick++;
            return new ContinuousStepResult(false, null);
        }
        public object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs) => new { };
        public object SpectatorSnapshot() => new { };
        public ulong DeterministicHash() => (ulong)Tick;
    }

    private sealed class NullCompletedMatchSink : ICompletedMatchSink
    {
        public void Enqueue(CompletedMatch match) { }
    }

    private sealed class NullGameEventPublisher : IGameEventPublisher
    {
        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => Task.CompletedTask;
        public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;
    }

    private static class ContinuousHarness
    {
        public static ContinuousGameCoordinator Coordinator(IContinuousGameDefinition definition) => new(
            [definition],
            TimeProvider.System,
            new NullCompletedMatchSink(),
            new NullGameEventPublisher(),
            NullLogger<ContinuousGameCoordinator>.Instance);

        public static async Task<StartedHarness> Started(long playerOneSessionId, long playerOneUserId)
        {
            var coordinator = Coordinator(new FakeContinuousDefinition("arena-knockoff", "bo3", 1));
            IDuelMatchRunnerRouter router = new DuelMatchRunnerRouter(
                [coordinator], NullLogger<DuelMatchRunnerRouter>.Instance);
            await router.StartAsync(TestReservation(
                playerOneSessionId: playerOneSessionId, playerOneUserId: playerOneUserId));
            return new StartedHarness(coordinator, router);
        }
    }

    private sealed record StartedHarness(
        ContinuousGameCoordinator Coordinator,
        IDuelMatchRunnerRouter Router);
}
