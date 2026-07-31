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

    [TestMethod]
    public void Snapshot_SerializesEstimatedDurationForEveryEntry()
    {
        var json = JsonSerializer.Serialize(
            DuelWire.ToSnapshot(SnapshotWithAllSections()), DuelWire.JsonOptions);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        var active = root.GetProperty("active").GetProperty("estimatedDuration");
        Assert.AreEqual("known", active.GetProperty("status").GetString());
        Assert.AreEqual(30000, active.GetProperty("milliseconds").GetInt64());
        Assert.AreEqual("fullMedian", active.GetProperty("method").GetString());

        var ready = root.GetProperty("readyCheck").GetProperty("estimatedDuration");
        Assert.AreEqual("unknown", ready.GetProperty("status").GetString());
        Assert.AreEqual(3, ready.GetProperty("sampleCount").GetInt32());

        var queued = root.GetProperty("queue")[0].GetProperty("estimatedDuration");
        Assert.AreEqual(25000, queued.GetProperty("milliseconds").GetInt64());
        Assert.AreEqual(11, queued.GetProperty("sampleCount").GetInt32());
    }

    private static DuelQueueSnapshot SnapshotWithAllSections()
    {
        var baseline = QueueSnapshotWithUnknownFallback();
        return baseline with
        {
            Active = baseline.Active! with
            {
                Remaining = DurationEstimate.Known(12000, 12, EstimateMethod.ConditionalRemaining),
                EstimatedDuration = DurationEstimate.Known(30000, 12, EstimateMethod.FullMedian),
            },
            ReadyCheck = new ReadyCheckSnapshot(
                103,
                baseline.GeneratedAt.AddSeconds(20),
                baseline.Active!.Players,
                "deathroll",
                "1v1",
                1,
                DurationEstimate.Unknown(3)),
            Queue = new[]
            {
                baseline.Queue[0] with
                {
                    EstimatedDuration = DurationEstimate.Known(25000, 11, EstimateMethod.FullMedian),
                },
            },
        };
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
