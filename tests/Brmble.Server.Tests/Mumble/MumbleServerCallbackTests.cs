using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleServerCallbackTests
{
    [TestMethod]
    public async Task DispatchTextMessage_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var h2 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object, h2.Object], NullLogger<MumbleServerCallback>.Instance);
        var user = new MumbleUser("Alice", "abc", 1);

        await callback.DispatchTextMessage(user, "hello", 42);

        h1.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
        h2.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserConnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object], NullLogger<MumbleServerCallback>.Instance);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserConnected(user);

        h1.Verify(h => h.OnUserConnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object], NullLogger<MumbleServerCallback>.Instance);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserDisconnected(user);

        h1.Verify(h => h.OnUserDisconnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelCreated_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object], NullLogger<MumbleServerCallback>.Instance);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelCreated(channel);

        h1.Verify(h => h.OnChannelCreated(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRemoved_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object], NullLogger<MumbleServerCallback>.Instance);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelRemoved(channel);

        h1.Verify(h => h.OnChannelRemoved(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRenamed_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = new MumbleServerCallback([h1.Object], NullLogger<MumbleServerCallback>.Instance);
        var channel = new MumbleChannel(10, "Renamed");

        await callback.DispatchChannelRenamed(channel);

        h1.Verify(h => h.OnChannelRenamed(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchTextMessage_NoHandlers_DoesNotThrow()
    {
        var callback = new MumbleServerCallback([], NullLogger<MumbleServerCallback>.Instance);
        await callback.DispatchTextMessage(new MumbleUser("X", "x", 1), "hi", 1);
    }

    [TestMethod]
    public async Task SafeDispatch_HandlerThrows_CatchesAndLogsError()
    {
        var thrownException = new InvalidOperationException("handler failed");
        var handler = new Mock<IMumbleEventHandler>();
        handler.Setup(h => h.OnUserTextMessage(It.IsAny<MumbleUser>(), It.IsAny<string>(), It.IsAny<int>()))
            .ThrowsAsync(thrownException);

        var logger = new Mock<ILogger<MumbleServerCallback>>();
        var callback = new MumbleServerCallback([handler.Object], logger.Object);

        // userTextMessage dispatches via SafeDispatch — should not throw
        var iceUser = new MumbleServer.User(new byte[] { 127, 0, 0, 1 }) { name = "Alice", session = 1 };
        var iceMsg = new MumbleServer.TextMessage([], [42], [], "boom");

        callback.userTextMessage(iceUser, iceMsg, null!);

        // SafeDispatch runs via Task.Run, give it time to complete
        await Task.Delay(200);

        logger.Verify(
            l => l.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, _) => v.ToString()!.Contains("userTextMessage")),
                thrownException,
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }
}
