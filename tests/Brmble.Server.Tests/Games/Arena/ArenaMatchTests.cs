using System.Text.Json;
using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Arena;

[TestClass]
public class ArenaMatchTests
{
    [TestMethod]
    public void FourthConsecutiveSameTickDoubleKo_EndsMatchDrawWithoutScoreChange()
    {
        var sim = ArenaHarness.Live();

        for (var replay = 1; replay <= 4; replay++)
        {
            sim.PlaceBothOutside();
            sim.Step();
            if (replay < 4)
            {
                CollectionAssert.AreEqual(new[] { 0, 0 }, sim.Score.ToArray());
                sim.StepRoundIntroduction();
            }
        }

        Assert.IsTrue(sim.Completed);
        Assert.AreEqual("draw", sim.Completion!.Outcome);
        Assert.AreEqual(4, sim.Completion.MatchSummary.DoubleKoReplays);
        Assert.AreEqual(4, sim.Completion.MatchSummary.RoundsPlayed);
    }

    [TestMethod]
    public void FirstToTwoWinsCompletesBo3AndDecisiveRoundResetsDoubleKoCounter()
    {
        var sim = ArenaHarness.Live();

        sim.DoubleKo();
        sim.WinRound(10);
        sim.WinRound(10, advanceNextRound: false);

        CollectionAssert.AreEqual(new[] { 2, 0 }, sim.Score.ToArray());
        Assert.AreEqual(0, sim.View().ConsecutiveDoubleKos);
        Assert.AreEqual("decided", sim.Completion!.Outcome);
        CollectionAssert.AreEqual(new[] { 2, 0 }, sim.Completion.MatchSummary.FinalScore.ToArray());
        CollectionAssert.AreEqual(new[] { "win", "loss" }, sim.Completion.Participants.Select(x => x.Result).ToArray());
        CollectionAssert.AreEqual(new long[] { 501, 502 }, sim.Completion.Participants.Select(x => x.UserId).ToArray());
    }

    [TestMethod]
    public void RoundResetClearsEveryPerRoundValueAndPreservesProjectileIdSequence()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.ReleaseFire(10);
        sim.Dash(20);
        sim.Step();
        Assert.AreEqual(1L, sim.Projectiles.Single().Id);
        sim.Player(10).Vx = 0;
        sim.Player(10).ChargeTicks = 30;
        sim.Player(10).ForcedFireTicks = 12;
        sim.Player(10).CooldownTicks = 8;

        sim.WinRound(10, advanceNextRound: false);

        Assert.AreEqual(ContinuousMatchPhase.Loading, sim.Phase);
        foreach (var id in new[] { 10L, 20L })
        {
            Assert.AreEqual(0, sim.Player(id).Vx);
            Assert.AreEqual(0, sim.Player(id).Vy);
            Assert.AreEqual(0, sim.Player(id).ChargeTicks);
            Assert.AreEqual(0, sim.Player(id).ForcedFireTicks);
            Assert.AreEqual(0, sim.Player(id).CooldownTicks);
            Assert.AreEqual(0, sim.Player(id).DashTicks);
            Assert.IsTrue(sim.Player(id).DashAvailable);
            Assert.AreEqual(0, sim.Player(id).Input.MoveX);
            Assert.IsFalse(sim.Player(id).Input.Dash);
        }
        Assert.AreEqual(0, sim.Projectiles.Count);
        Assert.AreEqual(9000, sim.View().Arena.Radius);
        Assert.AreEqual(-3500, sim.Player(10).X);
        Assert.AreEqual(3500, sim.Player(20).X);

