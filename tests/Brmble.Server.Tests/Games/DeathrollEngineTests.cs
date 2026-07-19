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
}
