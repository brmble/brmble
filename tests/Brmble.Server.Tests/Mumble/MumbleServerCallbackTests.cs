using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;
using Brmble.Server.LiveKit;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleServerCallbackTests
{
    private static MumbleServerCallback CreateCallback(
        IEnumerable<IMumbleEventHandler> handlers,
        ISessionMappingService? mapping = null,
        IBrmbleEventBus? bus = null,
        IChannelMembershipService? channelMembership = null,
        ScreenShareTracker? screenShareTracker = null,
        ILiveKitParticipantRemover? liveKitParticipantRemover = null,
        IReadOnlyList<TimeSpan>? liveKitRevocationRetryDelays = null,
        LiveKitParticipantTracker? liveKitParticipantTracker = null,
        ILogger<MumbleServerCallback>? logger = null)
    {
        if (mapping is null)
        {
            var defaultMapping = new Mock<ISessionMappingService>();
            defaultMapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>());
            mapping = defaultMapping.Object;
        }

        ILiveKitParticipantRemover remover;
        if (liveKitParticipantRemover is not null)
        {
            remover = liveKitParticipantRemover;
        }
        else
        {
            var defaultRemover = new Mock<ILiveKitParticipantRemover>();
            defaultRemover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>())).ReturnsAsync(true);
            remover = defaultRemover.Object;
        }
        var revocationScheduler = new LiveKitParticipantRevocationScheduler(
            remover,
            NullLogger<LiveKitParticipantRevocationScheduler>.Instance,
            liveKitRevocationRetryDelays ?? []);

        return new MumbleServerCallback(
            handlers,
            mapping,
            bus ?? new Mock<IBrmbleEventBus>().Object,
            channelMembership ?? new Mock<IChannelMembershipService>().Object,
            screenShareTracker ?? new ScreenShareTracker(),
            revocationScheduler,
            liveKitParticipantTracker ?? new LiveKitParticipantTracker(),
            logger ?? NullLogger<MumbleServerCallback>.Instance);
    }

    [TestMethod]
    public async Task DispatchTextMessage_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var h2 = new Mock<IMumbleEventHandler>();
        var callback = CreateCallback([h1.Object, h2.Object]);
        var user = new MumbleUser("Alice", "abc", 1);

        await callback.DispatchTextMessage(user, "hello", 42);

        h1.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
        h2.Verify(h => h.OnUserTextMessage(user, "hello", 42), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserConnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = CreateCallback([h1.Object]);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserConnected(user);

        h1.Verify(h => h.OnUserConnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = CreateCallback([h1.Object]);
        var user = new MumbleUser("Bob", "xyz", 2);

        await callback.DispatchUserDisconnected(user);

        h1.Verify(h => h.OnUserDisconnected(user), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelCreated_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = CreateCallback([h1.Object]);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelCreated(channel);

        h1.Verify(h => h.OnChannelCreated(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRemoved_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = CreateCallback([h1.Object]);
        var channel = new MumbleChannel(10, "General");

        await callback.DispatchChannelRemoved(channel);

        h1.Verify(h => h.OnChannelRemoved(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchChannelRenamed_CallsAllHandlers()
    {
        var h1 = new Mock<IMumbleEventHandler>();
        var callback = CreateCallback([h1.Object]);
        var channel = new MumbleChannel(10, "Renamed");

        await callback.DispatchChannelRenamed(channel);

        h1.Verify(h => h.OnChannelRenamed(channel), Times.Once);
    }

    [TestMethod]
    public async Task DispatchTextMessage_NoHandlers_DoesNotThrow()
    {
        var callback = CreateCallback([]);
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
        var callback = CreateCallback([handler.Object], logger: logger.Object);

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

    // --- New tests for session mapping and event bus ---

    [TestMethod]
    public async Task DispatchUserConnected_SetsNameForSession()
    {
        var handler = new Mock<IMumbleEventHandler>();
        handler.Setup(h => h.OnUserConnected(It.IsAny<MumbleUser>())).Returns(Task.CompletedTask);
        var mapping = new Mock<ISessionMappingService>();
        var callback = CreateCallback([handler.Object], mapping: mapping.Object);

        await callback.DispatchUserConnected(new MumbleUser("Alice", "", 42));

        mapping.Verify(m => m.SetNameForSession("Alice", 42), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_RemovesSessionAndBroadcasts()
    {
        var handler = new Mock<IMumbleEventHandler>();
        handler.Setup(h => h.OnUserDisconnected(It.IsAny<MumbleUser>())).Returns(Task.CompletedTask);
        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>());
        var bus = new Mock<IBrmbleEventBus>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
        var callback = CreateCallback([handler.Object], mapping: mapping.Object, bus: bus.Object);

        await callback.DispatchUserDisconnected(new MumbleUser("Alice", "", 42));

        mapping.Verify(m => m.RemoveSession(42), Times.Once);
        bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserStateChanged_UpdatesChannelMembership()
    {
        var handler = new Mock<IMumbleEventHandler>();
        var channelMembership = new Mock<IChannelMembershipService>();
        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>());
        var callback = CreateCallback([handler.Object], mapping: mapping.Object, channelMembership: channelMembership.Object);

        await callback.DispatchUserStateChanged(new MumbleUser("Alice", "abc", 42), 5);

        channelMembership.Verify(cm => cm.Update(42, 5), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserConnected_WithInitialChannel_UpdatesChannelMembership()
    {
        var handler = new Mock<IMumbleEventHandler>();
        handler.Setup(h => h.OnUserConnected(It.IsAny<MumbleUser>())).Returns(Task.CompletedTask);
        var channelMembership = new Mock<IChannelMembershipService>();
        var callback = CreateCallback([handler.Object], channelMembership: channelMembership.Object);

        await callback.DispatchUserConnected(new MumbleUser("Alice", "abc", 42), initialChannelId: 5);

        channelMembership.Verify(cm => cm.Update(42, 5), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserStateChanged_StopsShareWhenUserChangesChannel()
    {
        var bus = new Mock<IBrmbleEventBus>();
        object? capturedMessage = null;
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>()))
            .Callback<object>(msg => capturedMessage = msg)
            .Returns(Task.CompletedTask);
        var channelMembership = new Mock<IChannelMembershipService>();
        var tracker = new ScreenShareTracker();
        tracker.Start("channel-5", "Alice", 100L);

        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 42, new SessionMapping("@100:x", "Alice", 100L, "bee") }
        });

        var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object,
            channelMembership: channelMembership.Object, screenShareTracker: tracker);

        // User moves from channel 5 to channel 10
        await callback.DispatchUserStateChanged(new MumbleUser("Alice", "abc", 42), 10);

        // Share in channel-5 should be stopped
        Assert.IsNull(tracker.GetActive("channel-5"));
        bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Once);
        Assert.IsNotNull(capturedMessage);
        var json = JsonSerializer.Serialize(capturedMessage);
        using var doc = JsonDocument.Parse(json);
        Assert.AreEqual("screenShare.stopped", doc.RootElement.GetProperty("type").GetString());
        Assert.AreEqual("channel-5", doc.RootElement.GetProperty("roomName").GetString());
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_StopsShareAndCleansUp()
    {
        var handler = new Mock<IMumbleEventHandler>();
        handler.Setup(h => h.OnUserDisconnected(It.IsAny<MumbleUser>())).Returns(Task.CompletedTask);
        var bus = new Mock<IBrmbleEventBus>();
        var capturedMessages = new List<object>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>()))
            .Callback<object>(msg => capturedMessages.Add(msg))
            .Returns(Task.CompletedTask);
        var channelMembership = new Mock<IChannelMembershipService>();
        var mapping = new Mock<ISessionMappingService>();
        var tracker = new ScreenShareTracker();
        tracker.Start("channel-5", "Alice", 100L);
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 42, new SessionMapping("@100:x", "Alice", 100L, "bee") }
        });

        var callback = CreateCallback([handler.Object], mapping: mapping.Object, bus: bus.Object,
            channelMembership: channelMembership.Object, screenShareTracker: tracker);

        await callback.DispatchUserDisconnected(new MumbleUser("Alice", "abc", 42));

        Assert.IsNull(tracker.GetActive("channel-5"));
        var stopMsg = capturedMessages
            .Select(m => JsonDocument.Parse(JsonSerializer.Serialize(m)))
            .FirstOrDefault(d => d.RootElement.GetProperty("type").GetString() == "screenShare.stopped");
        Assert.IsNotNull(stopMsg, "Expected a screenShare.stopped broadcast");
        Assert.AreEqual("channel-5", stopMsg.RootElement.GetProperty("roomName").GetString());
        channelMembership.Verify(cm => cm.Remove(42), Times.Once);
        mapping.Verify(m => m.RemoveSession(42), Times.Once);
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_RevokesViewerOnlyParticipantWithoutShareStopped()
    {
        var bus = new Mock<IBrmbleEventBus>();
        var capturedMessages = new List<object>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>()))
            .Callback<object>(msg => capturedMessages.Add(msg))
            .Returns(Task.CompletedTask);

        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 42, new SessionMapping("@alice:test", "Alice", 100L, "bee") }
        });

        var participantTracker = new LiveKitParticipantTracker();
        participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>())).ReturnsAsync(true);

        var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, liveKitParticipantRemover: remover.Object, liveKitParticipantTracker: participantTracker);

        await callback.DispatchUserDisconnected(new MumbleUser("Alice", "abc", 42));

        remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Once);
        Assert.AreEqual(0, participantTracker.GetSnapshot().Count);
        Assert.IsFalse(capturedMessages.Any(m => JsonSerializer.Serialize(m).Contains("screenShare.stopped")));
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_RetriesRevokedParticipantRemoval()
    {
        var bus = new Mock<IBrmbleEventBus>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);

        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 42, new SessionMapping("@alice:test", "Alice", 100L, "bee") }
        });

        var participantTracker = new LiveKitParticipantTracker();
        participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.SetupSequence(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync(false)
            .ReturnsAsync(true);

        var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, liveKitParticipantRemover: remover.Object, liveKitRevocationRetryDelays: [TimeSpan.Zero], liveKitParticipantTracker: participantTracker);

        await callback.DispatchUserDisconnected(new MumbleUser("Alice", "abc", 42));

        remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Exactly(2));
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_RevokesPublisherAndViewerRecords()
    {
        var bus = new Mock<IBrmbleEventBus>();
        var capturedMessages = new List<object>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>()))
            .Callback<object>(msg => capturedMessages.Add(msg))
            .Returns(Task.CompletedTask);
        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 42, new SessionMapping("@alice:test", "Alice", 100L, "bee") }
        });

        var tracker = new ScreenShareTracker();
        tracker.Start("channel-5", "Alice", 100L, "@alice:test");
        var participantTracker = new LiveKitParticipantTracker();
        participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Publish, DateTimeOffset.UtcNow.AddMinutes(5)));
        participantTracker.Upsert(new LiveKitParticipantRecord("channel-9", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>())).ReturnsAsync(true);
        var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, screenShareTracker: tracker, liveKitParticipantRemover: remover.Object, liveKitParticipantTracker: participantTracker);

        await callback.DispatchUserDisconnected(new MumbleUser("Alice", "abc", 42));

        remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Once);
        remover.Verify(r => r.RemoveParticipant("channel-9", "@alice:test"), Times.Once);
        Assert.IsNull(tracker.GetActive("channel-5"));
        Assert.AreEqual(0, participantTracker.GetSnapshot().Count);
        Assert.IsTrue(capturedMessages.Any(m => JsonSerializer.Serialize(m).Contains("screenShare.stopped")));
    }

    [TestMethod]
    public async Task DispatchUserDisconnected_RemovesAuthStateBeforeRevokingParticipants()
    {
        var order = new List<string>();
        var bus = new Mock<IBrmbleEventBus>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 42, new SessionMapping("@alice:test", "Alice", 100L, "bee") }
        });
        mapping.Setup(m => m.RemoveSession(42)).Callback(() => order.Add("remove-session"));
        var channelMembership = new Mock<IChannelMembershipService>();
        channelMembership.Setup(cm => cm.Remove(42)).Callback(() => order.Add("remove-channel"));
        var participantTracker = new LiveKitParticipantTracker();
        participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>()))
            .Callback(() => order.Add("remove-participant"))
            .ReturnsAsync(true);
        var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, channelMembership: channelMembership.Object, liveKitParticipantRemover: remover.Object, liveKitParticipantTracker: participantTracker);

        await callback.DispatchUserDisconnected(new MumbleUser("Alice", "abc", 42));

        CollectionAssert.AreEqual(new[] { "remove-session", "remove-channel", "remove-participant" }, order);
    }

    [TestMethod]
    public async Task DispatchUserStateChanged_RevokesOldRoomParticipantAndKeepsNewRoomParticipant()
    {
        var bus = new Mock<IBrmbleEventBus>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
        var channelMembership = new Mock<IChannelMembershipService>();
        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 42, new SessionMapping("@alice:test", "Alice", 100L, "bee") }
        });

        var screenShareTracker = new ScreenShareTracker();
        screenShareTracker.Start("channel-5", "Alice", 100L, "@alice:test");
        var participantTracker = new LiveKitParticipantTracker();
        participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Publish, DateTimeOffset.UtcNow.AddMinutes(5)));
        participantTracker.Upsert(new LiveKitParticipantRecord("channel-10", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>())).ReturnsAsync(true);
        var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, channelMembership: channelMembership.Object, screenShareTracker: screenShareTracker, liveKitParticipantRemover: remover.Object, liveKitParticipantTracker: participantTracker);

        await callback.DispatchUserStateChanged(new MumbleUser("Alice", "abc", 42), 10);

        remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Once);
        remover.Verify(r => r.RemoveParticipant("channel-10", "@alice:test"), Times.Never);
        Assert.IsNull(screenShareTracker.GetActive("channel-5"));
        Assert.AreEqual("channel-10", participantTracker.GetSnapshot().Single().RoomName);
    }
}
