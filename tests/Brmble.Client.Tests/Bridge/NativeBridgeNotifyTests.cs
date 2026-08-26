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
        var posts = NativeBridgeTestHarness.RecordPosts(bridge);

        for (var i = 0; i < 50; i++)
        {
            NativeBridgeTestHarness.Enqueue(bridge, $"{{\"type\":\"t\",\"data\":{i}}}");
            bridge.NotifyUiThread();
        }

        // All 50 payloads are riding on a single outstanding post.
        Assert.AreEqual(1, posts.Count);
        Assert.AreEqual(50, NativeBridgeTestHarness.PendingCount(bridge));

        // That one post's drain must deliver every one of them.
        bridge.ProcessUiMessage();
        Assert.AreEqual(0, NativeBridgeTestHarness.PendingCount(bridge));

        // And the claim must be free again afterwards, so later payloads are not stranded.
        NativeBridgeTestHarness.Enqueue(bridge, "{\"type\":\"t\",\"data\":50}");
        bridge.NotifyUiThread();
        Assert.AreEqual(2, posts.Count);
        Assert.AreEqual(1, NativeBridgeTestHarness.PendingCount(bridge));
    }

    /// <summary>
    /// Pins the release-before-drain ordering in ProcessUiMessage. If the
    /// Interlocked.Exchange that clears _notifyPending is moved below the drain loop,
    /// a NotifyUiThread issued while the drain is still running sees the claim held,
    /// skips its post, and leaves its payload queued with nothing scheduled to flush
    /// it. This test fails in exactly that case.
    /// </summary>
    [TestMethod]
    public void ProcessUiMessage_NotifyDuringDrain_PostsAgain()
    {
        var bridge = NativeBridgeTestHarness.Create();
        NativeBridgeTestHarness.Enqueue(bridge, "{\"type\":\"t\",\"data\":0}");
        NativeBridgeTestHarness.Enqueue(bridge, "{\"type\":\"t\",\"data\":1}");

        var posts = NativeBridgeTestHarness.RecordPosts(bridge);

        // Notify from inside the drain, on the first dequeued message only — the same
        // position a producer thread would occupy while the UI thread is mid-drain.
        var notified = false;
        NativeBridgeTestHarness.OnDrainStep(bridge, () =>
        {
            if (notified)
                return;
            notified = true;
            bridge.NotifyUiThread();
        });

        // Take the claim, as a real producer does before the UI thread wakes up.
        bridge.NotifyUiThread();
        Assert.AreEqual(1, posts.Count);

        bridge.ProcessUiMessage();

        Assert.IsTrue(notified, "The drain seam never ran, so the ordering was not exercised.");
        Assert.AreEqual(
            2,
            posts.Count,
            "A notify issued mid-drain was swallowed: the claim is being released after the " +
            "drain instead of before it, so its payload has no pending flush.");
    }
}
