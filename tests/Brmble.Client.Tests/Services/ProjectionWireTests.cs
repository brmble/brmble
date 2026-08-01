using System.Text.Json;
using Brmble.Client.Services.Voice;
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class ProjectionWireTests
{
    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    [TestMethod]
    public void ReadSnapshot_ReadsTheEnvelopeAndEveryMapping()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        {
          "instanceId": "inst-a",
          "revision": 7,
          "mappings": {
            "3": { "matrixUserId": "@alice:test", "mumbleName": "Alice",
                   "companionId": "retro", "certHash": "abc", "isBrmbleClient": true }
          }
        }
        """));

        Assert.IsNotNull(snapshot);
        Assert.AreEqual("inst-a", snapshot!.InstanceId);
        Assert.AreEqual(7L, snapshot.Revision);
        var entry = snapshot.Mappings[3];
        Assert.AreEqual("@alice:test", entry.MatrixUserId);
        Assert.AreEqual("retro", entry.CompanionId);
        Assert.AreEqual(true, entry.IsBrmbleClient);
        Assert.AreEqual("abc", entry.CertHash);
    }

    [TestMethod]
    public void ReadSnapshot_KeepsAMappingWithNoMumbleName()
    {
        // The old ParseSessionMappings dropped these outright, losing the identity entirely.
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "matrixUserId": "@alice:test" } } }
        """));

        Assert.AreEqual("@alice:test", snapshot!.Mappings[3].MatrixUserId);
    }

    [TestMethod]
    public void ReadSnapshot_AbsentCompanionIsUnknownNotFloppy()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "matrixUserId": "@a:t" } } }
        """));

        Assert.IsNull(snapshot!.Mappings[3].CompanionId,
            "a default must never be transmitted as though it were a fact");
    }

    [TestMethod]
    public void ReadSnapshot_NullIsBrmbleClientIsUnknownNotFalse()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "matrixUserId": "@a:t", "isBrmbleClient": null } } }
        """));

        Assert.IsNull(snapshot!.Mappings[3].IsBrmbleClient);
    }

    [TestMethod]
    public void ReadSnapshot_PrefersACustomCompanionOverTheLegacyField()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "companionId": "floppy",
                               "customCompanionId": "custom:$abc" } } }
        """));

        Assert.AreEqual("custom:$abc", snapshot!.Mappings[3].CompanionId,
            "the legacy split sends floppy alongside the truth; the truth wins");
    }

    [TestMethod]
    public void ReadSnapshot_ReturnsNullWhenTheEnvelopeIsMissing()
    {
        Assert.IsNull(ProjectionWire.ReadSnapshot(Json("""{ "mappings": {} }""")));
    }

    [TestMethod]
    public void ReadEvent_ReadsAMappingAddedWithItsRange()
    {
        var evt = ProjectionWire.ReadEvent("userMappingAdded", Json("""
        { "instanceId": "inst-a", "baseRevision": 4, "revision": 7, "sessionId": 3,
          "matrixUserId": "@alice:test", "companionId": "retro", "isBrmbleClient": true }
        """));

        Assert.IsNotNull(evt);
        Assert.AreEqual(ServerEventKind.MappingAdded, evt!.Kind);
        Assert.AreEqual(4L, evt.BaseRevision);
        Assert.AreEqual(7L, evt.Revision);
        Assert.AreEqual(3u, evt.SessionId);
        Assert.AreEqual("retro", evt.Entry!.CompanionId);
    }

    [TestMethod]
    public void ReadEvent_ActivationCarriesNoEntry()
    {
        var evt = ProjectionWire.ReadEvent("brmbleClientActivated", Json("""
        { "instanceId": "i", "baseRevision": 1, "revision": 2, "sessionId": 3 }
        """));

        Assert.AreEqual(ServerEventKind.BrmbleActivated, evt!.Kind);
        Assert.IsNull(evt.Entry);
    }

    [TestMethod]
    public void ReadEvent_DefaultsAMissingBaseRevisionToOneBelowRevision()
    {
        // A server predating Phase 1 sends no baseRevision. Assuming a single bump is the
        // only reading that lets an old server still drive a new client.
        var evt = ProjectionWire.ReadEvent("companionChanged", Json("""
        { "instanceId": "i", "revision": 9, "sessionId": 3, "companionId": "bee" }
        """));

        Assert.AreEqual(8L, evt!.BaseRevision);
    }

    [TestMethod]
    public void ReadEvent_ReturnsNullForAnUnknownType()
    {
        Assert.IsNull(ProjectionWire.ReadEvent("screenShare.started", Json("{}")));
    }

    [TestMethod]
    public void ReadEvent_ReturnsNullWithoutASessionId()
    {
        Assert.IsNull(ProjectionWire.ReadEvent("companionChanged",
            Json("""{ "instanceId": "i", "revision": 2 }""")));
    }

    [TestMethod]
    public void ReadSnapshot_SkipsNonNumericSessionKeys()
    {
        // Ported from ParseSessionMappings_SkipsNonNumericKeys.
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "abc": { "matrixUserId": "@x:t" },
                        "42":  { "matrixUserId": "@y:t" } } }
        """));

        Assert.AreEqual(1, snapshot!.Mappings.Count);
        Assert.IsTrue(snapshot.Mappings.ContainsKey(42));
    }

    [TestMethod]
    public void ReadSnapshot_EmptyMappingsIsAnEmptyTableNotAFailure()
    {
        // Ported from ParseSessionMappings_EmptyObject_ReturnsEmpty. An empty table is a
        // legitimate statement: the server knows about nobody.
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1, "mappings": {} }
        """));

        Assert.IsNotNull(snapshot);
        Assert.AreEqual(0, snapshot!.Mappings.Count);
    }

    [TestMethod]
    public void ReadSnapshot_ExplicitFalseIsBrmbleClientIsKnowledge()
    {
        // Ported from ParseSessionMappings_WithIsBrmbleClient_RoundTrips. An explicit false is
        // a fact and must survive as false, distinct from the absent case above.
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "1": { "matrixUserId": "@alice:t", "isBrmbleClient": true },
                        "2": { "matrixUserId": "@bob:t",   "isBrmbleClient": false } } }
        """));

        Assert.AreEqual(true, snapshot!.Mappings[1].IsBrmbleClient);
        Assert.AreEqual(false, snapshot.Mappings[2].IsBrmbleClient);
        Assert.AreEqual("@alice:t", snapshot.Mappings[1].MatrixUserId);
    }

    [TestMethod]
    public void ToWireRow_EmitsEveryFieldWithNullsExplicit()
    {
        var row = new UserProjection
        {
            SessionId = 3,
            Name = "Alice",
            ChannelId = 5,
            Muted = true,
            Deafened = false,
            Comment = "hi",
            MumbleCertHash = "live",
            IsSelf = true,
            MatrixUserId = "@alice:test",
            CompanionId = null,
            IsBrmbleClient = null,
            ServerCertHash = "stored"
        };

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(ProjectionWire.ToWireRow(row)));
        var json = doc.RootElement;

        Assert.AreEqual(3, json.GetProperty("session").GetInt32());
        Assert.AreEqual("Alice", json.GetProperty("name").GetString());
        Assert.AreEqual(5, json.GetProperty("channelId").GetInt32());
        Assert.IsTrue(json.GetProperty("muted").GetBoolean());
        Assert.IsTrue(json.GetProperty("self").GetBoolean());
        Assert.AreEqual("live", json.GetProperty("certHash").GetString(),
            "the live certificate wins over the server's recorded copy");

        // Nulls must be present rather than omitted: React replaces rows wholesale, so an
        // absent key and a null key must not mean different things.
        Assert.AreEqual(JsonValueKind.Null, json.GetProperty("companionId").ValueKind);
        Assert.AreEqual(JsonValueKind.Null, json.GetProperty("isBrmbleClient").ValueKind);
    }
}
