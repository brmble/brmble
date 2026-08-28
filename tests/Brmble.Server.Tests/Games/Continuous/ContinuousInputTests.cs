using Brmble.Server.Games;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Continuous;

[TestClass]
public class ContinuousInputTests
{
    [TestMethod]
    public async Task SubmitInput_AcceptsTheExactlyNextParticipantSequence()
    {
        var h = await CoordinatorHarness.Started();

        var result = h.Coordinator.SubmitInput(
            h.MatchId, 10, RealtimeRole.Participant, Input(sequence: 1), isHeartbeat: false);

        Assert.IsTrue(result.Accepted);
        Assert.AreEqual(1L, result.AcknowledgedInput);
    }

    [TestMethod]
    public async Task Validation_UsesMatchRoleThenSequenceOrderWithoutAdvancingAcknowledgement()
    {
        var h = await CoordinatorHarness.Started();

        Assert.AreEqual(ContinuousRejectReason.WrongMatch,
            h.Submit(Input(1), matchId: h.MatchId + 1, role: RealtimeRole.Spectator).Reason);
        Assert.AreEqual(ContinuousRejectReason.WrongMatch,
            h.Submit(Input(1), sessionId: 99).Reason);
        Assert.AreEqual(ContinuousRejectReason.WrongRole,
            h.Submit(Input(1), role: RealtimeRole.Spectator).Reason);
        Assert.IsTrue(h.Submit(Input(1)).Accepted);
        Assert.AreEqual(ContinuousRejectReason.StaleSequence, h.Submit(Input(1, predictedTick: -121)).Reason);
        var gap = h.Submit(Input(3, predictedTick: -121));
        Assert.AreEqual(ContinuousRejectReason.SequenceGap, gap.Reason);
        Assert.AreEqual(1L, gap.AcknowledgedInput);
        Assert.IsTrue(h.Submit(Input(2)).Accepted);
    }

