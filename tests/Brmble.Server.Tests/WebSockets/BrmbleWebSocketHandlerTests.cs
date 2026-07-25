using Brmble.Server.Events;
using Brmble.Server.Games.Duels;
using Brmble.Server.WebSockets;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Brmble.Server.Tests.WebSockets;

[TestClass]
public class BrmbleWebSocketHandlerTests
{
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
    public async Task InitializeClientAsync_SendsInitialSnapshotsBeforeRegistrationAndLaterBroadcast()
    {
        var provider = new Mock<IDuelSnapshotProvider>();
        var releaseSnapshot = new TaskCompletionSource<DuelQueueSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously);
        provider.Setup(x => x.GetSnapshotForSessionAsync(7)).Returns(releaseSnapshot.Task);
        var membership = new Mock<IChannelMembershipService>();
        var mappings = new Mock<ISessionMappingService>();
        var bus = new BrmbleEventBus(NullLogger<BrmbleEventBus>.Instance, membership.Object, mappings.Object);
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

        var initialization = BrmbleWebSocketHandler.InitializeClientAsync(
            socket.Object, bus, provider.Object, 42, 7,
            new Dictionary<int, SessionMapping>(), CancellationToken.None);
        await Task.Delay(50);

        await bus.BroadcastAsync(new { type = "duringConnect" });
        Assert.AreEqual(0, sends.Count);
        releaseSnapshot.SetResult(new DuelQueueSnapshot(
            1, 1, 4, 3, DateTimeOffset.UtcNow, 0, null, null, []));
        await initialization;
        await bus.BroadcastAsync(new { type = "afterConnect" });

        CollectionAssert.AreEqual(
            new[] { "sessionMappingSnapshot", "game.queueSnapshot", "duringConnect", "afterConnect" }, sends);
        Assert.IsFalse(concurrentSend);
    }

    [TestMethod]
    public async Task InitializeClientAsync_SnapshotFailureRemovesPausedClient()
    {
        var provider = new Mock<IDuelSnapshotProvider>();
        provider.Setup(x => x.GetSnapshotForSessionAsync(7)).ThrowsAsync(new InvalidOperationException("failed"));
        var bus = new BrmbleEventBus(
            NullLogger<BrmbleEventBus>.Instance,
            Mock.Of<IChannelMembershipService>(),
            Mock.Of<ISessionMappingService>());
        var socket = new Mock<WebSocket>();

        await Assert.ThrowsExceptionAsync<InvalidOperationException>(() =>
            BrmbleWebSocketHandler.InitializeClientAsync(
                socket.Object, bus, provider.Object, 42, 7, new Dictionary<int, SessionMapping>(),
                CancellationToken.None));

        Assert.IsFalse(bus.HasConnectedClient(42));
    }
}