        sim.StepRoundIntroduction();
        sim.Place(10, 0, 0);
        sim.ReleaseFire(10);
        sim.Step();
        Assert.AreEqual(2L, sim.Projectiles.Single().Id);
    }

    [TestMethod]
    public void LaterRoundsRunLoadingAndPositioningWithoutAnotherAttachGate()
    {
        var sim = ArenaHarness.Live();
        sim.WinRound(10, advanceNextRound: false);

        sim.Step(ArenaRulesetV1.LoadingTicks - 1);
        Assert.AreEqual(ContinuousMatchPhase.Loading, sim.Phase);
        sim.Step();
        Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
        sim.Step(ArenaRulesetV1.PositioningTicks);
        Assert.AreEqual(ContinuousMatchPhase.Live, sim.Phase);
    }

    [TestMethod]
    public void StrictBoundaryAndLatestBoundaryEventClassifyKoCause()
    {
        var movement = ArenaHarness.Live();
        movement.Place(20, 9000, 0);
        movement.Step();
        Assert.IsFalse(movement.Completed);
        movement.Place(20, 8990, 0);
        movement.Move(20, 32767, 0);
        movement.Step();
        movement.StepRoundIntroduction();
        movement.WinRound(10, advanceNextRound: false);
        Assert.AreEqual(ArenaKnockoutCause.DashOrMovement, movement.CompletionSummary.KoCauses[0]);

        var recoil = ArenaHarness.Live();
        recoil.Place(10, -8990, 0);
        recoil.ReleaseFire(10, 32767, 0);
        recoil.Step();
        recoil.StepRoundIntroduction();
        recoil.WinRound(20, advanceNextRound: false);
        Assert.AreEqual(ArenaKnockoutCause.Recoil, recoil.CompletionSummary.KoCauses[0]);

        var projectile = ArenaHarness.Live();
        projectile.Place(10, 7010, 0);
        projectile.Place(20, 8990, 0);
        projectile.ReleaseFire(10, 32767, 0);
        projectile.Step(3);
        projectile.StepRoundIntroduction();
        projectile.WinRound(10, advanceNextRound: false);
        Assert.AreEqual(ArenaKnockoutCause.OpponentProjectile, projectile.CompletionSummary.KoCauses[0]);

        var collapse = ArenaHarness.Live();
        collapse.Place(20, 9000, 0);
        collapse.Step(600);
        collapse.StepRoundIntroduction();
        collapse.WinRound(10, advanceNextRound: false);
        Assert.AreEqual(ArenaKnockoutCause.Collapse, collapse.CompletionSummary.KoCauses[0]);
    }

    [TestMethod]
    public void ParticipantSnapshotMatchesProtocolAndIsImmutable()
    {
        var sim = ArenaHarness.Live();
        var participant = (ArenaSnapshotView)sim.Simulation.ParticipantSnapshot(10,
            new Dictionary<long, long> { [10] = 42, [20] = 37 });
        var json = JsonSerializer.Serialize(participant, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.AreEqual(42, participant.Players.Single(p => p.SessionId == 10).AcknowledgedInput);
        Assert.AreEqual(37, participant.Players.Single(p => p.SessionId == 20).AcknowledgedInput);
        StringAssert.Contains(json, "\"phaseEndsAtTick\":");
        StringAssert.Contains(json, "\"consecutiveDoubleKos\":0");
        Assert.ThrowsException<NotSupportedException>(() => ((IList<int>)participant.Score)[0] = 9);
        sim.WinRound(10, advanceNextRound: false);
        CollectionAssert.AreEqual(new[] { 0, 0 }, participant.Score.ToArray());

        var spectator = (ArenaSnapshotView)sim.Simulation.SpectatorSnapshot();
        Assert.IsTrue(spectator.Players.All(p => p.AcknowledgedInput is null));
    }

    [TestMethod]
    public void CompletionContainsCompleteSchemaOneTelemetry()
    {
        var sim = ArenaHarness.Live();
        sim.Place(10, 0, 0);
        sim.ReleaseFire(10);
        sim.Dash(20);
        sim.Step();
        sim.WinRound(10);
        sim.WinRound(20);
        sim.WinRound(10, advanceNextRound: false);

        var summary = sim.CompletionSummary;
        Assert.AreEqual(1, summary.SchemaVersion);
        Assert.AreEqual(3, summary.RoundsPlayed);
        Assert.AreEqual(3, summary.RoundDurations.Count);
        Assert.AreEqual(3, summary.KoCauses.Count);
        Assert.AreEqual(3, summary.KoRadii.Count);
        Assert.AreEqual(2, summary.Shots.Count);
        Assert.AreEqual(2, summary.Hits.Count);
        Assert.AreEqual(2, summary.FiredCharges.Count);
        Assert.AreEqual(2, summary.LandedCharges.Count);
        Assert.AreEqual(2, summary.DashUses.Count);
        Assert.AreEqual(1, summary.Shots[0]);
        Assert.AreEqual(1, summary.DashUses[1]);
        Assert.AreEqual(2, sim.Completion!.ParticipantStats.Count);
        Assert.IsTrue(sim.Completion.ParticipantStats.Keys.SequenceEqual(new long[] { 501, 502 }));
    }

    private sealed class ArenaHarness
    {
        private ContinuousCompletion? _completion;
        private ArenaHarness(ArenaSimulation simulation) => Simulation = simulation;

        public ArenaSimulation Simulation { get; }
        public ContinuousMatchPhase Phase => Simulation.Phase;
        public IReadOnlyList<int> Score => Simulation.Score;
        public IReadOnlyList<ArenaProjectile> Projectiles => Simulation.Projectiles;
        public bool Completed => _completion is not null;
        public ArenaCompletion Completion => new(_completion!);
        public ArenaMatchSummary CompletionSummary => (ArenaMatchSummary)_completion!.MatchSummary;

        public static ArenaHarness Live()
        {
            var reservation = new DuelReservation(9, 7,
                new DuelPlayer(10, 501, "Alice"), new DuelPlayer(20, 502, "Bob"),
                new DuelConfiguration("arena-knockoff", "bo3", 1, new Dictionary<string, object?>(), "continuous"),
                DateTimeOffset.UnixEpoch, 1, null);
            var harness = new ArenaHarness(new ArenaSimulation(reservation));
            harness.Simulation.MarkParticipantReady(10);
            harness.Simulation.MarkParticipantReady(20);
            harness.StepRoundIntroduction();
            return harness;
        }

        public void Step(int count = 1)
        {
            for (var index = 0; index < count && !Completed; index++)
            {
                var result = Simulation.Step();
                if (result.Completed)
                    _completion = result.Completion;
            }
        }

        public void StepRoundIntroduction()
        {
            while (Phase is ContinuousMatchPhase.Loading or ContinuousMatchPhase.Positioning)
                Step();
        }
        public ArenaSnapshotView View() => (ArenaSnapshotView)Simulation.SpectatorSnapshot();
        public ArenaPlayerState Player(long id) => Simulation.Players.Single(x => x.SessionId == id);
        public void Place(long id, int x, int y) { Player(id).X = x; Player(id).Y = y; }
        public void PlaceBothOutside() { Place(10, -9001, 0); Place(20, 9001, 0); }
        public void Move(long id, short x, short y) => Input(id, moveX: x, moveY: y);
        public void Dash(long id) => Input(id, dash: true);
        public void ReleaseFire(long id, short aimX = 32767, short aimY = 0) => Input(id, aimX: aimX, aimY: aimY, fire: true);
        public void DoubleKo() { PlaceBothOutside(); Step(); StepRoundIntroduction(); }
        public void WinRound(long winner, bool advanceNextRound = true)
        {
            Place(winner == 10 ? 20 : 10, 9001, 0);
            Step();
            if (advanceNextRound && !Completed)
                StepRoundIntroduction();
        }

        private void Input(long id, short moveX = 0, short moveY = 0, short aimX = 32767, short aimY = 0, bool fire = false, bool dash = false) =>
            Simulation.SetInput(id, new ContinuousInput(1, Simulation.Tick, moveX, moveY, aimX, aimY, false, fire, dash));
    }

    private sealed record ArenaCompletion(ContinuousCompletion Value)
    {
        public string Outcome => Value.Outcome;
        public IReadOnlyList<Brmble.Server.Games.CompletedParticipant> Participants => Value.Participants;
        public ArenaMatchSummary MatchSummary => (ArenaMatchSummary)Value.MatchSummary;
        public IReadOnlyDictionary<long, object> ParticipantStats => Value.ParticipantStats;
    }
}
