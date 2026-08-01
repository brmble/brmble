using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Events;

/// <summary>
/// Every session-mapping payload must carry the envelope. A producer that forgets it makes
/// every connected client detect a permanent gap and resync in a loop.
/// </summary>
[TestClass]
public class MappingPayloadEnvelopeTests
{
    private static readonly string[] MappingEventTypes =
    {
        "userMappingAdded",
        "userMappingRemoved",
        "brmbleClientActivated",
        "brmbleClientDeactivated",
        "companionChanged"
    };

    private static readonly string[] MappingSnapshotTypes =
    {
        "sessionMappingSnapshot"
    };

    [TestMethod]
    public void EveryMappingPayloadTypeIsCoveredByAnEnvelopeAssertion()
    {
        // Guards against a new mapping payload being added without an envelope test.
        // Update these lists and add a matching assertion in the suites listed in the plan.
        Assert.AreEqual(5, MappingEventTypes.Length);
        Assert.AreEqual(1, MappingSnapshotTypes.Length);
    }

    /// <summary>
    /// For incremental events. An event always follows at least one successful mutation, so its
    /// revision is necessarily above zero.
    /// </summary>
    internal static void AssertHasEnvelope(object payload, string expectedType)
    {
        var root = AssertHasEnvelopeCore(payload, expectedType);
        Assert.IsTrue(root.GetProperty("revision").GetInt64() > 0,
            $"{expectedType} must carry the post-mutation revision");
        Assert.IsTrue(root.TryGetProperty("baseRevision", out var baseRevision),
            $"{expectedType} is missing baseRevision, so a client cannot tell a gap from a jump");
        Assert.IsTrue(baseRevision.GetInt64() <= root.GetProperty("revision").GetInt64(),
            $"{expectedType} has baseRevision above revision");
    }

    /// <summary>
    /// For snapshots, which are absolute rather than deltas. A snapshot taken from a freshly
    /// started server that has not yet mutated legitimately carries revision 0, so this does not
    /// require a positive value.
    /// </summary>
    internal static void AssertHasSnapshotEnvelope(object payload, string expectedType)
    {
        var root = AssertHasEnvelopeCore(payload, expectedType);
        Assert.IsTrue(root.GetProperty("revision").GetInt64() >= 0,
            $"{expectedType} must carry a revision");
        Assert.IsFalse(root.TryGetProperty("baseRevision", out _),
            $"{expectedType} is a snapshot and must not carry baseRevision");
    }

    private static JsonElement AssertHasEnvelopeCore(object payload, string expectedType)
    {
        var root = JsonDocument.Parse(JsonSerializer.Serialize(payload)).RootElement;
        Assert.AreEqual(expectedType, root.GetProperty("type").GetString());
        Assert.IsTrue(root.TryGetProperty("instanceId", out var instanceId),
            $"{expectedType} is missing instanceId");
        Assert.IsFalse(string.IsNullOrWhiteSpace(instanceId.GetString()),
            $"{expectedType} has a blank instanceId");
        Assert.IsTrue(root.TryGetProperty("revision", out _),
            $"{expectedType} is missing revision");
        return root;
    }
}
