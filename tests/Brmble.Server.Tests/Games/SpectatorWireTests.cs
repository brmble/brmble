using System.Text.Json;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Spectators;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class SpectatorWireTests
{
    private static readonly JsonSerializerOptions Wire =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [TestMethod]
    public void SnapshotEvent_SerialisesTheDocumentedShape()
    {
        var snapshot = new SpectatorSnapshot(
            SchemaVersion: 1, MatchId: 91, ChannelId: 7, GameType: "rps", Format: "bo3",
            RulesetVersion: 1,
            Players: [new DuelPlayerSnapshot(100, 10, "Qy"), new DuelPlayerSnapshot(200, 20, "Broan")],
            Sequence: 4,
            GeneratedAt: DateTimeOffset.Parse("2026-08-24T14:30:04+00:00"),
            View: new RpsSpectatorView("rps", [10, 20], 3, 2, 2, [1, 0], [true, false], false, null, null));

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(SpectatorWire.ToSnapshotEvent(snapshot), Wire));
        var root = doc.RootElement;
        Assert.AreEqual("game.spectatorSnapshot", root.GetProperty("type").GetString());
        Assert.AreEqual(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.AreEqual(91, root.GetProperty("matchId").GetInt64());
        Assert.AreEqual(7, root.GetProperty("channelId").GetInt32());
        Assert.AreEqual("rps", root.GetProperty("gameType").GetString());
        Assert.AreEqual(4, root.GetProperty("sequence").GetInt64());
        Assert.AreEqual("rps", root.GetProperty("view").GetProperty("kind").GetString());
        Assert.AreEqual(10L, root.GetProperty("players")[0].GetProperty("sessionId").GetInt64());
    }

    [TestMethod]
    public void MatchEndedEvent_CarriesReasonAndOutcome()
    {
        var evt = SpectatorWire.ToMatchEndedEvent(
            91, 7, 9, MatchEndReason.Completed, new { winnerId = 100, loserId = 200 });

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(evt, Wire));
        var root = doc.RootElement;
        Assert.AreEqual("game.spectatorMatchEnded", root.GetProperty("type").GetString());
        Assert.AreEqual("completed", root.GetProperty("reason").GetString());
        Assert.AreEqual(9, root.GetProperty("finalSequence").GetInt64());
        Assert.AreEqual(100, root.GetProperty("outcome").GetProperty("winnerId").GetInt32());
    }

    [TestMethod]
    public void ClosedEvent_UsesCamelCasedReason()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(
            SpectatorWire.ToClosedEvent(7, SpectatorCloseReason.AuthorizationLost), Wire));
        Assert.AreEqual("game.spectatorClosed", doc.RootElement.GetProperty("type").GetString());
        Assert.AreEqual("authorizationLost", doc.RootElement.GetProperty("reason").GetString());
    }

    [DataTestMethod]
    [DataRow(nameof(SpectatorSubscribeReason.None), "none")]
    [DataRow(nameof(SpectatorSubscribeReason.NotPresent), "notPresent")]
    [DataRow(nameof(SpectatorSubscribeReason.NotSameChannel), "notSameChannel")]
    public void SubscribeReason_MapsToStructuredCode(string member, string expected)
    {
        var value = Enum.Parse<SpectatorSubscribeReason>(member);
        Assert.AreEqual(expected, SpectatorWire.Reason(value));
    }

    [DataTestMethod]
    [DataRow(nameof(MatchEndReason.Completed), "completed")]
    [DataRow(nameof(MatchEndReason.Forfeited), "forfeited")]
    public void MatchEndReason_MapsToStructuredCode(string member, string expected)
    {
        var value = Enum.Parse<MatchEndReason>(member);
        Assert.AreEqual(expected, SpectatorWire.Reason(value));
    }

    [DataTestMethod]
    [DataRow(nameof(SpectatorCloseReason.Unsubscribed), "unsubscribed")]
    [DataRow(nameof(SpectatorCloseReason.AuthorizationLost), "authorizationLost")]
    [DataRow(nameof(SpectatorCloseReason.Disconnected), "disconnected")]
    [DataRow(nameof(SpectatorCloseReason.ChannelRemoved), "channelRemoved")]
    public void CloseReason_MapsToStructuredCode(string member, string expected)
    {
        var value = Enum.Parse<SpectatorCloseReason>(member);
        Assert.AreEqual(expected, SpectatorWire.Reason(value));
    }

    [TestMethod]
    public void EveryEnumMemberHasAPinnedWireString()
    {
        CollectionAssert.AreEquivalent(
            Enum.GetNames<SpectatorSubscribeReason>(),
            new[] { "None", "NotPresent", "NotSameChannel" });
        CollectionAssert.AreEquivalent(
            Enum.GetNames<MatchEndReason>(),
            new[] { "Completed", "Forfeited" });
        CollectionAssert.AreEquivalent(
            Enum.GetNames<SpectatorCloseReason>(),
            new[] { "Unsubscribed", "AuthorizationLost", "Disconnected", "ChannelRemoved" });
    }
}
