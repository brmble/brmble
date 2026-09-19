using Brmble.Server.Games.Arena;
using Brmble.Server.Games.Continuous;
using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Arena;

[TestClass]
public class ArenaDeterminismTests
{
    [TestMethod]
    public void IdenticalInputStream_ProducesIdenticalPerTickHashesAndOutcome()
    {
        var inputs = DeterministicInputGenerator.Build(seed: 0xA8E1, ticks: 3_600);
        var first = RunToCompletion(inputs);
        var second = RunToCompletion(inputs);

        CollectionAssert.AreEqual(first.Hashes, second.Hashes);
        Assert.AreEqual(first.Outcome, second.Outcome);
        CollectionAssert.AreEqual(first.Score, second.Score);
    }

    // The final hash of the deterministic stream, recorded once on the commit before the
    // coordinator extraction. Every refactor of ArenaSimulation must reproduce it; a
    // change here is a behaviour change and needs to be justified against the spec.
    // Zero means "not recorded yet": the test then reports the value to record and is
    // inconclusive rather than green.
    private const ulong RecordedFinalHash = 0x6E117D823928FE4D;

    [TestMethod]
    public void HashFixture_MatchesRecordedValue()
    {
        var inputs = DeterministicInputGenerator.Build(seed: 0xA8E1, ticks: 3_600);
        var run = RunToCompletion(inputs);
        var final = run.Hashes[^1];

        if (RecordedFinalHash == 0)
            Assert.Inconclusive($"Record the fixture: final hash 0x{final:X16} over {run.Hashes.Length} ticks, outcome {run.Outcome}.");
        Assert.AreEqual(RecordedFinalHash, final,
            $"the deterministic stream now ends at 0x{final:X16} over {run.Hashes.Length} ticks; the simulation's behaviour changed");
    }

    [TestMethod]
    public void DeterministicHashChangesForFutureAffectingState()
    {
        var baseline = Live();
        var changed = Live();
        changed.Players[0].CooldownTicks = 1;
        Assert.AreNotEqual(baseline.DeterministicHash(), changed.DeterministicHash());

        changed = Live();
        changed.SetInput(10, new ContinuousInput(4, changed.Tick, 1, 0, 32767, 0, false, false, false));
        Assert.AreNotEqual(baseline.DeterministicHash(), changed.DeterministicHash());
    }

    [TestMethod]
    public void DeterministicHashChangesWhenOnlyRoundGenerationChanges()
    {
        var baseline = Live();
        var changed = Live();
        typeof(ArenaSimulation).GetProperty(nameof(ArenaSimulation.RoundGeneration))!
            .SetValue(changed, 1L);

        Assert.AreNotEqual(baseline.DeterministicHash(), changed.DeterministicHash());
    }

    [TestMethod]
    public void MirroredInputsAndSides_ProduceMirroredScores()
    {
        var inputs = DeterministicInputGenerator.Build(seed: 0xA8E1, ticks: 3_600);
        var normal = RunToCompletion(inputs);
        var mirrored = RunToCompletion(DeterministicInputGenerator.Mirror(inputs));

        Assert.IsFalse(inputs.SequenceEqual(DeterministicInputGenerator.Mirror(inputs)));
        Assert.AreEqual("decided", normal.Outcome);
        Assert.AreEqual("decided", mirrored.Outcome);
        CollectionAssert.AreEqual(new[] { 2, 0 }, normal.Score);
        CollectionAssert.AreEqual(new[] { 0, 2 }, mirrored.Score);
        CollectionAssert.AreEqual(normal.Score.Reverse().ToArray(), mirrored.Score);
    }

    private static RunResult RunToCompletion(IReadOnlyList<InputPair> inputs)
    {
        var sim = Live();
        var hashes = new List<ulong>();
        ContinuousStepResult result = new(false, null);
        for (var tick = 0; tick < 20_000 && !result.Completed; tick++)
        {
            var pair = inputs[tick % inputs.Count];
            sim.SetInput(10, pair.Low with { Sequence = tick + 1, PredictedTick = sim.Tick });
            sim.SetInput(20, pair.High with { Sequence = tick + 1, PredictedTick = sim.Tick });
            result = sim.Step();
            hashes.Add(sim.DeterministicHash());
        }

        Assert.IsTrue(result.Completed, "The deterministic stream must terminate within the test bound.");
        return new RunResult(hashes.ToArray(), result.Completion!.Outcome, sim.Score.ToArray());
    }

    private static ArenaSimulation Live()
    {
        var reservation = new DuelReservation(9, 7,
            new DuelPlayer(10, 501, "Alice"), new DuelPlayer(20, 502, "Bob"),
            new DuelConfiguration("arena-knockoff", "bo3", 1, new Dictionary<string, object?>(), "continuous"),
            DateTimeOffset.UnixEpoch, 1, null);
        var sim = new ArenaSimulation(reservation);
        sim.MarkParticipantReady(10);
        sim.MarkParticipantReady(20);
        for (var tick = 0; tick < ArenaRulesetV1.LoadingTicks + ArenaRulesetV1.PositioningTicks; tick++)
            sim.Step();
        return sim;
    }

    private sealed record RunResult(ulong[] Hashes, string Outcome, int[] Score);
    private sealed record InputPair(ContinuousInput Low, ContinuousInput High);

    private static class DeterministicInputGenerator
    {
        public static IReadOnlyList<InputPair> Build(uint seed, int ticks)
        {
            var state = seed;
            var result = new InputPair[ticks];
            for (var tick = 0; tick < ticks; tick++)
            {
                var lowY = (short)((Next(ref state) & 1) == 0 ? 0 : 4096);
                var highY = (short)((Next(ref state) & 1) == 0 ? 0 : -4096);
                result[tick] = new InputPair(
                    new ContinuousInput(0, 0, 0, lowY, 32767, 0, false, false, false),
                    new ContinuousInput(0, 0, 32767, highY, -32767, 0, false, false, false));
            }
            return result;
        }

        public static IReadOnlyList<InputPair> Mirror(IReadOnlyList<InputPair> source) => source
            .Select(pair => new InputPair(MirrorInput(pair.High), MirrorInput(pair.Low)))
            .ToArray();

        private static ContinuousInput MirrorInput(ContinuousInput input) => input with
        {
            MoveX = checked((short)-input.MoveX),
            MoveY = checked((short)-input.MoveY),
            AimX = checked((short)-input.AimX),
            AimY = checked((short)-input.AimY),
        };

        private static uint Next(ref uint state)
        {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            return state;
        }
    }
}
