using System.Text.Json;
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Brmble.Server.Games.Spectators;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class SpectatorViewTests
{
    private static readonly JsonSerializerOptions Wire =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static object RpsStateWithOneCommit()
    {
        var engine = new RpsEngine();
        var state = engine.InitialState(
            [new GamePlayer(10), new GamePlayer(20)],
            new FixedRandom(1),
            new Dictionary<string, object?> { ["bestOf"] = 3 });
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["pick"] = "rock" }, new FixedRandom(1));
        return state;
    }

    [TestMethod]
    public void RpsSpectatorView_UnresolvedRound_LeaksNoThrowValue()
    {
        var engine = new RpsEngine();
        var view = (RpsSpectatorView)engine.SpectatorView(RpsStateWithOneCommit());

        Assert.IsNull(view.LastRound, "No round has resolved yet.");
        CollectionAssert.AreEqual(new[] { true, false }, view.Committed.ToArray());

        var json = JsonSerializer.Serialize(view, Wire).ToLowerInvariant();
        foreach (var leak in new[] { "rock", "paper", "scissors", "mypick", "opponentpicked", "\"picks\"", "pick0", "pick1" })
            Assert.IsFalse(json.Contains(leak), $"Unresolved RPS spectator view leaked '{leak}': {json}");
    }

    [TestMethod]
    public void RpsSpectatorView_ResolvedRound_RevealsBothThrowsInLastRoundOnly()
    {
        var engine = new RpsEngine();
        var state = RpsStateWithOneCommit();
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["pick"] = "scissors" }, new FixedRandom(1));

        var view = (RpsSpectatorView)engine.SpectatorView(state);
        Assert.IsNotNull(view.LastRound);
        Assert.AreEqual("rock", view.LastRound!.Pick0);
        Assert.AreEqual("scissors", view.LastRound.Pick1);
        Assert.AreEqual(10L, view.LastRound.WinnerId);
        Assert.IsFalse(view.LastRound.Tie);
        CollectionAssert.AreEqual(new[] { false, false }, view.Committed.ToArray(), "Picks reset after resolution.");
    }

    [TestMethod]
    public void RpsSpectatorView_RoundInProgressAfterAReveal_LeaksOnlyTheOldRoundsThrows()
    {
        // The dangerous state: a previous round's reveal is still present while a new
        // round is live. A blanket substring ban cannot police this, because round 1's
        // throws legitimately appear inside LastRound. So round 2's pick is deliberately
        // a THIRD throw value ("paper") that round 1 never used, letting us assert its
        // absence precisely while still allowing the legitimate reveal through.
        var engine = new RpsEngine();
        var state = RpsStateWithOneCommit();                                  // round 1: 10 -> rock
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["pick"] = "scissors" }, new FixedRandom(1));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["pick"] = "paper" }, new FixedRandom(1));

        var view = (RpsSpectatorView)engine.SpectatorView(state);

        CollectionAssert.AreEqual(new[] { true, false }, view.Committed.ToArray(),
            "Round 2 is in progress with only player 10 committed.");
        Assert.IsNotNull(view.LastRound);
        Assert.AreEqual(1, view.LastRound!.RoundNumber, "The reveal must be the OLD round, not the live one.");
        Assert.AreEqual(2, view.RoundNumber, "A new round is underway.");

        var json = JsonSerializer.Serialize(view, Wire).ToLowerInvariant();
        Assert.IsFalse(json.Contains("paper"),
            $"The live round-2 pick leaked into the spectator view: {json}");
        // Round 1's throws may appear, but only once each — inside LastRound and nowhere else.
        Assert.AreEqual(1, CountOccurrences(json, "rock"), $"'rock' should appear only in LastRound: {json}");
        Assert.AreEqual(1, CountOccurrences(json, "scissors"), $"'scissors' should appear only in LastRound: {json}");
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        for (var i = haystack.IndexOf(needle, StringComparison.Ordinal); i >= 0;
             i = haystack.IndexOf(needle, i + needle.Length, StringComparison.Ordinal))
            count++;
        return count;
    }

    [TestMethod]
    public void DeathrollSpectatorView_MirrorsThePublicView()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        // DeathrollEngine.ApplyAction requires an explicit `roll: true` payload; an
        // empty action dictionary is rejected as "Unknown action."
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);
        // Deathroll has no private state, so every field the participant view exposes
        // must match the spectator view field for field. Comparing against the real
        // PublicView (rather than hardcoded literals) keeps the two drifting together.
        var pub = JsonSerializer.SerializeToElement(engine.PublicView(state, 10), Wire);

        CollectionAssert.AreEqual(
            pub.GetProperty("players").EnumerateArray().Select(e => e.GetInt64()).ToArray(),
            view.Players.ToArray());
        Assert.AreEqual(pub.GetProperty("currentPlayer").GetInt64(), view.CurrentPlayer);
        Assert.AreEqual(pub.GetProperty("ceiling").GetInt32(), view.Ceiling);
        Assert.AreEqual(pub.GetProperty("lastRoll").GetInt32(), view.LastRoll);
        Assert.AreEqual(pub.GetProperty("finished").GetBoolean(), view.Finished);
        Assert.AreEqual(JsonValueKind.Null, pub.GetProperty("loserId").ValueKind);
        Assert.IsNull(view.LoserId);

        // Sanity-check the shared values are the ones the engine should have produced,
        // so a mirrored-but-wrong pair cannot pass: rolling 50 on a ceiling of 100
        // lowers the ceiling to 50 and passes the turn to player 20.
        Assert.AreEqual(20L, view.CurrentPlayer);
        Assert.AreEqual(50, view.Ceiling);
        Assert.AreEqual(50, view.LastRoll);
        Assert.IsFalse(view.Finished);
    }

    [TestMethod]
    public void DeathrollSpectatorView_BeforeAnyRoll_HasNoLastRollBy()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.IsNull(view.LastRoll);
        Assert.IsNull(view.LastRollBy, "Nobody has rolled yet.");
    }

    [TestMethod]
    public void DeathrollSpectatorView_AttributesANonFatalRollToTheRoller()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.AreEqual(50, view.LastRoll);
        Assert.AreEqual(10L, view.LastRollBy, "Player 10 rolled, even though it is now player 20's turn.");
        Assert.AreEqual(20L, view.CurrentPlayer);
    }

    [TestMethod]
    public void DeathrollSpectatorView_AttributesTheFatalRollToTheLoser()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));
        // Player 20 rolls a 1 and loses. CurrentIndex is NOT flipped on a fatal roll.
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(1));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.AreEqual(1, view.LastRoll);
        Assert.AreEqual(20L, view.LoserId);
        Assert.AreEqual(20L, view.LastRollBy, "The losing roll belongs to the loser.");
        Assert.IsNull(view.CurrentPlayer, "The match is over, so nobody is to move.");
    }

    [TestMethod]
    public void DeathrollSpectatorView_ANonFatalTimeoutLeavesTheRollWithItsOriginalRoller()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));
        // Player 20 times out. The ceiling drops; LastRoll and CurrentIndex are untouched.
        engine.ApplyTimeoutPenalty(state, new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.AreEqual(50, view.LastRoll);
        Assert.AreEqual(10L, view.LastRollBy, "A timeout by player 20 does not transfer player 10's roll.");
    }

    private sealed class FixedRandom(int value) : IRandomSource
    {
        public int Roll(int maxInclusive) => Math.Min(value, maxInclusive);
    }
}
