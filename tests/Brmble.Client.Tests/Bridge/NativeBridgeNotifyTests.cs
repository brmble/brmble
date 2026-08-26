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
        // The drain window is only observable from another thread, so widen it with a
        // large queue and retry if the drain outran us before we could notify.
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var count = 500_000 * attempt;
            var bridge = NativeBridgeTestHarness.Create();
            const string payload = "{\"type\":\"t\",\"data\":0}";
            for (var i = 0; i < count; i++)
                NativeBridgeTestHarness.Enqueue(bridge, payload);

            var posts = NativeBridgeTestHarness.RecordPosts(bridge);

            // Take the claim, as a real producer would before the UI thread wakes up.
            bridge.NotifyUiThread();
            Assert.AreEqual(1, posts.Count);

            var worker = new Thread(bridge.ProcessUiMessage) { IsBackground = true };
            worker.Start();

            // Notify once the drain has visibly started but is not yet finished.
            var remainingWhenNotified = 0;
            while (true)
            {
                var pending = NativeBridgeTestHarness.PendingCount(bridge);
                if (pending == 0)
                    break; // drain completed before we caught it; retry wider

                if (pending <= count - (count / 10))
                {
                    bridge.NotifyUiThread();
                    remainingWhenNotified = NativeBridgeTestHarness.PendingCount(bridge);
                    break;
                }
            }

            worker.Join();

            // Only trust the attempt if the drain was demonstrably still in flight.
            if (remainingWhenNotified > count / 10)
            {
                Assert.AreEqual(
                    2,
                    posts.Count,
                    "A notify issued mid-drain was swallowed: the claim is being released " +
                    "after the drain instead of before it, so its payload has no pending flush.");
                return;
            }
        }

        Assert.Fail("Could not observe a mid-drain window; the ordering was never exercised.");
    }
}
