using Brmble.Client.Bridge;
using Brmble.Client.Tests.Services;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Bridge;

[TestClass]
public class NativeBridgeNotifyTests
{
    [TestMethod]
    public void Notify_CalledRepeatedlyWithoutProcessing_PostsOnce()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var posts = NativeBridgeTestHarness.RecordPosts(bridge);

        bridge.NotifyUiThread();
        bridge.NotifyUiThread();
        bridge.NotifyUiThread();

        Assert.AreEqual(1, posts.Count);
    }

    [TestMethod]
    public void Notify_AfterProcessUiMessage_PostsAgain()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var posts = NativeBridgeTestHarness.RecordPosts(bridge);

        bridge.NotifyUiThread();
        bridge.NotifyUiThread();
        bridge.ProcessUiMessage();
        bridge.NotifyUiThread();

        Assert.AreEqual(2, posts.Count);
    }

    [TestMethod]
    public void Notify_WhileCoalesced_LosesNoMessages()
    {
        var bridge = NativeBridgeTestHarness.Create();
        NativeBridgeTestHarness.RecordPosts(bridge);

        for (var i = 0; i < 50; i++)
        {
            NativeBridgeTestHarness.Enqueue(bridge, $"{{\"type\":\"t\",\"data\":{i}}}");
            bridge.NotifyUiThread();
        }

        var drained = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.AreEqual(50, drained.Count);
    }
}
