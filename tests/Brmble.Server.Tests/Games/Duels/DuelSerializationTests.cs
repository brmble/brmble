using System.Text.Json;
using Brmble.Server.Games.Duels;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games.Duels;

[TestClass]
public sealed class DuelSerializationTests
{
    [TestMethod]
    public void SnapshotWire_UsesCamelCaseStringEnums()
    {
        var json = JsonSerializer.Serialize(DuelWire.ToSnapshot(QueueSnapshotWithUnknownFallback()), DuelWire.JsonOptions);

        StringAssert.Contains(json, "\"status\":\"unknown\"");
        StringAssert.Contains(json, "\"method\":\"fullMedianFallback\"");
        Assert.IsFalse(json.Contains("\"status\":1"));
        Assert.IsFalse(json.Contains("FullMedianFallback"));
        Assert.IsFalse(json.Contains("SchemaVersion"));
    }

    [TestMethod]
    public void EventAndDirectWebSocketSerializers_ProduceSameWireContract()
    {
        var payload = DuelWire.ToEvent(QueueSnapshotWithUnknownFallback());
        var eventBusJson = JsonSerializer.Serialize(payload,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        var directSocketJson = JsonSerializer.Serialize(payload, DuelWire.JsonOptions);

        Assert.AreEqual(JsonDocument.Parse(eventBusJson).RootElement.ToString(),
            JsonDocument.Parse(directSocketJson).RootElement.ToString());
        StringAssert.Contains(directSocketJson, "\"type\":\"game.queueSnapshot\"");
        StringAssert.Contains(directSocketJson, "\"players\":[{\"userId\":1,\"sessionId\":10");
        StringAssert.Contains(directSocketJson, "\"remaining\":{\"status\":\"unknown\"");
        StringAssert.Contains(directSocketJson, "\"segments\":[{\"gameType\":\"rps\"");
        Assert.IsFalse(directSocketJson.Contains("\"snapshot\""));

        var errorJson = JsonSerializer.Serialize(
            new GameErrorWire("A player is committed.", DuelWire.Reason(DuelRejectReason.AlreadyCommitted)),
            DuelWire.JsonOptions);
        StringAssert.Contains(errorJson, "\"reason\":\"alreadyCommitted\"");
    }

    private static DuelQueueSnapshot QueueSnapshotWithUnknownFallback()
    {
        var generatedAt = new DateTimeOffset(2026, 7, 25, 14, 30, 0, TimeSpan.Zero);
        var players = new[]
        {
            new DuelPlayerSnapshot(1, 10, "Alice"),
            new DuelPlayerSnapshot(2, 20, "Bob"),
        };
        return new DuelQueueSnapshot(
            1,
            2,
            18,
            7,
            generatedAt,
            3,
            new ActiveDuelSnapshot(
                91,
                "live",
                generatedAt.AddSeconds(-40),
                players,
                "rps",
                "bo3",
                1,
                new DurationEstimate(EstimateStatus.Unknown, null, 9, EstimateMethod.FullMedianFallback, true),
                DurationEstimate.Unknown(9)),
            null,
            new[]
            {
                new QueuedDuelSnapshot(
                    102,
                    1,
                    players,
                    "deathroll",
                    "1v1",
                    1,
                    new QueueEtaSnapshot(
                        EstimateStatus.Unknown,
                        null,
                        null,
                        true,
                        new[] { new EtaSegmentSnapshot("rps", "bo3", 1, 9, EstimateMethod.FullMedianFallback) }),
                    DurationEstimate.Unknown(9))
            });
    }
}
