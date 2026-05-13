using System.Reflection;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterBridgeTests
{
    [TestMethod]
    public void HandleWebSocketMessage_CompanionChanged_EmitsBridgeEvent()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);

        InvokePrivate(adapter, "HandleWebSocketMessage", """
        {"type":"companionChanged","sessionId":42,"matrixUserId":"@alice:test","companionId":"retro"}
        """);

        AssertBridgeSent(bridge, "voice.companionChanged");
    }

    private static MumbleAdapter CreateAdapterWithBridge(out NativeBridge bridge)
    {
        bridge = NativeBridgeTestHarness.Create();
        return MumbleAdapterTestHarness.CreateWithBridge(bridge);
    }

    private static void InvokePrivate(object instance, string methodName, string json)
    {
        var method = instance.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
        method!.Invoke(instance, [json]);
    }

    private static void AssertBridgeSent(NativeBridge bridge, string expectedType)
    {
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsTrue(sent.Any(m => m.Type == expectedType), $"Expected bridge message '{expectedType}' to be sent.");
    }
}
