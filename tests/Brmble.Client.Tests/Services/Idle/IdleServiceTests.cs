using Brmble.Client.Services.Idle;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Idle;

[TestClass]
public class IdleServiceTests
{
    [TestMethod]
    public void ServiceName_IsIdle()
    {
        using var svc = new IdleService();
        Assert.AreEqual("idle", svc.ServiceName);
    }

    [TestMethod]
    public void VoiceTracker_IsExposed()
    {
        using var svc = new IdleService();
        Assert.IsNotNull(svc.VoiceTracker);
        svc.VoiceTracker.UpdateUserStats(1, 100);
        Assert.AreEqual(100u, svc.VoiceTracker.GetCurrent()[1]);
    }

    [TestMethod]
    public void SystemTracker_IsNullBeforeAttachWindow()
    {
        using var svc = new IdleService();
        Assert.IsNull(svc.SystemTracker);
    }

    [TestMethod]
    public void AttachWindow_CreatesSystemTracker()
    {
        using var svc = new IdleService();
        svc.AttachWindow(IntPtr.Zero);
        Assert.IsNotNull(svc.SystemTracker);
    }

    [TestMethod]
    public void StartStop_DoesNotThrow()
    {
        using var svc = new IdleService();
        svc.Start();
        svc.Stop();
        // Re-start is allowed (idempotent)
        svc.Start();
        svc.Stop();
    }

    [TestMethod]
    public void Stop_ClearsVoiceTracker()
    {
        using var svc = new IdleService();
        svc.VoiceTracker.UpdateUserStats(1, 100);
        svc.Stop();
        Assert.AreEqual(0, svc.VoiceTracker.GetCurrent().Count);
    }

    [TestMethod]
    public void BuildIdleUpdatePayload_BeforeAttachWindow_ReturnsZeroSystemAndUnlocked()
    {
        using var svc = new IdleService();
        var payload = svc.BuildIdleUpdatePayload();
        Assert.AreEqual(0, payload.SystemIdle);
        Assert.IsFalse(payload.IsLocked);
        Assert.AreEqual(0, payload.VoiceIdle.Count);
    }

    [TestMethod]
    public void BuildIdleUpdatePayload_IncludesVoiceTrackerSnapshot()
    {
        using var svc = new IdleService();
        svc.VoiceTracker.UpdateUserStats(5, 700);
        svc.VoiceTracker.UpdateUserStats(7, 30);

        var payload = svc.BuildIdleUpdatePayload();
        Assert.AreEqual(2, payload.VoiceIdle.Count);
        Assert.AreEqual(700u, payload.VoiceIdle[5]);
        Assert.AreEqual(30u, payload.VoiceIdle[7]);
    }

    [TestMethod]
    public void BuildIdleUpdatePayload_ReflectsLockState()
    {
        using var svc = new IdleService();
        svc.AttachWindow(IntPtr.Zero);
        svc.SystemTracker!.OnSessionChange(0x7); // WTS_SESSION_LOCK
        var payload = svc.BuildIdleUpdatePayload();
        Assert.IsTrue(payload.IsLocked);
    }

    [TestMethod]
    public void BuildIdleUpdatePayload_VoiceIdleIsSnapshot_NotLiveReference()
    {
        using var svc = new IdleService();
        svc.VoiceTracker.UpdateUserStats(5, 700);
        var payload = svc.BuildIdleUpdatePayload();
        svc.VoiceTracker.UpdateUserStats(5, 999);
        Assert.AreEqual(700u, payload.VoiceIdle[5], "payload must capture state at build time");
    }
}
