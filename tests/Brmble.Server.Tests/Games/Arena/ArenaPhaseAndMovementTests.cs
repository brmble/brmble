using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Arena;

[TestClass]
public class ArenaPhaseAndMovementTests
{
    [TestMethod]
    public void DefinitionUsesFrozenContinuousConfiguration()
    {
        var definition = new ArenaGameDefinition();

        Assert.AreEqual("arena-knockoff", definition.GameType);
        Assert.AreEqual("continuous", definition.RunnerKey);
        Assert.AreEqual(1, definition.RulesetVersion);
        Assert.AreEqual("bo3", definition.MatchFormat(definition.NormalizeOptions(null)));
        Assert.AreEqual(0, definition.NormalizeOptions(null).Count);
        Assert.AreSame(ArenaRulesetV1.PredictionConstants, definition.PredictionConstants);
        Assert.ThrowsException<InvalidGameConfigurationException>(() =>
            definition.NormalizeOptions(new Dictionary<string, object?> { ["bestOf"] = 5 }));
    }

    [TestMethod]
    public void PlayersSpawnMirroredInAscendingSessionOrder()
    {
        var sim = ArenaHarness.Create([20, 10]);

        Assert.AreEqual(0, sim.Player(10).Side);
        Assert.AreEqual(-3500, sim.Player(10).X);
        Assert.AreEqual(1, sim.Player(20).Side);
        Assert.AreEqual(3500, sim.Player(20).X);
    }

    [TestMethod]
    public void RoundIntroduction_UsesSixtyLoadingAndOneHundredEightyPositioningTicks()
    {
        var sim = ArenaHarness.AttachedAndAcknowledged();
        sim.Step(59); Assert.AreEqual(ContinuousMatchPhase.Loading, sim.Phase);
        sim.Step(1); Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
        sim.Step(179); Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
        sim.Step(1); Assert.AreEqual(ContinuousMatchPhase.Live, sim.Phase);
    }

    [TestMethod]
    public void LoadingIgnoresGameplayInput()
    {
        var sim = ArenaHarness.AttachedAndAcknowledged();
        sim.Hold(10, moveX: 32767, moveY: 0, charging: true, dash: true);

        sim.Step();

        Assert.AreEqual(-3500, sim.Player(10).X);
        Assert.AreEqual(0, sim.Player(10).ChargeTicks);
        Assert.AreEqual(0, sim.Player(10).DashTicks);
    }

    [TestMethod]
    public void PositioningAllowsMovementButNoCombatAction()
    {
        var sim = ArenaHarness.Positioning();
        sim.Hold(10, moveX: 32767, moveY: 0, charging: true, dash: true);
        sim.Step();
        Assert.AreEqual(0, sim.Player(10).ChargeTicks);
        Assert.AreEqual(0, sim.Player(10).DashTicks);
        Assert.IsTrue(sim.Player(10).DashAvailable);
        Assert.AreEqual(-3500 + 90, sim.Player(10).X);
    }

    [TestMethod]
    public void DiagonalMovementUsesNormalizedIntegerDisplacement()
    {
        var sim = ArenaHarness.Positioning();
        sim.Hold(10, moveX: 32767, moveY: 32767);

        sim.Step();

        Assert.AreEqual(-3500 + 63, sim.Player(10).X);
        Assert.AreEqual(63, sim.Player(10).Y);
    }

    [TestMethod]
    public void PositioningIgnoresVelocityWhileApplyingHeldMovement()
    {
        var sim = ArenaHarness.Positioning();
        sim.Player(10).Vx = 350;
        sim.Player(10).Vy = -151;
        sim.Hold(10, moveX: 32767, moveY: 0);

        sim.Step();

        Assert.AreEqual(-3500 + 90, sim.Player(10).X);
        Assert.AreEqual(0, sim.Player(10).Y);
        Assert.AreEqual(350, sim.Player(10).Vx);
        Assert.AreEqual(-151, sim.Player(10).Vy);
    }

    [TestMethod]
    public void MaximumChargeSlowsMovementWithoutChangingVelocity()
    {
        var sim = ArenaHarness.Live();
        sim.Player(10).ChargeTicks = 90;
        sim.Hold(10, moveX: 32767, moveY: 0, charging: true);

        sim.Step();

        Assert.AreEqual(-3500 + 45, sim.Player(10).X);
        Assert.AreEqual(0, sim.Player(10).Vx);
    }

    [TestMethod]
    public void VelocityIntegratesThenDampsTowardZero()
    {
        var sim = ArenaHarness.Live();
        sim.Player(10).Vx = 350;
        sim.Player(10).Vy = -151;

        sim.Step();

        Assert.AreEqual(-3500 + 350, sim.Player(10).X);
        Assert.AreEqual(-151, sim.Player(10).Y);
        Assert.AreEqual(322, sim.Player(10).Vx);
        Assert.AreEqual(-138, sim.Player(10).Vy);
    }

    [TestMethod]
    public void CoincidentPlayers_SeparateOnStableSessionIdAxis()
    {
        var sim = ArenaHarness.Live(sessionIds: [20, 10]);
        sim.PlaceBoth(0, 0); sim.Step();
        Assert.AreEqual(-600, sim.Player(10).X);
        Assert.AreEqual(600, sim.Player(20).X);
        Assert.AreEqual(0, sim.Player(10).Y);
        Assert.IsTrue(sim.DistanceSquared() >= 1_440_000L);
    }

    [TestMethod]
    public void Overlap_GivesTheOddUnitToTheHigherSessionId()
    {
        var sim = ArenaHarness.Live(sessionIds: [10, 20]);
        sim.Place(10, 0, 0); sim.Place(20, 1000, 0); sim.Step();
        Assert.AreEqual(-100, sim.Player(10).X);
        Assert.AreEqual(1100, sim.Player(20).X);
    }

