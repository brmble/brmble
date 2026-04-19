using Brmble.Server.LiveKit;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class ScreenShareTrackerTests
{
    private ScreenShareTracker _tracker = null!;

    [TestInitialize]
    public void Setup() => _tracker = new ScreenShareTracker();

    // --- GetActiveShares ---

    [TestMethod]
    public void GetActiveShares_NoShares_ReturnsEmpty()
    {
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(0, shares.Count);
    }

    [TestMethod]
    public void GetActiveShares_SingleShare_ReturnsSingle()
    {
        _tracker.Start("channel-1", "maui", 2L);
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(1, shares.Count);
        Assert.AreEqual("maui", shares[0].UserName);
        Assert.AreEqual(2L, shares[0].UserId);
    }

    [TestMethod]
    public void GetActiveShares_MultipleUsers_ReturnsAll()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-1", "bob", 20L);
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(2, shares.Count);
    }

    // --- Start duplicate rejection ---

    [TestMethod]
    public void Start_SameUserTwice_ReturnsFalse()
    {
        Assert.IsTrue(_tracker.Start("channel-1", "alice", 10L));
        Assert.IsFalse(_tracker.Start("channel-1", "alice", 10L));
        Assert.AreEqual(1, _tracker.GetActiveShares("channel-1").Count);
    }

    // --- StopByUserId ---

    [TestMethod]
    public void StopByUserId_RemovesCorrectShare_OthersRemain()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-1", "bob", 20L);
        _tracker.StopByUserId("channel-1", 10L);
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(1, shares.Count);
        Assert.AreEqual("bob", shares[0].UserName);
    }

    [TestMethod]
    public void StopByUserId_NonExistent_DoesNotThrow()
    {
        _tracker.StopByUserId("no-room", 99L);
    }

    // --- GetSharesByUserId ---

    [TestMethod]
    public void GetSharesByUserId_ReturnsAllRooms()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-2", "alice", 10L);
        var rooms = _tracker.GetSharesByUserId(10L);
        Assert.AreEqual(2, rooms.Count);
        CollectionAssert.Contains(rooms, "channel-1");
        CollectionAssert.Contains(rooms, "channel-2");
    }

    [TestMethod]
    public void GetSharesByUserId_NoShares_ReturnsEmpty()
    {
        var rooms = _tracker.GetSharesByUserId(99L);
        Assert.AreEqual(0, rooms.Count);
    }

    // --- StopAllByUserId ---

    [TestMethod]
    public void StopAllByUserId_RemovesFromAllRooms_OthersRemain()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-1", "bob", 20L);
        _tracker.Start("channel-2", "alice", 10L);
        _tracker.StopAllByUserId(10L);

        Assert.AreEqual(1, _tracker.GetActiveShares("channel-1").Count);
        Assert.AreEqual("bob", _tracker.GetActiveShares("channel-1")[0].UserName);
        Assert.AreEqual(0, _tracker.GetActiveShares("channel-2").Count);
    }

    // --- Backward compat ---

    [TestMethod]
    public void GetActive_NoShare_ReturnsNull()
    {
        Assert.IsNull(_tracker.GetActive("channel-1"));
    }

    [TestMethod]
    public void GetActive_WithShare_ReturnsFirst()
    {
        _tracker.Start("channel-1", "maui", 2L);
        var info = _tracker.GetActive("channel-1");
        Assert.IsNotNull(info);
        Assert.AreEqual("maui", info.UserName);
        Assert.AreEqual(2L, info.UserId);
    }

    [TestMethod]
    public void GetActiveByUserId_ReturnsRoomName()
    {
        _tracker.Start("channel-1", "maui", 2L);
        Assert.AreEqual("channel-1", _tracker.GetActiveByUserId(2L));
    }

    [TestMethod]
    public void GetActiveByUserId_NoShare_ReturnsNull()
    {
        Assert.IsNull(_tracker.GetActiveByUserId(99L));
    }

    [TestMethod]
    public void Stop_RemovesAllSharesInRoom()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-1", "bob", 20L);
        _tracker.Stop("channel-1");
        Assert.AreEqual(0, _tracker.GetActiveShares("channel-1").Count);
    }

    [TestMethod]
    public void Stop_NonExistent_DoesNotThrow()
    {
        _tracker.Stop("no-such-room");
    }
}
