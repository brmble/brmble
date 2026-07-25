using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterGameEventForwardingTests
{
    [TestMethod]
    public void QueueSnapshot_ForwardsExactJsonStructureThroughBridge()
    {
        const string json = """
        {
          "type":"game.queueSnapshot",
          "schemaVersion":1,
          "generation":72,
          "revision":19,
          "status":"known",
          "active":{"status":"playing","remaining":{"status":"unknown","method":"fullMedianFallback"}},
          "queue":[{"eta":{"status":"known","segments":[{"method":"conditionalRemaining"}]}}]
        }
        """;
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(adapter, json);

        var sent = NativeBridgeTestHarness.DrainMessages(bridge).Single();
        Assert.AreEqual("game.queueSnapshot", sent.Type);
        using var expected = JsonDocument.Parse(json);
        using var actual = JsonDocument.Parse(sent.DataJson);
        Assert.IsTrue(JsonElement.DeepEquals(expected.RootElement, actual.RootElement));
    }
}