    [TestMethod]
    public void OddPenetration_GivesTheExtraUnitToTheHigherSessionId()
    {
        var sim = ArenaHarness.Live(sessionIds: [10, 20]);
        sim.Place(10, 0, 0); sim.Place(20, 999, 0); sim.Step();
        Assert.AreEqual(-100, sim.Player(10).X);
        Assert.AreEqual(1100, sim.Player(20).X);
        Assert.AreEqual(1_440_000L, sim.DistanceSquared());
    }

    [TestMethod]
    public void CollisionChangesPositionWithoutChangingVelocity()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.Place(20, 1000, 0);
        sim.Player(10).Vx = 350;
        sim.Player(20).Vx = -151;

        sim.Step();

        Assert.AreEqual(322, sim.Player(10).Vx);
        Assert.AreEqual(-138, sim.Player(20).Vx);
        Assert.IsTrue(sim.DistanceSquared() >= 1_440_000L);
    }

    [DataTestMethod]
    [DataRow(3500, 0, true)]
    [DataRow(3501, 0, false)]
    public void BoundaryEqualityIsInside(int x, int y, bool inside)
    {
        var sim = ArenaHarness.LiveAtRadius(3500);
        Assert.AreEqual(inside, sim.IsInside(x, y));
    }

    [DataTestMethod]
    [DataRow(599, 9000, ArenaShrinkPhase.Hold)]
    [DataRow(600, 8997, ArenaShrinkPhase.Normal)]
    [DataRow(2399, 3500, ArenaShrinkPhase.Normal)]
    [DataRow(2400, 3498, ArenaShrinkPhase.Collapse)]
    [DataRow(3599, 0, ArenaShrinkPhase.Collapse)]
    [DataRow(3600, 0, ArenaShrinkPhase.Collapse)]
    public void LiveShrinkUsesExactTickBoundaries(int liveTick, int radius, ArenaShrinkPhase shrinkPhase)
    {
        var sim = ArenaHarness.LiveAtTick(liveTick);

        Assert.AreEqual(radius, sim.Radius);
        Assert.AreEqual(shrinkPhase, sim.ShrinkPhase);
    }

    private sealed class ArenaHarness
    {
        private readonly ArenaSimulation _simulation;

        private ArenaHarness(ArenaSimulation simulation) => _simulation = simulation;

        public ContinuousMatchPhase Phase => _simulation.Phase;
        public IReadOnlyList<int> Score => _simulation.Score;
        public IReadOnlyList<ArenaProjectile> Projectiles => _simulation.Projectiles;
        public int Radius => _simulation.ArenaRadius;
        public ArenaShrinkPhase ShrinkPhase => _simulation.ShrinkPhase;

        public static ArenaHarness Create(long[]? sessionIds = null)
        {
            sessionIds ??= [10, 20];
            var reservation = new DuelReservation(
                9,
                7,
                new DuelPlayer(sessionIds[0], 501, "Alice"),
                new DuelPlayer(sessionIds[1], 502, "Bob"),
                new DuelConfiguration("arena-knockoff", "bo3", 1,
                    new Dictionary<string, object?>(), "continuous"),
                DateTimeOffset.UtcNow,
                1,
                null);
            return new ArenaHarness(new ArenaSimulation(reservation));
        }

        public static ArenaHarness AttachedAndAcknowledged(long[]? sessionIds = null)
        {
            var harness = Create(sessionIds);
            foreach (var sessionId in sessionIds ?? [10, 20])
                harness._simulation.MarkParticipantReady(sessionId);
            return harness;
        }

        public static ArenaHarness Positioning()
        {
            var harness = AttachedAndAcknowledged();
            harness.Step(ArenaRulesetV1.LoadingTicks);
            return harness;
        }

        public static ArenaHarness Live(long[]? sessionIds = null)
        {
            var harness = AttachedAndAcknowledged(sessionIds);
            harness.Step(ArenaRulesetV1.LoadingTicks + ArenaRulesetV1.PositioningTicks);
            return harness;
        }

        public static ArenaHarness LiveAtRadius(int radius)
        {
            var liveTick = radius == ArenaRulesetV1.CombatArenaRadius ? 2399 : 0;
            return LiveAtTick(liveTick);
        }

        public static ArenaHarness LiveAtTick(int liveTick)
        {
            var harness = Live();
            harness.Step(liveTick);
            return harness;
        }

        public void Step(int n = 1)
        {
            for (var i = 0; i < n; i++)
                _simulation.Step();
        }

        public void Place(long sessionId, int x, int y)
        {
            Player(sessionId).X = x;
            Player(sessionId).Y = y;
        }

        public void PlaceBoth(int x, int y)
        {
            foreach (var player in _simulation.Players)
                Place(player.SessionId, x, y);
        }

        public void Hold(long sessionId, short moveX, short moveY, bool charging = false, bool dash = false) =>
            _simulation.SetInput(sessionId,
                new ContinuousInput(1, _simulation.Tick, moveX, moveY, 32767, 0, charging, false, dash));

        public ArenaPlayerState Player(long sessionId) =>
            _simulation.Players.Single(player => player.SessionId == sessionId);

        public long DistanceSquared()
        {
            var low = _simulation.Players[0];
            var high = _simulation.Players[1];
            var dx = (long)high.X - low.X;
            var dy = (long)high.Y - low.Y;
            return checked(dx * dx + dy * dy);
        }

        public bool IsInside(int x, int y) => _simulation.IsInsideArena(x, y);
    }
}
