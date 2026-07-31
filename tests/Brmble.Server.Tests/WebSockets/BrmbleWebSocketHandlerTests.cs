using Brmble.Server.Events;
using Brmble.Server.Auth;
using Brmble.Server.Games.Duels;
using Brmble.Server.WebSockets;
using Brmble.Server.Companions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Brmble.Server.Tests.WebSockets;

[TestClass]
public class BrmbleWebSocketHandlerTests
{
    private sealed class BlockingMappingBroadcastBus(BrmbleEventBus inner) : IBrmbleEventBus
    {
        public TaskCompletionSource MappingBroadcastEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ReleaseMappingBroadcast { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task AddClientAsync(WebSocket ws, long userId, Func<Task<IReadOnlyList<object>>>? initialMessages = null) =>
            inner.AddClientAsync(ws, userId, initialMessages);
        public void RemoveClient(WebSocket ws) => inner.RemoveClient(ws);
        public bool HasConnectedClient(long userId) => inner.HasConnectedClient(userId);
        public Task BroadcastAsync(object message) => inner.BroadcastAsync(message);
        public async Task BroadcastExceptAsync(WebSocket excluded, object message)
        {
            MappingBroadcastEntered.TrySetResult();
            await ReleaseMappingBroadcast.Task;
            await inner.BroadcastExceptAsync(excluded, message);
        }
        public Task BroadcastToChannelAsync(int channelId, object message) => inner.BroadcastToChannelAsync(channelId, message);
        public Task<IReadOnlySet<long>> GetConnectedUserIdsAsync() => inner.GetConnectedUserIdsAsync();
        public Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message, EventDeliveryOptions options = default) =>
            inner.BroadcastToUsersAsync(userIds, message, options);
    }

    private static BrmbleEventBus CreateBus(ISessionMappingService? mappings = null) => new(
        NullLogger<BrmbleEventBus>.Instance,
        Mock.Of<IChannelMembershipService>(),
        mappings ?? Mock.Of<ISessionMappingService>(),
        Options.Create(new EventBusSettings()));

    [TestMethod]
    public void CreateUserMappingAddedPayload_UsesAuthoritativeCertHash()
    {
        var mapping = new SessionMapping(
            MatrixUserId: "@alice:test.local",
            MumbleName: "Alice",
            UserId: 42,
            CompanionId: "floppy",
            CertHash: null,
            IsBrmbleClient: false);

        var payload = BrmbleWebSocketHandler.CreateUserMappingAddedPayload(7, mapping, "fresh-hash");

        Assert.AreEqual("fresh-hash", payload.GetType().GetProperty("certHash")!.GetValue(payload));
    }

    [TestMethod]
    public void WireSelection_CustomValueKeepsLegacyFieldSafe()
    {
        var wire = CompanionWireSelection.FromPersisted("custom:$sprite:test");

        Assert.AreEqual("floppy", wire.CompanionId);
        Assert.AreEqual("custom:$sprite:test", wire.CustomCompanionId);
    }

    [TestMethod]
    public void CreateUserMappingAddedPayload_CustomCompanionUsesDualWireFields()
    {
        var mapping = new SessionMapping("@alice:test", "Alice", 42, "custom:$sprite:test");

        var payload = BrmbleWebSocketHandler.CreateUserMappingAddedPayload(7, mapping, "fresh-hash");

        Assert.AreEqual("floppy", payload.GetType().GetProperty("companionId")!.GetValue(payload));
        Assert.AreEqual("custom:$sprite:test", payload.GetType().GetProperty("customCompanionId")!.GetValue(payload));
    }

    [TestMethod]
    public void CreateUserMappingAddedPayload_BuiltInKeepsLegacyFieldAndEmptyCustomField()
    {
        var mapping = new SessionMapping("@alice:test", "Alice", 42, "floppy");

        var payload = BrmbleWebSocketHandler.CreateUserMappingAddedPayload(7, mapping, "fresh-hash");

        Assert.AreEqual("floppy", payload.GetType().GetProperty("companionId")!.GetValue(payload));
        Assert.IsNull(payload.GetType().GetProperty("customCompanionId")!.GetValue(payload));
    }

    [TestMethod]
    public async Task InitializeAcceptedClientAsync_FlushesEventsRacingTheInitialSnapshots()
    {
        var provider = new Mock<IDuelSnapshotProvider>();
        var releaseSnapshot = new TaskCompletionSource<DuelQueueSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
        provider.Setup(x => x.GetSnapshotForSessionAsync(7)).Returns(releaseSnapshot.Task);
        var mappings = new Mock<ISessionMappingService>();
        mappings.Setup(x => x.TryGetSessionByUserId(42, out It.Ref<int>.IsAny))
            .Returns((long _, out int sessionId) => { sessionId = 7; return true; });
        mappings.Setup(x => x.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>());
        var bus = CreateBus(mappings.Object);
        var sends = new List<string>();
        var activeSends = 0;
        var concurrentSend = false;
        var socket = new Mock<WebSocket>();
        socket.Setup(x => x.State).Returns(WebSocketState.Open);
        socket.Setup(x => x.SendAsync(It.IsAny<ArraySegment<byte>>(), WebSocketMessageType.Text, true,
                It.IsAny<CancellationToken>()))
            .Callback((ArraySegment<byte> bytes, WebSocketMessageType _, bool _, CancellationToken _) =>
            {
                if (Interlocked.Increment(ref activeSends) > 1) concurrentSend = true;
                lock (sends) sends.Add(JsonDocument.Parse(bytes).RootElement.GetProperty("type").GetString()!);
                Interlocked.Decrement(ref activeSends);
            })
            .Returns(Task.CompletedTask);

        var initialization = BrmbleWebSocketHandler.InitializeAcceptedClientAsync(
            socket.Object, 42, "cert", mappings.Object, bus,
            Mock.Of<IActiveBrmbleSessions>(), provider.Object);
        await Task.Delay(50);

        // Queues behind the bootstrap; it only completes once the drain reaches it.
        var racing = bus.BroadcastAsync(new { type = "duringConnect" });
        Assert.AreEqual(0, sends.Count);
        releaseSnapshot.SetResult(new DuelQueueSnapshot(
            1, 1, 4, 3, DateTimeOffset.UtcNow, 0, null, null, []));
        await initialization;
        await racing;
        await bus.BroadcastAsync(new { type = "afterConnect" });

        CollectionAssert.AreEqual(
            new[] { "sessionMappingSnapshot", "game.queueSnapshot", "duringConnect", "afterConnect" }, sends);
        Assert.IsFalse(concurrentSend);
    }

