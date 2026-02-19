using Brmble.Server.Mumble;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleServerCallbackTests
{
    [TestMethod]
    public async Task DispatchTextMessage_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var h2 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object, h2.Object]);
        var user = new MumbleUser("Alice", "abc", 1);

        await callback.DispatchTextMessage(user, "hello", 42);

        h1.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
        h2.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserConnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserConnected(user);

        h1.Verify(h => h.OnUserConnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserDisconnected(user);

        h1.Verify(h => h.OnUserDisconnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelCreated_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelCreated(channel);

        h1.Verify(h => h.OnChannelCreated(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRemoved_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelRemoved(channel);

        h1.Verify(h => h.OnChannelRemoved(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRenamed_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object]);
        var channel = new MumbleChannel(10, "Renamed");

        await callback.DispatchChannelRenamed(channel);

        h1.Verify(h => h.OnChannelRenamed(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchTextMessage_NoHandlers_DoesNotThrow()
    {
        var callback = new MumbleServerCallback([]);
        await callback.DispatchTextMessage(new MumbleUser("X", "x", 1), "hi", 1);
    }
}
