using Brmble.Server.LiveKit;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class ScreenShareTrackerTests
{
    private ScreenShareTracker _tracker = null!;

    [TestInitialize]
    public void Setup() => _tracker = new ScreenShareTracker();

    [TestMethod]
    public void GetActive_NoShare_ReturnsNull()
    {
        Assert.IsNull(_tracker.GetActive("channel-1"));
    }

    [TestMethod]
    public void Start_ThenGetActive_ReturnsInfo()
    {
        _tracker.Start("channel-1", "maui", "@2:noscope.it");
        var info = _tracker.GetActive("channel-1");
        Assert.IsNotNull(info);
        Assert.AreEqual("maui", info.UserName);
        Assert.AreEqual("@2:noscope.it", info.MatrixUserId);
    }

    [TestMethod]
    public void Stop_RemovesShare()
    {
        _tracker.Start("channel-1", "maui", "@2:noscope.it");
        _tracker.Stop("channel-1");
        Assert.IsNull(_tracker.GetActive("channel-1"));
    }

    [TestMethod]
    public void Start_OverwritesPrevious()
    {
        _tracker.Start("channel-1", "alice", "@alice:x");
        _tracker.Start("channel-1", "bob", "@bob:x");
        var info = _tracker.GetActive("channel-1");
        Assert.IsNotNull(info);
        Assert.AreEqual("bob", info.UserName);
    }

    [TestMethod]
    public void Stop_NonExistent_DoesNotThrow()
    {
        _tracker.Stop("no-such-room");
    }
}
