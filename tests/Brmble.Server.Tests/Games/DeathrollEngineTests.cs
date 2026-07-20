using System;
using System.Collections.Generic;
using System.Linq;
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

file sealed class QueueRandom : IRandomSource
{
    private readonly Queue<int> _values;
    public QueueRandom(params int[] values) => _values = new Queue<int>(values);
    public int Roll(int maxInclusive) => Math.Min(_values.Dequeue(), maxInclusive);
}

[TestClass]
public class DeathrollEngineTests
{
    private static readonly IReadOnlyList<GamePlayer> Players = new[] { new GamePlayer(10), new GamePlayer(20) };

    [TestMethod]
    public void FirstPlayerRollsUnderThousandFirst()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(500);
        var state = engine.InitialState(Players, rng);
        Assert.IsTrue(engine.IsUsersTurn(state, 10));
        Assert.IsFalse(engine.IsUsersTurn(state, 20));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        Assert.IsTrue(engine.IsUsersTurn(state, 20));
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));
    }

    [TestMethod]
    public void RollingOneLosesAndOpponentWins()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(1);
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        var rawOutcome = engine.GetOutcome(state);
        Assert.IsInstanceOfType(rawOutcome, typeof(GameOutcome.Finished));
        var outcome = (GameOutcome.Finished)rawOutcome;
        var winner = outcome.Participants.Single(p => p.Result == "win");
        var loser = outcome.Participants.Single(p => p.Result == "loss");
        Assert.AreEqual(20, winner.UserId);
        Assert.AreEqual(1, winner.Placement);
        Assert.AreEqual(10, loser.UserId);
        Assert.AreEqual(1, loser.Score);
    }

    [TestMethod]
    public void RollingOutOfTurnThrows()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(500);
        var state = engine.InitialState(Players, rng);
        Assert.ThrowsException<InvalidGameActionException>(() =>
            engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, rng));
    }

    [TestMethod]
    public void AcceptsRollFromJsonElementPayload()
    {
        // Actions arrive over HTTP as System.Text.Json, so `roll: true` is a
        // JsonElement, not a boxed bool. The engine must accept it.
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(500);
        var state = engine.InitialState(Players, rng);
        var json = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object?>>(
            "{\"roll\":true}")!;
        engine.ApplyAction(state, 10, json, rng);
        Assert.IsTrue(engine.IsUsersTurn(state, 20));
    }

    [TestMethod]
    public void TimeoutPenaltyLowersCeilingByTwentyPercent()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(500, 400);
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        var events = engine.ApplyTimeoutPenalty(state, rng);
        Assert.IsTrue(events.Any(e => e.Kind == "penalty"));
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, rng);
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));
    }

    [TestMethod]
    public void TimeoutPenaltyToOneForcesLoss()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(2);
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        engine.ApplyTimeoutPenalty(state, rng);
        var rawOutcome = engine.GetOutcome(state);
        Assert.IsInstanceOfType(rawOutcome, typeof(GameOutcome.Finished));
        var outcome = (GameOutcome.Finished)rawOutcome;
        Assert.AreEqual(10, outcome.Participants.Single(p => p.Result == "win").UserId);
    }

    [TestMethod]
    public void CapturesMatchSummaryAndPerPlayerLuckStats()
    {
        var engine = new DeathrollEngine();
        // ceiling starts 100. 10 rolls 80 (top100), 20 rolls 40 (top80), 10 rolls 1 (top40 -> loss).
        var rng = new QueueRandom(80, 40, 1);
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);

        var summary = engine.MatchSummary(state)!;
        Assert.AreEqual(100, GetInt(summary, "startingCeiling"));
        Assert.AreEqual(3, GetInt(summary, "totalRolls"));
        Assert.AreEqual(1, GetInt(summary, "finalRoll"));

        var p10 = engine.ParticipantStats(state, 10)!;
        Assert.AreEqual(2, GetInt(p10, "rolls"));
        Assert.AreEqual(1, GetInt(p10, "rollsAboveMid")); // 80>50
        Assert.AreEqual(1, GetInt(p10, "rollsBelowMid")); // 1<=20
        Assert.AreEqual(0.4125, GetDouble(p10, "avgRollRatio"), 1e-9); // (0.8 + 0.025)/2

        var p20 = engine.ParticipantStats(state, 20)!;
        Assert.AreEqual(1, GetInt(p20, "rolls"));
        Assert.AreEqual(0, GetInt(p20, "rollsAboveMid")); // 40 !> 40
        Assert.AreEqual(1, GetInt(p20, "rollsBelowMid"));
        Assert.AreEqual(0.5, GetDouble(p20, "avgRollRatio"), 1e-9); // 40/80
    }

    [TestMethod]
    public void ForcedLossExcludedFromLuckCountersButSetsFinalRoll()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(2); // 10 rolls 2 (top100 -> ceiling 2), then 20 times out to forced loss
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        engine.ApplyTimeoutPenalty(state, rng); // floor(2*0.8)=1 -> forced loss for 20

        var summary = engine.MatchSummary(state)!;
        Assert.AreEqual(1, GetInt(summary, "totalRolls")); // only the real roll counts
        Assert.AreEqual(1, GetInt(summary, "finalRoll"));

        var p10 = engine.ParticipantStats(state, 10)!;
        Assert.AreEqual(1, GetInt(p10, "rolls"));
        Assert.AreEqual(0, GetInt(p10, "rollsAboveMid")); // 2 !> 50
        Assert.AreEqual(1, GetInt(p10, "rollsBelowMid"));

        var p20 = engine.ParticipantStats(state, 20)!;
        Assert.AreEqual(0, GetInt(p20, "rolls"));
        Assert.AreEqual(0.0, GetDouble(p20, "avgRollRatio"), 1e-9);
    }

    // Reflection helpers: the engine returns anonymous objects.
    private static int GetInt(object o, string name)
        => Convert.ToInt32(o.GetType().GetProperty(name)!.GetValue(o));
    private static double GetDouble(object o, string name)
        => Convert.ToDouble(o.GetType().GetProperty(name)!.GetValue(o));
}
