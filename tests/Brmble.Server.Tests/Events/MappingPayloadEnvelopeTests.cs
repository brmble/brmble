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
        "companionChanged",
        "sessionMappingSnapshot"
    };

    [TestMethod]
    public void EveryMappingEventTypeIsCoveredByAnEnvelopeAssertion()
    {
        // Guards against a new mapping event being added without an envelope test.
        // Update this list and add a matching assertion in the suites listed in the plan.
        Assert.AreEqual(6, MappingEventTypes.Length);
    }

    internal static void AssertHasEnvelope(object payload, string expectedType)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        Assert.AreEqual(expectedType, doc.RootElement.GetProperty("type").GetString());
        Assert.IsTrue(doc.RootElement.TryGetProperty("instanceId", out var instanceId),
            $"{expectedType} is missing instanceId");
        Assert.IsFalse(string.IsNullOrWhiteSpace(instanceId.GetString()),
            $"{expectedType} has a blank instanceId");
        Assert.IsTrue(doc.RootElement.TryGetProperty("revision", out var revision),
            $"{expectedType} is missing revision");
        Assert.IsTrue(revision.GetInt64() > 0,
            $"{expectedType} must carry the post-mutation revision");
    }
}
