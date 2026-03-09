using Brmble.Server.Events;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class ChannelMembershipServiceTests
{
    private ChannelMembershipService _svc = null!;

    [TestInitialize]
    public void Setup() => _svc = new ChannelMembershipService();

    [TestMethod]
    public void Update_StoresChannelForSession()
    {
        _svc.Update(42, 5);
        Assert.IsTrue(_svc.TryGetChannel(42, out var channelId));
        Assert.AreEqual(5, channelId);
    }

    [TestMethod]
    public void Update_OverwritesPrevious()
    {
        _svc.Update(42, 5);
        _svc.Update(42, 10);
        Assert.IsTrue(_svc.TryGetChannel(42, out var channelId));
        Assert.AreEqual(10, channelId);
    }

    [TestMethod]
    public void Remove_ClearsSession()
    {
        _svc.Update(42, 5);
        _svc.Remove(42);
        Assert.IsFalse(_svc.TryGetChannel(42, out _));
    }

    [TestMethod]
    public void GetSessionsInChannel_ReturnsCorrectSessions()
    {
        _svc.Update(1, 5);
        _svc.Update(2, 5);
        _svc.Update(3, 10);

        var sessions = _svc.GetSessionsInChannel(5);
        CollectionAssert.AreEquivalent(new[] { 1, 2 }, sessions.ToList());
    }

    [TestMethod]
    public void GetSessionsInChannel_EmptyChannel_ReturnsEmpty()
    {
        var sessions = _svc.GetSessionsInChannel(99);
        Assert.AreEqual(0, sessions.Count);
    }

    [TestMethod]
    public void Remove_NonExistent_DoesNotThrow()
    {
        _svc.Remove(999);
    }
}
