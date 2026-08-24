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
    public void DeathrollSpectatorView_MirrorsThePublicView()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        // DeathrollEngine.ApplyAction requires an explicit `roll: true` payload; an
        // empty action dictionary is rejected as "Unknown action."
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);
        Assert.AreEqual("deathroll", view.Kind);
        CollectionAssert.AreEqual(new[] { 10L, 20L }, view.Players.ToArray());
        Assert.AreEqual(20L, view.CurrentPlayer);
        Assert.AreEqual(50, view.Ceiling);
        Assert.AreEqual(50, view.LastRoll);
        Assert.IsFalse(view.Finished);
        Assert.IsNull(view.LoserId);
    }

    private sealed class FixedRandom(int value) : IRandomSource
    {
        public int Roll(int maxInclusive) => Math.Min(value, maxInclusive);
    }
}
