using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Arena;

[TestClass]
public class ArenaCombatTests
{
    [TestMethod]
    public void ReleaseBelowMinimumCharge_FiresNothingAndCostsNoCooldown()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.HoldCharge(10);
        sim.Step(ArenaRulesetV1.MinChargeTicks - 1);

        sim.ReleaseFireRaw(10);
        sim.Step();

        Assert.AreEqual(0, sim.Projectiles.Count);
        // Refusing costs nothing: the shot never happened, so there is no recovery
        // to pay for. Only Fire starts the cooldown, so this falls out of not firing.
        Assert.AreEqual(0, sim.Player(10).CooldownTicks);
    }

    [TestMethod]
    public void ReleaseBelowMinimumCharge_DoesNotBankProgressTowardTheNextShot()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.HoldCharge(10);
        sim.Step(ArenaRulesetV1.MinChargeTicks - 1);

        sim.ReleaseFireRaw(10);
        sim.Step();

        // A refused release cancels the charge outright. Without the reset the ticks
        // would simply sit there, and a second tap would fire off the first one's work.
        Assert.AreEqual(0, sim.Player(10).ChargeTicks);
    }

    [TestMethod]
    public void ReleaseAtExactlyMinimumCharge_Fires()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.HoldCharge(10);
        sim.Step(ArenaRulesetV1.MinChargeTicks);

        sim.ReleaseFireRaw(10);
        sim.Step();

        Assert.AreEqual(1, sim.Projectiles.Count);
        Assert.AreEqual(ArenaRulesetV1.ShotCooldownTicks, sim.Player(10).CooldownTicks);
    }

    [TestMethod]
    public void MaximumCharge_ForceFiresAfterThirtyTicksAndStartsTwentyFourTickCooldown()
    {
        var sim = ArenaHarness.Live();
        sim.HoldCharge(10);

        sim.Step(119);

        Assert.AreEqual(0, sim.Projectiles.Count);
        sim.Step();
        Assert.AreEqual(1, sim.Projectiles.Count);
        Assert.AreEqual(24, sim.Player(10).CooldownTicks);
        Assert.AreEqual(1000, sim.Projectiles[0].ChargePermille);
    }

    [TestMethod]
    public void MaximumCharge_DoesNotRestartForcedFireWithoutTheTransition()
    {
        var sim = ArenaHarness.Live();
        sim.Player(10).ChargeTicks = 90;
        sim.HoldCharge(10);

        sim.Step(30);

        Assert.AreEqual(0, sim.Projectiles.Count);
        Assert.AreEqual(0, sim.Player(10).ForcedFireTicks);
    }

    [TestMethod]
    public void ReleaseAtZeroChargeFiresImmediatelyAndCooldownBlocksTheNextCharge()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.ReleaseFire(10);

        sim.Step();

        Assert.AreEqual(1, sim.Projectiles.Count);
        sim.HoldCharge(10);
        sim.Step(23);
        Assert.AreEqual(0, sim.Player(10).ChargeTicks);
        Assert.AreEqual(1, sim.Player(10).CooldownTicks);
    }

    [TestMethod]
    public void FireReleaseIsRisingEdgeDeduplicated()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.ReleaseFire(10, aimX: 0, aimY: 32767);
        sim.Step(25);

        Assert.AreEqual(1, sim.Projectiles.Count);
        sim.Neutral(10); sim.Step();
        sim.ReleaseFire(10, aimX: 0, aimY: 32767); sim.Step();
        Assert.AreEqual(2, sim.Projectiles.Count);
    }

    [TestMethod]
    public void ReleasedChargeControlsRecoilButNotProjectileSpeed()
    {
        var low = ArenaHarness.Live();
        low.ReleaseFire(10); low.Step();
        var high = ArenaHarness.Live();
        high.Player(10).ChargeTicks = 90;
        high.ReleaseFire(10); high.Step();

        Assert.AreEqual(180, ArenaRulesetV1.ProjectileRadius);
        Assert.AreEqual(57_600L, low.ProjectileVelocityLengthSquared(0));
        Assert.AreEqual(57_600L, high.ProjectileVelocityLengthSquared(0));
        // The weakest shot the game allows is the minimum charge, not zero: permille
        // 333, so recoil is 45 + 105 * 333 / 1000 = 79, damped to 79 * 920 / 1000 = 72.
        Assert.AreEqual(-72, low.Player(10).Vx);
        Assert.AreEqual(-138, high.Player(10).Vx);
        Assert.AreEqual(-3500 - 79, low.Player(10).X);
        Assert.AreEqual(-3500 - 150, high.Player(10).X);
    }

    [TestMethod]
    public void ProjectileSpawnsAtCombinedRadiiAndAdvancesInItsSpawnTick()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.ReleaseFire(10, aimX: 0, aimY: 32767);

        sim.Step();

        Assert.AreEqual(0, sim.Projectiles[0].X);
        Assert.AreEqual(1020, sim.Projectiles[0].Y);
        Assert.AreEqual(0, sim.Projectiles[0].Vx);
        Assert.AreEqual(240, sim.Projectiles[0].Vy);
    }

    [TestMethod]
    public void OpposingProjectilesSurviveTheirFirstOverlap()
    {
        var sim = ArenaHarness.Live();
        sim.ReleaseFire(10);
        sim.ReleaseFire(20, aimX: -32767, aimY: 0);

        sim.Step(11);

        Assert.AreEqual(2, sim.Projectiles.Count);
        CollectionAssert.AreEqual(new long[] { 1, 2 }, sim.Projectiles.Select(p => p.Id).ToArray());
    }

    [TestMethod]
    public void ProjectileCrossingItsOwnerSurvivesWithoutApplyingAHitImpulse()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.Place(20, 5000, 0);
        sim.ReleaseFire(10, aimX: 0, aimY: 32767);
        sim.Step();
        sim.Place(10, 0, 1260);
        sim.Player(10).Vx = 0;
        sim.Player(10).Vy = 0;

        sim.Step();

        Assert.AreEqual(1, sim.Projectiles.Count);
        Assert.AreEqual(1260, sim.Projectiles[0].Y);
        Assert.AreEqual(0, sim.Player(10).Vx);
        Assert.AreEqual(0, sim.Player(10).Vy);
    }

    [TestMethod]
    public void ProjectileAdvancementPreservesAscendingIdOrderAfterSelectiveRemoval()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, -4000, 0);
        sim.Place(20, 4000, 0);
        sim.ReleaseFire(10, aimX: 0, aimY: 32767);
        sim.ReleaseFire(20, aimX: 0, aimY: 32767);
        sim.Step();
        sim.Neutral(10); sim.Neutral(20); sim.Step(24);
        sim.Place(10, -4000, 0); sim.Place(20, 4000, 0);
        sim.Player(10).Vx = 0; sim.Player(10).Vy = 0;
        sim.Player(20).Vx = 0; sim.Player(20).Vy = 0;
        sim.ReleaseFire(10, aimX: 0, aimY: 32767);
        sim.ReleaseFire(20, aimX: 0, aimY: 32767);
        sim.Step();
        sim.Place(20, -4000, 7260);
        sim.Player(20).Vx = 0;
        sim.Player(20).Vy = 0;

        sim.Step();

        CollectionAssert.AreEqual(new long[] { 2, 3, 4 }, sim.Projectiles.Select(p => p.Id).ToArray());
        CollectionAssert.AreEqual(new[] { 7260, 1260, 1260 }, sim.Projectiles.Select(p => p.Y).ToArray());
    }

    [TestMethod]
    public void ProjectileHitAddsChargeScaledImpulseForTheNextTickAndRemovesProjectile()
    {
        var low = ArenaHarness.Live();
        low.Place(10, 0, 0); low.Place(20, 1800, 0);
        low.ReleaseFire(10); low.Step();
        var high = ArenaHarness.Live();
        high.Place(10, 0, 0); high.Place(20, 1800, 0);
        high.Player(10).ChargeTicks = 90;
        high.ReleaseFire(10); high.Step();

        Assert.AreEqual(0, low.Projectiles.Count);
        // Minimum charge is permille 333: knockback 130 + 220 * 333 / 1000 = 203.
        Assert.AreEqual(203, low.Player(20).Vx);
        Assert.AreEqual(350, high.Player(20).Vx);
        Assert.AreEqual(1800, low.Player(20).X);
        low.Step();
        Assert.AreEqual(1800 + 203, low.Player(20).X);
        Assert.AreEqual(186, low.Player(20).Vx);
    }

    [TestMethod]
    public void ProjectileOutsideArenaIsRemovedAndIdsRemainMonotonic()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 8000, 0);
        sim.ReleaseFire(10); sim.Step();
        Assert.AreEqual(0, sim.Projectiles.Count);

        sim.Place(10, 0, 0);
        sim.Neutral(10); sim.Step(24);
        sim.ReleaseFire(10); sim.Step();

        Assert.AreEqual(1, sim.Projectiles.Count);
        Assert.AreEqual(2L, sim.Projectiles[0].Id);
    }

    [TestMethod]
    public void DashIsOneUsePerRoundAndUsesAimWhenStationary()
    {
        var sim = ArenaHarness.Live();
        sim.Dash(10, aimX: 0, aimY: 32767);

        sim.Step();

        Assert.IsFalse(sim.Player(10).DashAvailable);
        Assert.AreEqual(240, sim.Player(10).Y);
        Assert.AreEqual(5, sim.Player(10).DashTicks);
        sim.Aim(10, 0, 32767); sim.Step();
        sim.Dash(10, aimX: 0, aimY: 32767); sim.Step();
        Assert.AreEqual(3, sim.Player(10).DashTicks);
        Assert.AreEqual(720, sim.Player(10).Y);
    }

    [TestMethod]
    public void HeldDashEdgeStartsExactlySixMovementTicks()
    {
        var sim = ArenaHarness.Live();
        sim.Dash(10, aimX: 0, aimY: 32767);

        sim.Step(7);

        Assert.AreEqual(1440, sim.Player(10).Y);
        Assert.AreEqual(0, sim.Player(10).DashTicks);
    }

    [TestMethod]
    public void DashUsesMovementDirectionAndStillResolvesBodyCollision()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0); sim.Place(20, 1300, 0);
        sim.MoveAndDash(10, 32767, 0);

        sim.Step();

        Assert.AreEqual(215, sim.Player(10).X);
        Assert.AreEqual(1415, sim.Player(20).X);
        Assert.AreEqual(1_440_000L, sim.DistanceSquared());
    }

    [TestMethod]
    public void CombatInputsAreIgnoredBeforeLive()
    {
        var sim = ArenaHarness.Positioning();
        sim.ReleaseFire(10);
        sim.Dash(20);

        sim.Step();

        Assert.AreEqual(0, sim.Projectiles.Count);
        Assert.IsTrue(sim.Player(20).DashAvailable);
        Assert.AreEqual(0, sim.Player(20).DashTicks);
    }

    private sealed class ArenaHarness
    {
        private readonly ArenaSimulation _simulation;

        private ArenaHarness(ArenaSimulation simulation) => _simulation = simulation;

        public IReadOnlyList<ArenaProjectile> Projectiles => _simulation.Projectiles;

        public static ArenaHarness Positioning()
        {
            var harness = Ready();
            harness.Step(ArenaRulesetV1.LoadingTicks);
            return harness;
        }

        public static ArenaHarness Live()
        {
            var harness = Ready();
            harness.Step(ArenaRulesetV1.LoadingTicks + ArenaRulesetV1.PositioningTicks);
            return harness;
        }

        private static ArenaHarness Ready()
        {
            var reservation = new DuelReservation(
                9,
                7,
                new DuelPlayer(10, 501, "Alice"),
                new DuelPlayer(20, 502, "Bob"),
                new DuelConfiguration("arena-knockoff", "bo3", 1,
                    new Dictionary<string, object?>(), "continuous"),
                DateTimeOffset.UtcNow,
                1,
                null);
            var harness = new ArenaHarness(new ArenaSimulation(reservation));
            harness._simulation.MarkParticipantReady(10);
            harness._simulation.MarkParticipantReady(20);
            return harness;
        }

        public void Step(int count = 1)
        {
            for (var index = 0; index < count; index++)
                _simulation.Step();
        }

        public ArenaPlayerState Player(long sessionId) =>
            _simulation.Players.Single(player => player.SessionId == sessionId);

        public void Place(long sessionId, int x, int y)
        {
            Player(sessionId).X = x;
            Player(sessionId).Y = y;
        }

        public void Aim(long sessionId, short x, short y) => SetInput(sessionId, aimX: x, aimY: y);

        public void Neutral(long sessionId) => _simulation.SetNeutralInput(sessionId);

        public void HoldCharge(long sessionId) => SetInput(sessionId, charging: true);

        // Most tests mean "take a shot" and do not care about the charge gate, so a
        // release arms the charge to the minimum first. Tests that exercise the gate
        // itself use ReleaseFireRaw and drive ChargeTicks deliberately.
        public void ReleaseFire(long sessionId, short aimX = 32767, short aimY = 0)
        {
            var player = Player(sessionId);
            player.ChargeTicks = Math.Max(player.ChargeTicks, ArenaRulesetV1.MinChargeTicks);
            SetInput(sessionId, aimX: aimX, aimY: aimY, fireReleased: true);
        }

        public void ReleaseFireRaw(long sessionId, short aimX = 32767, short aimY = 0) =>
            SetInput(sessionId, aimX: aimX, aimY: aimY, fireReleased: true);

        public void Dash(long sessionId, short aimX = 32767, short aimY = 0) =>
            SetInput(sessionId, aimX: aimX, aimY: aimY, dash: true);

        public void MoveAndDash(long sessionId, short moveX, short moveY) =>
            SetInput(sessionId, moveX: moveX, moveY: moveY, dash: true);

        public long ProjectileVelocityLengthSquared(int index)
        {
            var projectile = Projectiles[index];
            return checked((long)projectile.Vx * projectile.Vx + (long)projectile.Vy * projectile.Vy);
        }

        public long DistanceSquared()
        {
            var low = Player(10);
            var high = Player(20);
            var dx = checked((long)high.X - low.X);
            var dy = checked((long)high.Y - low.Y);
            return checked(dx * dx + dy * dy);
        }

        private void SetInput(
            long sessionId,
            short moveX = 0,
            short moveY = 0,
            short aimX = 32767,
            short aimY = 0,
            bool charging = false,
            bool fireReleased = false,
            bool dash = false) =>
            _simulation.SetInput(sessionId, new ContinuousInput(
                1, _simulation.Tick, moveX, moveY, aimX, aimY, charging, fireReleased, dash));
    }
}
