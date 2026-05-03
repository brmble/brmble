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
}
