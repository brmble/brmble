using Brmble.Client.Services.Idle;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Idle;

[TestClass]
public class VoiceIdleTrackerTests
{
    [TestMethod]
    public void GetCurrent_ReturnsEmpty_WhenNoUpdates()
    {
        var t = new VoiceIdleTracker();
        Assert.AreEqual(0, t.GetCurrent().Count);
    }

    [TestMethod]
    public void UpdateUserStats_StoresValue()
    {
        var t = new VoiceIdleTracker();
        t.UpdateUserStats(42, 600);

        var snapshot = t.GetCurrent();
        Assert.AreEqual(1, snapshot.Count);
        Assert.AreEqual(600u, snapshot[42]);
    }

    [TestMethod]
    public void UpdateUserStats_OverwritesExisting()
    {
        var t = new VoiceIdleTracker();
        t.UpdateUserStats(42, 600);
        t.UpdateUserStats(42, 700);

        Assert.AreEqual(700u, t.GetCurrent()[42]);
    }

    [TestMethod]
    public void RemoveUser_DropsSession()
    {
        var t = new VoiceIdleTracker();
        t.UpdateUserStats(42, 600);
        t.UpdateUserStats(43, 700);
        t.RemoveUser(42);

        var snapshot = t.GetCurrent();
        Assert.AreEqual(1, snapshot.Count);
        Assert.IsFalse(snapshot.ContainsKey(42));
        Assert.AreEqual(700u, snapshot[43]);
    }

    [TestMethod]
    public void Clear_DropsEverything()
    {
        var t = new VoiceIdleTracker();
        t.UpdateUserStats(42, 600);
        t.UpdateUserStats(43, 700);
        t.Clear();

        Assert.AreEqual(0, t.GetCurrent().Count);
    }

    [TestMethod]
    public void GetCurrent_ReturnsSnapshot_NotLiveReference()
    {
        var t = new VoiceIdleTracker();
        t.UpdateUserStats(42, 600);

        var snapshot = t.GetCurrent();
        t.UpdateUserStats(42, 999);

        Assert.AreEqual(600u, snapshot[42], "snapshot must not see later updates");
    }
}