    [TestMethod]
    public async Task InitializeAcceptedClientAsync_SnapshotFailureUnregistersTheClient()
    {
        var provider = new Mock<IDuelSnapshotProvider>();
        provider.Setup(x => x.GetSnapshotForSessionAsync(7)).ThrowsAsync(new InvalidOperationException("failed"));
        var mappings = new Mock<ISessionMappingService>();
        mappings.Setup(x => x.TryGetSessionByUserId(42, out It.Ref<int>.IsAny))
            .Returns((long _, out int sessionId) => { sessionId = 7; return true; });
        mappings.Setup(x => x.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>());
        var bus = CreateBus(mappings.Object);
        var socket = new Mock<WebSocket>();

        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() =>
            BrmbleWebSocketHandler.InitializeAcceptedClientAsync(
                socket.Object, 42, "cert", mappings.Object, bus,
                Mock.Of<IActiveBrmbleSessions>(), provider.Object));

        Assert.IsFalse(bus.HasConnectedClient(42));
    }

    [TestMethod]
    public async Task InitializeAcceptedClientAsync_RegistersBeforeMappingBroadcastAndOrdersPrivateEventAfterBootstrap()
    {
        var mapping = new SessionMapping("@alice:test", "Alice", 42, "bee");
        var mappings = new Mock<ISessionMappingService>();
        mappings.Setup(x => x.TryGetMappingByUserId(42, out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
            .Returns((long _, out int sessionId, out SessionMapping? value) =>
            {
                sessionId = 7;
                value = mapping;
                return true;
            });
        mappings.Setup(x => x.TryGetSessionByUserId(42, out It.Ref<int>.IsAny))
            .Returns((long _, out int sessionId) => { sessionId = 7; return true; });
        mappings.Setup(x => x.GetSnapshot()).Returns(new Dictionary<int, SessionMapping> { [7] = mapping });
        var realBus = CreateBus(mappings.Object);
        var bus = new BlockingMappingBroadcastBus(realBus);
        var snapshots = new Mock<IDuelSnapshotProvider>();
        snapshots.Setup(x => x.GetSnapshotForSessionAsync(7)).ReturnsAsync(new DuelQueueSnapshot(
            1, 1, 4, 3, DateTimeOffset.UtcNow, 0, null, null, []));
        var activeSessions = new Mock<IActiveBrmbleSessions>();
        var sends = new List<string>();
        var activeSends = 0;
        var maxConcurrentSends = 0;
        var socket = new Mock<WebSocket>();
        socket.Setup(x => x.State).Returns(WebSocketState.Open);
        socket.Setup(x => x.SendAsync(It.IsAny<ArraySegment<byte>>(), WebSocketMessageType.Text, true,
                It.IsAny<CancellationToken>()))
            .Callback((ArraySegment<byte> bytes, WebSocketMessageType _, bool _, CancellationToken _) =>
            {
                maxConcurrentSends = Math.Max(maxConcurrentSends, Interlocked.Increment(ref activeSends));
                lock (sends) sends.Add(JsonDocument.Parse(bytes).RootElement.GetProperty("type").GetString()!);
                Interlocked.Decrement(ref activeSends);
            })
            .Returns(Task.CompletedTask);

        var accepted = BrmbleWebSocketHandler.InitializeAcceptedClientAsync(
            socket.Object, 42, "cert", mappings.Object, bus, activeSessions.Object, snapshots.Object);
        await bus.MappingBroadcastEntered.Task;
        // The socket is already registered, so this queues behind the bootstrap rather than
        // being dropped. It cannot be awaited yet: it only completes once the drain reaches it.
        var privateEvent = realBus.BroadcastToUsersAsync(new HashSet<long> { 42 }, new { type = "privateEvent" });
        Assert.AreEqual(0, sends.Count);

        bus.ReleaseMappingBroadcast.TrySetResult();
        await accepted;
        await privateEvent;

        CollectionAssert.AreEqual(
            new[] { "sessionMappingSnapshot", "game.queueSnapshot", "privateEvent" }, sends);
        Assert.AreEqual(1, maxConcurrentSends);
        Assert.AreEqual(1, sends.Count(x => x == "sessionMappingSnapshot"));
    }
}
