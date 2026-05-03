using Brmble.Client.Services.Idle;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Idle;

[TestClass]
public class SystemIdleTrackerTests
{
    [TestMethod]
    public void GetIdleSeconds_ReturnsNonNegative()
    {
        using var tracker = new SystemIdleTracker(IntPtr.Zero);
        var idle = tracker.GetIdleSeconds();
        Assert.IsTrue(idle >= 0, $"Expected non-negative idle, got {idle}");
    }

    [TestMethod]
    public void IsLocked_DefaultsToFalse()
    {
        using var tracker = new SystemIdleTracker(IntPtr.Zero);
        Assert.IsFalse(tracker.IsLocked);
    }

    [TestMethod]
    public void OnSessionChange_WtsSessionLock_SetsIsLockedTrue()
    {
        using var tracker = new SystemIdleTracker(IntPtr.Zero);
        tracker.OnSessionChange(0x7); // WTS_SESSION_LOCK
        Assert.IsTrue(tracker.IsLocked);
    }

    [TestMethod]
    public void OnSessionChange_WtsSessionUnlock_SetsIsLockedFalse()
    {
        using var tracker = new SystemIdleTracker(IntPtr.Zero);
        tracker.OnSessionChange(0x7); // lock
        tracker.OnSessionChange(0x8); // unlock
        Assert.IsFalse(tracker.IsLocked);
    }

    [TestMethod]
    public void OnSessionChange_WtsConsoleDisconnect_SetsIsLockedTrue()
    {
        using var tracker = new SystemIdleTracker(IntPtr.Zero);
        tracker.OnSessionChange(0x2); // WTS_CONSOLE_DISCONNECT
        Assert.IsTrue(tracker.IsLocked);
    }

    [TestMethod]
    public void OnSessionChange_UnknownWParam_DoesNothing()
    {
        using var tracker = new SystemIdleTracker(IntPtr.Zero);
        tracker.OnSessionChange(0x99);
        Assert.IsFalse(tracker.IsLocked);
    }
}
