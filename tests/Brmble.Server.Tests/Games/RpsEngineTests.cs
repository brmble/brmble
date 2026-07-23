using System;
using System.Collections.Generic;
using System.Linq;
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

file sealed class NoRandom : IRandomSource
{
    public int Roll(int maxInclusive) => maxInclusive;
}

[TestClass]
public class RpsEngineTests
{
    private static readonly IReadOnlyList<GamePlayer> Players = new[] { new GamePlayer(10), new GamePlayer(20) };
    private static readonly IRandomSource Rng = new NoRandom();

    private static object NewState(int bestOf = 3)
    {
        var engine = new RpsEngine();
        return engine.InitialState(Players, Rng, new Dictionary<string, object?> { ["bestOf"] = bestOf });
    }

    private static Dictionary<string, object?> Pick(string p) => new() { ["pick"] = p };

    [TestMethod]
    public void BothMustCommitBeforeRoundResolves()
    {
        var engine = new RpsEngine();
        var state = NewState();
        Assert.IsTrue(engine.IsUsersTurn(state, 10));
        Assert.IsTrue(engine.IsUsersTurn(state, 20));
        var ev = engine.ApplyAction(state, 10, Pick("rock"), Rng);
        Assert.IsFalse(ev.Any(e => e.Kind == "roundResult"));
        Assert.IsFalse(engine.IsUsersTurn(state, 10)); // already picked
        Assert.IsTrue(engine.IsUsersTurn(state, 20));
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));
    }

    [TestMethod]
    public void RockBeatsScissors()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        var ev = engine.ApplyAction(state, 20, Pick("scissors"), Rng);
        var result = ev.Single(e => e.Kind == "roundResult");
        Assert.AreEqual(10L, Convert.ToInt64(result.Data["winnerId"]));
        Assert.IsFalse((bool)result.Data["tie"]);
    }

    [TestMethod]
    public void SamePickTiesAndReplaysWithoutCredit()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyAction(state, 10, Pick("paper"), Rng);
        var ev = engine.ApplyAction(state, 20, Pick("paper"), Rng);
        var result = ev.Single(e => e.Kind == "roundResult");
        Assert.IsTrue((bool)result.Data["tie"]);
        Assert.AreEqual(0, Convert.ToInt32(result.Data["wins0"]));
        Assert.AreEqual(0, Convert.ToInt32(result.Data["wins1"]));
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));
        // Both should be able to pick again.
        Assert.IsTrue(engine.IsUsersTurn(state, 10));
        Assert.IsTrue(engine.IsUsersTurn(state, 20));
    }

    [TestMethod]
    public void FirstToMajorityWinsBestOfThree()
    {
        var engine = new RpsEngine();
        var state = NewState(bestOf: 3);
        // 10 wins round 1 (rock>scissors)
        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        engine.ApplyAction(state, 20, Pick("scissors"), Rng);
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));
        // 10 wins round 2 (paper>rock) -> reaches 2 wins
        engine.ApplyAction(state, 10, Pick("paper"), Rng);
        engine.ApplyAction(state, 20, Pick("rock"), Rng);

        var raw = engine.GetOutcome(state);
        Assert.IsInstanceOfType(raw, typeof(GameOutcome.Finished));
        var outcome = (GameOutcome.Finished)raw;
        var winner = outcome.Participants.Single(p => p.Result == "win");
        Assert.AreEqual(10L, winner.UserId);
        Assert.AreEqual(2, winner.Score);
        Assert.AreEqual(0, outcome.Participants.Single(p => p.Result == "loss").Score);
    }

    [TestMethod]
    public void TimeoutWithOneCommitterGivesThemTheRound()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        var ev = engine.ApplyTimeoutPenalty(state, Rng);
        var result = ev.Single(e => e.Kind == "roundResult");
        Assert.AreEqual(10L, Convert.ToInt64(result.Data["winnerId"]));
        Assert.IsTrue((bool)result.Data["timeout"]);
    }

    [TestMethod]
    public void TimeoutWithBothIdleIsDrawAndReplays()
    {
        var engine = new RpsEngine();
        var state = NewState();
        var ev = engine.ApplyTimeoutPenalty(state, Rng);
        var result = ev.Single(e => e.Kind == "roundResult");
        Assert.IsTrue((bool)result.Data["tie"]);
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));
    }

    [TestMethod]
    public void PublicViewHidesOpponentPickUntilResolved()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyAction(state, 10, Pick("rock"), Rng);

        var view20 = engine.PublicView(state, 20);
        // Opponent (10) has picked, but 20 must not see the actual pick, only the flag.
        Assert.AreEqual(true, GetProp(view20, "opponentPicked"));
        Assert.IsNull(GetProp(view20, "myPick"));

        var view10 = engine.PublicView(state, 10);
        Assert.AreEqual("rock", GetProp(view10, "myPick"));
        Assert.AreEqual(false, GetProp(view10, "opponentPicked"));
    }

    [TestMethod]
    public void CapturesFormatAndThrowStats()
    {
        var engine = new RpsEngine();
        var state = NewState(bestOf: 5);
        Assert.AreEqual("bo5", engine.MatchFormat(state));

        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        engine.ApplyAction(state, 20, Pick("scissors"), Rng);
        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        engine.ApplyAction(state, 20, Pick("paper"), Rng);

        var p10 = engine.ParticipantStats(state, 10)!;
        Assert.AreEqual(2, GetInt(p10, "rock"));
        Assert.AreEqual("rock", GetProp(p10, "favoriteThrow"));
    }

    [TestMethod]
    public void InvalidPickRejected()
    {
        var engine = new RpsEngine();
        var state = NewState();
        Assert.ThrowsException<InvalidGameActionException>(() =>
            engine.ApplyAction(state, 10, Pick("lizard"), Rng));
    }

    [TestMethod]
    public void CannotPickTwiceInSameRound()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        Assert.ThrowsException<InvalidGameActionException>(() =>
            engine.ApplyAction(state, 10, Pick("paper"), Rng));
    }

    [TestMethod]
    public void InvalidBestOfFallsBackToThree()
    {
        var engine = new RpsEngine();
        var state = engine.InitialState(Players, Rng, new Dictionary<string, object?> { ["bestOf"] = 4 });
        Assert.AreEqual("bo3", engine.MatchFormat(state));
    }

    [TestMethod]
    public void TwoConsecutiveBothIdleTimeoutsEndsInDraw()
    {
        var engine = new RpsEngine();
        var state = NewState();

        engine.ApplyTimeoutPenalty(state, Rng); // 1st both-idle: replay
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));

        engine.ApplyTimeoutPenalty(state, Rng); // 2nd consecutive both-idle: draw
        var raw = engine.GetOutcome(state);
        Assert.IsInstanceOfType(raw, typeof(GameOutcome.Finished));
        var outcome = (GameOutcome.Finished)raw;
        Assert.IsTrue(outcome.Participants.All(p => p.Result == "draw"));
        Assert.AreEqual(2, outcome.Participants.Count);
    }

    [TestMethod]
    public void APickBetweenIdleTimeoutsResetsTheDrawStreak()
    {
        var engine = new RpsEngine();
        var state = NewState();

        engine.ApplyTimeoutPenalty(state, Rng); // 1st both-idle

        // A decisive round happens (10 beats 20) — resets the streak.
        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        engine.ApplyAction(state, 20, Pick("scissors"), Rng);

        engine.ApplyTimeoutPenalty(state, Rng); // both-idle again, but streak was reset
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress),
            "a pick between idle rounds must reset the streak so no premature draw");
    }

    [TestMethod]
    public void DrawEmitsEndFeedLine()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyTimeoutPenalty(state, Rng);
        engine.ApplyTimeoutPenalty(state, Rng);
        var line = engine.EndFeedLine(state, id => $"user{id}");
        Assert.IsNotNull(line);
        StringAssert.Contains(line, "draw");
    }

    [TestMethod]
    public void IdlePlayersRevealAsNoneNotADefaultThrow()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyTimeoutPenalty(state, Rng); // both idle
        var view = engine.PublicView(state, 10);
        var last = GetProp(view, "lastRound")!;
        Assert.AreEqual("none", GetProp(last, "pick0"));
        Assert.AreEqual("none", GetProp(last, "pick1"));
    }

    [TestMethod]
    public void BothIdleTieFeedLineSaysIdledNotPickedNone()
    {
        var engine = new RpsEngine();
        var state = NewState();
        var ev = engine.ApplyTimeoutPenalty(state, Rng);
        var result = ev.Single(e => e.Kind == "roundResult");
        var line = engine.EventFeedLine(result, id => $"user{id}");
        Assert.IsNotNull(line);
        StringAssert.Contains(line, "idled");
        Assert.IsFalse(line!.Contains("picked none"));
    }

    private static object? GetProp(object o, string name)
        => o.GetType().GetProperty(name)!.GetValue(o);
    private static int GetInt(object o, string name)
        => Convert.ToInt32(o.GetType().GetProperty(name)!.GetValue(o));
}
