using Brmble.Server.Games;
using Brmble.Server.Games.Arena;
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
            h.Submit(Input(1, predictedTick: 1_000, moveX: 32_767, moveY: 256)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange,
            h.Submit(Input(1, predictedTick: 1_000, aimX: 23_171, aimY: 23_170)).Reason);
        Assert.AreEqual(ContinuousRejectReason.InvalidRange,
            h.Submit(Input(1, predictedTick: 1_000, moveX: -32_768)).Reason);
        Assert.IsTrue(h.Submit(Input(1, predictedTick: 880,
            moveX: 23_170, moveY: 23_170, aimX: -23_170, aimY: 23_170)).Accepted);
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
    public async Task HeartbeatRate_IsTwelvePerRollingSecondSoTheExemptionCannotBeAbused()
    {
        var h = await CoordinatorHarness.Started();

        for (var sequence = 1; sequence <= 12; sequence++)
            Assert.IsTrue(h.Submit(Input(sequence, moveY: -32_767), heartbeat: true).Accepted, $"beat {sequence}");

        // The exemption exists so held state survives an input flood, not as an
        // unmetered channel: the client sends four a second and has no reason to reach
        // twelve.
        Assert.AreEqual(ContinuousRejectReason.RateLimited,
            h.Submit(Input(13, moveY: -32_767), heartbeat: true).Reason);

        h.Time.Advance(TimeSpan.FromSeconds(1));
        Assert.IsTrue(h.Submit(Input(13, moveY: -32_767), heartbeat: true).Accepted);
    }
    [TestMethod]
    public async Task MessageRate_HeartbeatStillRefreshesHeldStateWhenTheInputBudgetIsSpent()
    {
        var h = await CoordinatorHarness.Started();

        // Mashing direction keys while spam clicking measures around 115 messages a
        // second on the wire, so the input budget is genuinely reachable in normal play.
        for (var sequence = 1; sequence <= 120; sequence++)
            h.Submit(Input(sequence, moveY: -32_767));
        Assert.AreEqual(ContinuousRejectReason.RateLimited, h.Submit(Input(121, moveY: -32_767)).Reason);

        // The heartbeat carries held state and nothing else. If it is rejected too, a
        // player who keeps mashing never recovers the movement that was dropped, which
        // is the difference between a dropped frame and a character that stops
        // responding until you let go.
        var beat = h.Submit(Input(121, moveY: -32_767), heartbeat: true);

        Assert.IsTrue(beat.Accepted, $"heartbeat was rejected: {beat.Reason}");
        Assert.AreEqual(-32_767, h.Simulation.LastInput(10).MoveY);
    }
    [TestMethod]
    public async Task AimChangeRate_IsFortyFivePerRollingSecondAndDoesNotCountUnchangedAim()
    {
        var h = await CoordinatorHarness.Started();

        for (var sequence = 1; sequence <= 45; sequence++)
        {
            var aimY = (short)(sequence % 2 == 0 ? 1 : -1);
            Assert.IsTrue(h.Submit(Input(sequence, aimX: 32_766, aimY: aimY)).Accepted);
        }

        // Sequence 45 is odd, so the accepted aim ends on -1. Repeating it costs
        // nothing: an unchanged aim never touches the budget.
        Assert.IsTrue(h.Submit(Input(46, aimX: 32_766, aimY: -1)).Accepted);

        // Over budget the input is still accepted - movement, charging and dash ride on
        // the same message and are innocent - but the aim is clamped to the last one
        // that fit the budget, so aim spam gains the sender nothing.
        Assert.IsTrue(h.Submit(Input(47, aimX: 32_766, aimY: 1)).Accepted);
        Assert.AreEqual(-1, h.Simulation.LastInput(10).AimY);

        h.Time.Advance(TimeSpan.FromSeconds(1));
        Assert.IsTrue(h.Submit(Input(48, aimX: 32_766, aimY: 1)).Accepted);
        Assert.AreEqual(1, h.Simulation.LastInput(10).AimY);
    }


    [TestMethod]
    public async Task AimChangeRate_ClampedAimDoesNotKeepSpendingTheBudget()
    {
        var h = await CoordinatorHarness.Started();

        var sequence = 1;
        for (; sequence <= 45; sequence++)
        {
            var aimY = (short)(sequence % 2 == 0 ? 1 : -1);
            Assert.IsTrue(h.Submit(Input(sequence, aimX: 32_766, aimY: aimY)).Accepted);
        }

        // Spam continues while over budget. These are clamped, so they change nothing
        // and must not enqueue fresh timestamps: if they did, the player would hold
        // themselves rate limited for as long as they kept clicking. Enough of them to
        // refill the whole budget on their own if they were counted.
        h.Time.Advance(TimeSpan.FromMilliseconds(500));
        for (var extra = 0; extra < 70; extra++, sequence++)
            Assert.IsTrue(h.Submit(Input(sequence, aimX: 32_766, aimY: (short)(extra % 2 == 0 ? 1 : -1))).Accepted);

        // Past the original window but not past the spam above, and probing with an aim
        // that genuinely differs from the clamped one so it has to spend budget.
        h.Time.Advance(TimeSpan.FromMilliseconds(600));
        Assert.IsTrue(h.Submit(Input(sequence, aimX: 32_766, aimY: -1)).Accepted);
        Assert.AreEqual(-1, h.Simulation.LastInput(10).AimY, "the budget should have recovered");
    }
    [TestMethod]
    public async Task ActionValidation_UsesExactPhaseCooldownAndDashSpentReasons()
    {
        var h = await CoordinatorHarness.Started(phase: ContinuousMatchPhase.Positioning);

        Assert.IsTrue(h.Submit(Input(1, charging: true)).Accepted);
        Assert.AreEqual(ContinuousRejectReason.PhaseDenied, h.Submit(Input(2, fireReleased: true)).Reason);
        Assert.AreEqual(ContinuousRejectReason.PhaseDenied, h.Submit(Input(2, dash: true)).Reason);
        h.Simulation.Phase = ContinuousMatchPhase.Live;
        Assert.IsTrue(h.Submit(Input(2, fireReleased: true)).Accepted);
        Assert.IsTrue(h.Submit(Input(3)).Accepted);
        Assert.AreEqual(ContinuousRejectReason.Cooldown, h.Submit(Input(4, fireReleased: true)).Reason);
        Assert.IsTrue(h.Submit(Input(4, charging: true)).Accepted);

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

    [DataTestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task Arena_StationaryAimOnlyMessagePreservesSubmittedAim(bool heartbeat)
    {
        var h = await ArenaCoordinatorHarness.Live();

        Assert.IsTrue(h.Submit(
            Input(1, predictedTick: h.Simulation.Tick, aimX: 0, aimY: 32_767), heartbeat).Accepted);
        h.Simulation.Step();

        Assert.AreEqual(0, h.Player.AimX);
        Assert.AreEqual(32_767, h.Player.AimY);
    }

    [TestMethod]
    public async Task Arena_DashEdgeSurvivesHeartbeatUntilStepAndDoesNotRepeat()
    {
        var h = await ArenaCoordinatorHarness.Live();
        Assert.IsTrue(h.Submit(Input(1, predictedTick: h.Simulation.Tick, dash: true)).Accepted);
        Assert.IsTrue(h.Submit(Input(2, predictedTick: h.Simulation.Tick), heartbeat: true).Accepted);

        h.Simulation.Step();
        Assert.IsFalse(h.Player.DashAvailable);
        Assert.AreEqual(5, h.Player.DashTicks);
        h.Simulation.Step();

        Assert.AreEqual(4, h.Player.DashTicks);
    }

    [TestMethod]
    public async Task Arena_FireEdgeSurvivesExplicitNeutralUntilStepAndDoesNotRepeat()
    {
        var h = await ArenaCoordinatorHarness.Live();
        // These pin the input edge latch, not the charge gate; arm the charge so the release is allowed to produce the shot they count.
        h.Player.ChargeTicks = ArenaRulesetV1.MinChargeTicks;
        Assert.IsTrue(h.Submit(Input(1, predictedTick: h.Simulation.Tick, fireReleased: true)).Accepted);
        Assert.IsTrue(h.Submit(Input(2, predictedTick: h.Simulation.Tick, aimX: 0, aimY: 32_767)).Accepted);

        h.Simulation.Step();
        Assert.AreEqual(1, h.Simulation.Projectiles.Count);
        Assert.AreEqual(0, h.Simulation.Projectiles[0].Vx);
        Assert.AreEqual(240, h.Simulation.Projectiles[0].Vy);
        h.Simulation.Step();

        Assert.AreEqual(1, h.Simulation.Projectiles.Count);
    }

    [TestMethod]
    public async Task Arena_ConsumedDashLatchClearsBeforeOrdinaryInputAndNextStep()
    {
        var h = await ArenaCoordinatorHarness.Live();
        Assert.IsTrue(h.Submit(Input(1, predictedTick: h.Simulation.Tick, dash: true)).Accepted);

        h.Simulation.Step();
        Assert.IsFalse(h.Player.Input.Dash);
        Assert.IsTrue(h.Submit(Input(2, predictedTick: h.Simulation.Tick)).Accepted);
        h.Simulation.Step();

        Assert.IsFalse(h.Player.Input.Dash);
        Assert.AreEqual(4, h.Player.DashTicks);
    }

    [TestMethod]
    public async Task Arena_ConsumedFireLatchClearsBeforeOrdinaryInputAndNextStep()
    {
        var h = await ArenaCoordinatorHarness.Live();
        // These pin the input edge latch, not the charge gate; arm the charge so the release is allowed to produce the shot they count.
        h.Player.ChargeTicks = ArenaRulesetV1.MinChargeTicks;
        Assert.IsTrue(h.Submit(Input(1, predictedTick: h.Simulation.Tick, fireReleased: true)).Accepted);

        h.Simulation.Step();
        Assert.IsFalse(h.Player.Input.FireReleased);
        Assert.IsTrue(h.Submit(Input(2, predictedTick: h.Simulation.Tick)).Accepted);
        h.Simulation.Step();

        Assert.IsFalse(h.Player.Input.FireReleased);
        Assert.AreEqual(1, h.Simulation.Projectiles.Count);
    }

    [TestMethod]
    public async Task Arena_NeutralTimeoutDoesNotErasePendingDashEdge()
    {
        var h = await ArenaCoordinatorHarness.Live();
        Assert.IsTrue(h.Submit(Input(1, predictedTick: h.Simulation.Tick, moveX: 100, dash: true)).Accepted);

        h.Time.Advance(TimeSpan.FromMilliseconds(751));
        h.Simulation.Step();

        Assert.IsFalse(h.Player.DashAvailable);
        Assert.AreEqual(5, h.Player.DashTicks);
        Assert.AreEqual(240, h.Player.X + ArenaRulesetV1.SpawnOffset);
    }

    [TestMethod]
    public async Task Arena_DashReservationRemainsSpentUntilAuthoritativeRoundReset()
    {
        var h = await ArenaCoordinatorHarness.Live();
        Assert.IsTrue(h.Submit(Input(1, predictedTick: h.Simulation.Tick, dash: true)).Accepted);
        Assert.IsTrue(h.Submit(Input(2, predictedTick: h.Simulation.Tick)).Accepted);

        Assert.AreEqual(ContinuousRejectReason.DashSpent,
            h.Submit(Input(3, predictedTick: h.Simulation.Tick, dash: true)).Reason);
        h.Simulation.Step();
        Assert.IsTrue(h.Submit(Input(3, predictedTick: h.Simulation.Tick)).Accepted);
        Assert.AreEqual(ContinuousRejectReason.DashSpent,
            h.Submit(Input(4, predictedTick: h.Simulation.Tick, dash: true)).Reason);

        h.Player.X = 9_001;
        h.Simulation.Step();
        while (h.Simulation.Phase is ContinuousMatchPhase.Loading or ContinuousMatchPhase.Positioning)
            h.Simulation.Step();
        Assert.IsTrue(h.Submit(Input(4, predictedTick: h.Simulation.Tick, dash: true)).Accepted);
    }

    [TestMethod]
    public async Task Arena_AimRateRejectionMustNotDiscardMovementOnTheSameInput()
    {
        var h = await ArenaCoordinatorHarness.Live();

        // The client substitutes the last transmitted aim on frames inside its 40ms
        // window rather than delaying them, so a spam-clicking player transmits an aim
        // that oscillates between the stale direction and the true one. The server
        // counts every flip as an aim change, so the budget burns twice as fast as the
        // client's throttle intends.
        var sequence = 1L;
        for (var flip = 0; flip < 30; flip++)
        {
            var aimX = (short)(flip % 2 == 0 ? -32_767 : 32_767);
            h.Submit(Input(sequence++, predictedTick: h.Simulation.Tick, aimX: aimX, charging: flip % 2 == 0));
        }

        // The player is holding W throughout; this is the frame carrying that edge.
        var move = h.Submit(Input(sequence, predictedTick: h.Simulation.Tick, moveY: -32_767, aimX: -32_767));
        h.Simulation.Step();

        // An aim-rate violation must not silently cost the player their movement. The
        // aim may be clamped or dropped; MoveY rode on the same message and is innocent.
        Assert.AreNotEqual(0, h.Player.Input.MoveY,
            $"movement was discarded by an aim-rate rejection (reason: {move.Reason})");
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
            await AttachBothAsync(coordinator, result.MatchId);
            return new CoordinatorHarness(coordinator, result.MatchId, time, definition.Simulation!);
        }
    }

    private sealed class ArenaCoordinatorHarness
    {
        private ArenaCoordinatorHarness(
            ContinuousGameCoordinator coordinator, long matchId, ManualTimeProvider time, ArenaSimulation simulation)
        {
            Coordinator = coordinator;
            MatchId = matchId;
            Time = time;
            Simulation = simulation;
        }

        public ContinuousGameCoordinator Coordinator { get; }
        public long MatchId { get; }
        public ManualTimeProvider Time { get; }
        public ArenaSimulation Simulation { get; }
        public ArenaPlayerState Player => Simulation.Players.Single(player => player.SessionId == 10);

        public InputResult Submit(ContinuousInput input, bool heartbeat = false) =>
            Coordinator.SubmitInput(MatchId, 10, RealtimeRole.Participant, input, heartbeat);

        public static async Task<ArenaCoordinatorHarness> Live()
        {
            var time = new ManualTimeProvider();
            var definition = new CapturingArenaDefinition();
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
                new DuelConfiguration("arena-knockoff", "bo3", 1,
                    new Dictionary<string, object?>(), "continuous"),
                DateTimeOffset.UtcNow,
                1,
                null));
            Assert.IsTrue(result.Success);
            var simulation = definition.Simulation!;
            simulation.MarkParticipantReady(10);
            simulation.MarkParticipantReady(20);
            for (var tick = 0; tick < ArenaRulesetV1.LoadingTicks + ArenaRulesetV1.PositioningTicks; tick++)
                simulation.Step();
            Assert.AreEqual(ContinuousMatchPhase.Live, simulation.Phase);
            await AttachBothAsync(coordinator, result.MatchId);
            return new ArenaCoordinatorHarness(coordinator, result.MatchId, time, simulation);
        }
    }

    private static async Task AttachBothAsync(ContinuousGameCoordinator coordinator, long matchId)
    {
        foreach (var participant in new[] { (501L, 10L, "one"), (502L, 20L, "two") })
        {
            var attached = await coordinator.AttachParticipantAsync(
                matchId, participant.Item1, participant.Item2, participant.Item3,
                new RealtimeSnapshotMailbox());
            Assert.IsTrue(attached.Ok, attached.Error);
            coordinator.AcknowledgeAttach(participant.Item3, attached.Welcome!.SnapshotSequence);
        }
    }

    private sealed class CapturingArenaDefinition : IContinuousGameDefinition
    {
        public ArenaSimulation? Simulation { get; private set; }
        public string GameType => "arena-knockoff";
        public int RulesetVersion => ArenaRulesetV1.Version;
        public object PredictionConstants => ArenaRulesetV1.PredictionConstants;
        public IContinuousSimulation Create(DuelReservation reservation) => Simulation = new ArenaSimulation(reservation);
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
        public ContinuousInput LastInput(long sessionId) => _inputs[sessionId];

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
