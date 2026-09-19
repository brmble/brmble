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
    public void InitialInput_CarriesThePlayersStartingAim()
    {
        var sim = Live();
        var low = sim.InitialInput(10);
        var high = sim.InitialInput(20);

        Assert.AreEqual(sim.Players.Single(x => x.SessionId == 10).AimX, low.AimX);
        Assert.AreEqual(sim.Players.Single(x => x.SessionId == 20).AimX, high.AimX);
        Assert.AreNotEqual(low.AimX, high.AimX, "the sides face each other");
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
