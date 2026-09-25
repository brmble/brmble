using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Arena;

/// <summary>
/// What the arena refuses, expressed by stripping the action rather than rejecting
/// the message. These moved here from the coordinator's tests when admission moved
/// into the simulation; the behaviour is unchanged.
/// </summary>
[TestClass]
public class ArenaAdmissionTests
{
    [TestMethod]
    public void Admit_StripsAFireInsideTheShotCooldownButKeepsTheHeldState()
    {
        var sim = Live();
        var first = sim.Admit(10, Input(1, fireReleased: true));
        Assert.IsTrue(first.FireReleased, "a legal shot survives");

        // Spam clicking means most clicks land during the shot cooldown, which the
        // arena is right to refuse. The refusal must not cost the input: the movement
        // that rode on the same message still lands and the sequence still advances.
        var refused = sim.Admit(10, Input(2, moveY: -32_767, fireReleased: true));

        Assert.IsFalse(refused.FireReleased, "the shot itself must still be refused");
        Assert.AreEqual(-32_767, refused.MoveY, "movement rode down with the refused shot");
        Assert.AreEqual(2L, refused.Sequence);
    }

    [TestMethod]
    public void Admit_StripsOnlyTheDashOnceTheRoundsDashIsSpent()
    {
        var sim = Live();
        var admitted = sim.Admit(10, Input(1, dash: true));
        Assert.IsTrue(admitted.Dash);
        sim.SetInput(10, admitted);
        sim.Step();

        var refused = sim.Admit(10, Input(3, moveY: -32_767, dash: true));

        Assert.IsFalse(refused.Dash);
        Assert.AreEqual(-32_767, refused.MoveY);
    }

    [TestMethod]
    public void Admit_StripsEdgesOutsideTheLivePhaseAndLetsThemThroughOnceLive()
    {
        var sim = Positioning();
        Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
        Assert.IsTrue(sim.Admit(10, Input(1, charging: true)).Charging);
        Assert.IsFalse(sim.Admit(10, Input(2, fireReleased: true)).FireReleased);
        Assert.IsFalse(sim.Admit(10, Input(3, dash: true)).Dash);

        while (sim.Phase != ContinuousMatchPhase.Live) sim.Step();

        Assert.IsTrue(sim.Admit(10, Input(4, fireReleased: true)).FireReleased, "a legal shot must survive");
        Assert.IsTrue(sim.Admit(10, Input(5, dash: true)).Dash);
    }

    [TestMethod]
    public void Admit_EvaluatesTheCooldownAtTheTickItIsCalledOn()
    {
        var sim = Live();
        sim.Players.Single(x => x.SessionId == 10).ChargeTicks = ArenaRulesetV1.MinChargeTicks;
        sim.SetInput(10, sim.Admit(10, Input(1, fireReleased: true)));
        sim.Step();
        Assert.AreEqual(1, sim.Projectiles.Count);
        Assert.IsFalse(sim.Admit(10, Input(2, fireReleased: true)).FireReleased, "inside the cooldown");

        for (var tick = 0; tick < ArenaRulesetV1.ShotCooldownTicks; tick++) sim.Step();

        Assert.IsTrue(sim.Admit(10, Input(3, fireReleased: true)).FireReleased, "the cooldown has ended");
    }

    // The two tests below are the proof that Admit's cooldown clause is not a duplicate
    // of the cooldown ProcessFire already enforces (extraction plan, Task 3, commit 2).
    // Each runs the same input stream through Admit and directly into SetInput; the
    // outcomes differ, so the clause carries behaviour and stays.

    [TestMethod]
    public void Admit_StripsAFireOnTheLastCooldownTickThatTheSimulationItselfWouldHaveFired()
    {
        var admitted = Live();
        var direct = Live();
        foreach (var sim in new[] { admitted, direct })
        {
            var player = sim.Players.Single(x => x.SessionId == 10);
            player.ChargeTicks = ArenaRulesetV1.MinChargeTicks;
            // Aimed along +y so the projectile neither hits the opponent nor leaves the
            // arena inside this test, and the count below stays meaningful.
            sim.SetInput(10, sim.Admit(10, Input(1, aimX: 0, aimY: 32_767, fireReleased: true)));
            sim.Step();
            Assert.AreEqual(ArenaRulesetV1.ShotCooldownTicks, player.CooldownTicks);
            for (var tick = 0; tick < ArenaRulesetV1.ShotCooldownTicks - 1; tick++) sim.Step();
            Assert.AreEqual(1, player.CooldownTicks, "the last cooldown tick");
            player.ChargeTicks = ArenaRulesetV1.MinChargeTicks;
        }

        // Admission is evaluated before the step decrements the timers, so on the last
        // cooldown tick it still sees a cooldown and strips the shot...
        var stripped = admitted.Admit(10, Input(2, aimX: 0, aimY: 32_767, fireReleased: true));
        Assert.IsFalse(stripped.FireReleased);
        admitted.SetInput(10, stripped);
        admitted.Step();
        Assert.AreEqual(1, admitted.Projectiles.Count);
        Assert.AreEqual(0, admitted.Players.Single(x => x.SessionId == 10).CooldownTicks);

        // ...whereas the step itself decrements the cooldown to zero and then fires.
        direct.SetInput(10, Input(2, aimX: 0, aimY: 32_767, fireReleased: true));
        direct.Step();
        Assert.AreEqual(2, direct.Projectiles.Count, "the simulation alone fires on this tick");
        Assert.AreEqual(ArenaRulesetV1.ShotCooldownTicks, direct.Players.Single(x => x.SessionId == 10).CooldownTicks);
    }

