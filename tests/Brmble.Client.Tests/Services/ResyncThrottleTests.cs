using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class ResyncThrottleTests
{
    [TestMethod]
    public void AllowsTheFirstRequestImmediately()
    {
        var throttle = new ResyncThrottle();
        Assert.IsTrue(throttle.TryBegin(TimeSpan.Zero));
    }

    [TestMethod]
    public void RefusesASecondRequestWhileOneIsInFlight()
    {
        var throttle = new ResyncThrottle();
        throttle.TryBegin(TimeSpan.Zero);

        Assert.IsFalse(throttle.TryBegin(TimeSpan.FromSeconds(5)),
            "one in flight at a time, or a burst of events becomes a burst of snapshots");
    }

    [TestMethod]
    public void EnforcesMinimumSpacingAfterCompletion()
    {
        var throttle = new ResyncThrottle();
        throttle.TryBegin(TimeSpan.Zero);
        throttle.Complete(TimeSpan.FromMilliseconds(100));

        Assert.IsFalse(throttle.TryBegin(TimeSpan.FromMilliseconds(200)));
        Assert.IsTrue(throttle.TryBegin(TimeSpan.FromMilliseconds(1200)));
    }

    [TestMethod]
    public void BacksOffExponentiallyToThirtySeconds()
    {
        var throttle = new ResyncThrottle();
        var now = TimeSpan.Zero;

        for (var i = 0; i < 12; i++)
        {
            now += TimeSpan.FromMinutes(1);
            Assert.IsTrue(throttle.TryBegin(now), $"attempt {i} should be allowed after a long wait");
            throttle.Complete(now);
        }

        Assert.AreEqual(TimeSpan.FromSeconds(30), throttle.CurrentDelay,
            "backoff must saturate rather than grow without bound");
    }

    [TestMethod]
    public void ResetsBackoffOnceASnapshotArrives()
    {
        var throttle = new ResyncThrottle();
        throttle.TryBegin(TimeSpan.Zero);
        throttle.Complete(TimeSpan.Zero);
        throttle.TryBegin(TimeSpan.FromSeconds(10));
        throttle.Complete(TimeSpan.FromSeconds(10));

        throttle.OnSnapshotApplied();

        Assert.AreEqual(TimeSpan.FromSeconds(1), throttle.CurrentDelay);
    }
}