    [TestMethod]
    public async Task RangeValidation_UsesInclusiveTickAndNormalizedVectorBoundaries()
    {
        var h = await CoordinatorHarness.Started(serverTick: 1_000);

        Assert.AreEqual(ContinuousRejectReason.InvalidRange, h.Submit(Input(1, predictedTick: 879)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange, h.Submit(Input(1, predictedTick: 1_031)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange, h.Submit(Input(1, predictedTick: 1_000, aimX: 0)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange,
            h.Submit(Input(1, predictedTick: 1_000, moveX: 32_767, moveY: 1)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange,
            h.Submit(Input(1, predictedTick: 1_000, aimX: 23_171, aimY: 23_170)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange,
            h.Submit(Input(1, predictedTick: 1_000, moveX: -32_768)).Reason);
        Assert.IsTrue(h.Submit(Input(1, predictedTick: 880, moveX: 100, moveY: -200, aimX: 100)).Accepted);
    }

    [TestMethod]
    public async Task Heartbeat_AcceptsCompleteHeldStateButRejectsEdges()
    {
        var h = await CoordinatorHarness.Started();

        Assert.AreEqual(ContinuousRejectReason.InvalidRange,
            h.Submit(Input(1, fireReleased: true), heartbeat: true).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange,
            h.Submit(Input(1, dash: true), heartbeat: true).Reason);
        Assert.IsTrue(h.Submit(Input(1, moveX: 100, charging: true), heartbeat: true).Accepted);
    }

    [TestMethod]
    public async Task MessageRate_IsOneHundredTwentyPerRollingSecondWithExactBoundaryExpiry()
    {
        var h = await CoordinatorHarness.Started();

        for (var sequence = 1; sequence <= 120; sequence++)
            Assert.IsTrue(h.Submit(Input(sequence)).Accepted, $"Sequence {sequence}");

        Assert.AreEqual(ContinuousRejectReason.RateLimited, h.Submit(Input(121)).Reason);
        h.Time.Advance(TimeSpan.FromMilliseconds(999));
        Assert.AreEqual(ContinuousRejectReason.RateLimited, h.Submit(Input(121)).Reason);
        h.Time.Advance(TimeSpan.FromMilliseconds(1));
        Assert.IsTrue(h.Submit(Input(121)).Accepted);
    }

    [TestMethod]
    public async Task RateLimit_DoesNotMaskSequenceOrRangeReasons()
    {
        var h = await CoordinatorHarness.Started();
        for (var sequence = 1; sequence <= 120; sequence++)
            Assert.IsTrue(h.Submit(Input(sequence)).Accepted);

        Assert.AreEqual(ContinuousRejectReason.StaleSequence, h.Submit(Input(120)).Reason);
        Assert.AreEqual(ContinuousRejectReason.SequenceGap, h.Submit(Input(122)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange, h.Submit(Input(121, predictedTick: 31)).Reason);
        Assert.AreEqual(ContinuousRejectReason.RateLimited, h.Submit(Input(121)).Reason);
    }

    [TestMethod]
    public async Task AimChangeRate_IsThirtyPerRollingSecondAndDoesNotCountUnchangedAim()
    {
        var h = await CoordinatorHarness.Started();

        for (var sequence = 1; sequence <= 30; sequence++)
        {
            var aimY = (short)(sequence % 2 == 0 ? 1 : -1);
            Assert.IsTrue(h.Submit(Input(sequence, aimX: 32_766, aimY: aimY)).Accepted);
        }

        Assert.IsTrue(h.Submit(Input(31, aimX: 32_766, aimY: 1)).Accepted);
        Assert.AreEqual(ContinuousRejectReason.RateLimited,
            h.Submit(Input(32, aimX: 32_766, aimY: -1)).Reason);
        h.Time.Advance(TimeSpan.FromSeconds(1));
        Assert.IsTrue(h.Submit(Input(32, aimX: 32_766, aimY: -1)).Accepted);
    }

    [TestMethod]
    public async Task ActionValidation_UsesExactPhaseCooldownAndDashSpentReasons()
    {
        var h = await CoordinatorHarness.Started(phase: ContinuousMatchPhase.Positioning);

        Assert.AreEqual(ContinuousRejectReason.PhaseDenied, h.Submit(Input(1, charging: true)).Reason);
        Assert.AreEqual(ContinuousRejectReason.PhaseDenied, h.Submit(Input(1, fireReleased: true)).Reason);
        Assert.AreEqual(ContinuousRejectReason.PhaseDenied, h.Submit(Input(1, dash: true)).Reason);
        h.Simulation.Phase = ContinuousMatchPhase.Live;
        Assert.IsTrue(h.Submit(Input(1, fireReleased: true)).Accepted);
        Assert.IsTrue(h.Submit(Input(2)).Accepted);
        Assert.AreEqual(ContinuousRejectReason.Cooldown, h.Submit(Input(3, fireReleased: true)).Reason);
        Assert.AreEqual(ContinuousRejectReason.Cooldown, h.Submit(Input(3, charging: true)).Reason);

        var dash = await CoordinatorHarness.Started();
        Assert.IsTrue(dash.Submit(Input(1, dash: true)).Accepted);
        Assert.IsTrue(dash.Submit(Input(2)).Accepted);
        Assert.AreEqual(ContinuousRejectReason.DashSpent, dash.Submit(Input(3, dash: true)).Reason);
    }

    [TestMethod]
    public async Task AcceptedInput_NeutralizesOnlyAfterSevenHundredFiftyMilliseconds()
    {
        var h = await CoordinatorHarness.Started();
        Assert.IsTrue(h.Submit(Input(1, moveX: 100, charging: true, dash: true)).Accepted);

        h.Time.Advance(TimeSpan.FromMilliseconds(750));
        Assert.IsFalse(h.Simulation.IsNeutral(10));
        Assert.IsFalse(h.Simulation.DashAvailable);
        h.Time.Advance(TimeSpan.FromMilliseconds(1));

        Assert.IsTrue(h.Simulation.IsNeutral(10));
        Assert.IsFalse(h.Simulation.DashAvailable);
    }

    [TestMethod]
    public async Task AcceptedHeartbeat_RefreshesNeutralDeadlineAndNeutralReleaseIsImmediate()
    {
        var h = await CoordinatorHarness.Started();
        Assert.IsTrue(h.Submit(Input(1, moveX: 100)).Accepted);
        h.Time.Advance(TimeSpan.FromMilliseconds(500));
        Assert.IsTrue(h.Submit(Input(2, moveX: 100), heartbeat: true).Accepted);
        h.Time.Advance(TimeSpan.FromMilliseconds(500));
        Assert.IsFalse(h.Simulation.IsNeutral(10));

        Assert.IsTrue(h.Submit(Input(3)).Accepted);
        Assert.IsTrue(h.Simulation.IsNeutral(10));
    }

    [TestMethod]
    public async Task MatchTeardown_NeutralizesBothParticipants()
    {
        var h = await CoordinatorHarness.Started();
        Assert.IsTrue(h.Submit(Input(1, moveX: 100)).Accepted);
        Assert.IsTrue(h.Submit(Input(1, moveX: 100), sessionId: 20).Accepted);

        await h.Coordinator.ForfeitAsync(h.MatchId, 501, "test");

        Assert.IsTrue(h.Simulation.IsNeutral(10));
        Assert.IsTrue(h.Simulation.IsNeutral(20));
    }

    private static ContinuousInput Input(
        long sequence,
        long predictedTick = 0,
        short moveX = 0,
        short moveY = 0,
        short aimX = 32_767,
        short aimY = 0,
        bool charging = false,
        bool fireReleased = false,
        bool dash = false) =>
        new(sequence, predictedTick, moveX, moveY, aimX, aimY, charging, fireReleased, dash);

    private sealed class CoordinatorHarness
    {
        private CoordinatorHarness(
            ContinuousGameCoordinator coordinator, long matchId, ManualTimeProvider time, TestSimulation simulation)
        {
            Coordinator = coordinator;
            MatchId = matchId;
            Time = time;
            Simulation = simulation;
        }

        public ContinuousGameCoordinator Coordinator { get; }
        public long MatchId { get; }
        public ManualTimeProvider Time { get; }
        public TestSimulation Simulation { get; }

        public InputResult Submit(
            ContinuousInput input,
            long? matchId = null,
            long sessionId = 10,
            RealtimeRole role = RealtimeRole.Participant,
            bool heartbeat = false) =>
            Coordinator.SubmitInput(matchId ?? MatchId, sessionId, role, input, heartbeat);

        public static async Task<CoordinatorHarness> Started(
            long serverTick = 0,
            ContinuousMatchPhase phase = ContinuousMatchPhase.Live)
        {
            var time = new ManualTimeProvider();
            var definition = new TestDefinition(serverTick, phase);
            var coordinator = new ContinuousGameCoordinator(
                [definition],
                time,
                new NullCompletedMatchSink(),
                new NullGameEventPublisher(),
                NullLogger<ContinuousGameCoordinator>.Instance);
            var result = await coordinator.StartAsync(new DuelReservation(
                9,
                7,
                new DuelPlayer(10, 501, "Alice"),
                new DuelPlayer(20, 502, "Bob"),
                new DuelConfiguration("test", "bo3", 1, new Dictionary<string, object?>(), "continuous"),
                DateTimeOffset.UtcNow,
                1,
                null));
            Assert.IsTrue(result.Success);
            return new CoordinatorHarness(coordinator, result.MatchId, time, definition.Simulation!);
        }
    }

    private sealed class TestDefinition(long tick, ContinuousMatchPhase phase) : IContinuousGameDefinition
    {
        public TestSimulation? Simulation { get; private set; }
        public string GameType => "test";
        public int RulesetVersion => 1;
        public object PredictionConstants => new { };
        public IContinuousSimulation Create(DuelReservation reservation) => Simulation = new TestSimulation
        {
            Tick = tick,
            Phase = phase,
        };
    }

    private sealed class TestSimulation : IContinuousSimulation
    {
        private readonly Dictionary<long, ContinuousInput> _inputs = [];
        public long Tick { get; set; }
        public ContinuousMatchPhase Phase { get; set; } = ContinuousMatchPhase.Live;
        public bool DashAvailable { get; private set; } = true;
        public void SetInput(long sessionId, ContinuousInput input)
        {
            _inputs[sessionId] = input;
            if (input.Dash)
                DashAvailable = false;
        }
        public void SetNeutralInput(long sessionId) =>
            _inputs[sessionId] = Input(0, aimX: 32_767);
        public bool IsNeutral(long sessionId) =>
            _inputs.TryGetValue(sessionId, out var input)
            && input.MoveX == 0
            && input.MoveY == 0
            && !input.Charging
            && !input.FireReleased
            && !input.Dash;
        public ContinuousStepResult Step() => new(false, null);
        public object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs) => new { };
        public object SpectatorSnapshot() => new { };
        public ulong DeterministicHash() => 0;
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private readonly List<ManualTimer> _timers = [];
        private long _timestamp;
        public override long TimestampFrequency => 1_000;
        public override long GetTimestamp() => _timestamp;
        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddMilliseconds(_timestamp);
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ManualTimer(this, callback, state, dueTime, period);
            _timers.Add(timer);
            return timer;
        }
        public void Advance(TimeSpan by)
        {
            _timestamp += (long)by.TotalMilliseconds;
            foreach (var timer in _timers.ToArray())
                timer.FireIfDue();
        }
        private sealed class ManualTimer : ITimer
        {
            private readonly ManualTimeProvider _owner;
            private readonly TimerCallback _callback;
            private readonly object? _state;
            private long _due;
            private long _period;
            private bool _disposed;
            public ManualTimer(
                ManualTimeProvider owner, TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
            {
                _owner = owner;
                _callback = callback;
                _state = state;
                Change(dueTime, period);
            }
            public bool Change(TimeSpan dueTime, TimeSpan period)
            {
                if (_disposed) return false;
                _due = dueTime == Timeout.InfiniteTimeSpan
                    ? long.MaxValue
                    : _owner._timestamp + (long)dueTime.TotalMilliseconds;
                _period = period == Timeout.InfiniteTimeSpan ? 0 : (long)period.TotalMilliseconds;
                return true;
            }
            public void FireIfDue()
            {
                if (_disposed || _owner._timestamp < _due) return;
                _due = _period > 0 ? _due + _period : long.MaxValue;
                _callback(_state);
            }
            public void Dispose() => _disposed = true;
            public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
        }
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
}