    [TestMethod]
    public void Admit_StartsACooldownOnAnUnderchargedReleaseThatTheSimulationRefusesWithoutOne()
    {
        var admitted = Live();
        var direct = Live();
        foreach (var sim in new[] { admitted, direct })
        {
            var player = sim.Players.Single(x => x.SessionId == 10);
            // A release with no charge: the simulation refuses the shot outright and
            // starts no cooldown of its own.
            sim.SetInput(10, sim.Admit(10, Input(1, fireReleased: true)));
            sim.Step();
            Assert.AreEqual(0, sim.Projectiles.Count);
            Assert.AreEqual(0, player.CooldownTicks);
            // Bank some charge, still inside the admission cooldown the refused release started.
            for (var tick = 0; tick < 20; tick++)
            {
                sim.SetInput(10, sim.Admit(10, Input(2 + tick, charging: true)));
                sim.Step();
            }
            Assert.AreEqual(20, player.ChargeTicks);
        }

        // Admission counts the refused release as a shot and strips the next one, which
        // leaves the banked charge in place: the player keeps what they charged.
        var stripped = admitted.Admit(10, Input(30, fireReleased: true));
        Assert.IsFalse(stripped.FireReleased);
        admitted.SetInput(10, stripped);
        admitted.Step();
        Assert.AreEqual(20, admitted.Players.Single(x => x.SessionId == 10).ChargeTicks, "a stripped release leaves the charge banked");

        // The simulation alone would refuse the under-charged release and cancel the charge.
        direct.SetInput(10, Input(30, fireReleased: true));
        direct.Step();
        Assert.AreEqual(0, direct.Projectiles.Count);
        Assert.AreEqual(0, direct.Players.Single(x => x.SessionId == 10).ChargeTicks, "a refused release cancels the charge");
    }

    [TestMethod]
    public void Admit_ReleasesTheDashReservationOnTheAuthoritativeRoundReset()
    {
        var sim = Live();
        sim.SetInput(10, sim.Admit(10, Input(1, dash: true)));
        sim.Step();
        Assert.IsFalse(sim.Admit(10, Input(2, dash: true)).Dash, "spent for the rest of the round");

        // Knock the player out to end the round; the reservation is released with the
        // authoritative round reset, never before.
        sim.Players.Single(x => x.SessionId == 10).X = 9_001;
        sim.Step();
        while (sim.Phase is ContinuousMatchPhase.Loading or ContinuousMatchPhase.Positioning) sim.Step();

        Assert.IsTrue(sim.Admit(10, Input(3, dash: true)).Dash);
    }

    [TestMethod]
    public void InitialInput_IsTheSpawnFacingAimWhateverThePlayerAimsAtNow()
    {
        var sim = Live();
        // Both players have been aiming along the neutral input for a few hundred ticks
        // by now; the initial input must still answer with the spawn-facing aim.
        Assert.AreEqual(sim.Players.Single(x => x.SessionId == 20).AimX, sim.Players.Single(x => x.SessionId == 10).AimX);

        var low = sim.InitialInput(10);
        var high = sim.InitialInput(20);

        Assert.AreEqual(ArenaRulesetV1.AimQuantizationMax, low.AimX);
        Assert.AreEqual(-ArenaRulesetV1.AimQuantizationMax, high.AimX);
        Assert.AreEqual(0, low.AimY);
        Assert.IsFalse(low.FireReleased || low.Dash || low.Charging);
    }

    [TestMethod]
    public void ParticipantSnapshot_SubstitutesWireSessionIdsWherePlayersAndProjectilesAreNamed()
    {
        var sim = Live();
        sim.Players.Single(x => x.SessionId == 10).ChargeTicks = ArenaRulesetV1.MinChargeTicks;
        sim.SetInput(10, sim.Admit(10, Input(1, fireReleased: true)));
        sim.Step();
        var wire = new Dictionary<long, long> { [10] = 11, [20] = 20 };
        var acknowledged = new Dictionary<long, long> { [10] = 1, [20] = 0 };

        var view = (ArenaSnapshotView)sim.ParticipantSnapshot(10, acknowledged, wire);

        CollectionAssert.AreEquivalent(new long[] { 11, 20 }, view.Players.Select(x => x.SessionId).ToArray());
        Assert.AreEqual(1L, view.Players.Single(x => x.SessionId == 11).AcknowledgedInput, "acknowledgements are keyed by the simulation id");
        Assert.AreEqual(11L, view.Projectiles.Single().OwnerSessionId);
        var unmapped = (ArenaSnapshotView)sim.ParticipantSnapshot(10, acknowledged);
        Assert.AreEqual(10L, unmapped.Projectiles.Single().OwnerSessionId);
    }

    private static ContinuousInput Input(
        long sequence, short moveX = 0, short moveY = 0, short aimX = 32_767, short aimY = 0,
        bool charging = false, bool fireReleased = false, bool dash = false) =>
        new(sequence, 0, moveX, moveY, aimX, aimY, charging, fireReleased, dash);

    private static ArenaSimulation Positioning()
    {
        var sim = new ArenaSimulation(new DuelReservation(9, 7,
            new DuelPlayer(10, 501, "Alice"), new DuelPlayer(20, 502, "Bob"),
            new DuelConfiguration("arena-knockoff", "bo3", 1, new Dictionary<string, object?>(), "continuous"),
            DateTimeOffset.UnixEpoch, 1, null));
        sim.MarkParticipantReady(10);
        sim.MarkParticipantReady(20);
        for (var tick = 0; tick < ArenaRulesetV1.LoadingTicks; tick++) sim.Step();
        return sim;
    }

    private static ArenaSimulation Live()
    {
        var sim = Positioning();
        for (var tick = 0; tick < ArenaRulesetV1.PositioningTicks; tick++) sim.Step();
        Assert.AreEqual(ContinuousMatchPhase.Live, sim.Phase);
        return sim;
    }
}
