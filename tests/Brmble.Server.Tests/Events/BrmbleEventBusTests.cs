using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class BrmbleEventBusTests
{
    private BrmbleEventBus _bus = null!;
    private Mock<IChannelMembershipService> _channelMembership = null!;
    private Mock<ISessionMappingService> _sessionMapping = null!;

    [TestInitialize]
    public void Setup()
    {
        _channelMembership = new Mock<IChannelMembershipService>();
        _sessionMapping = new Mock<ISessionMappingService>();
        _bus = new BrmbleEventBus(
            NullLogger<BrmbleEventBus>.Instance,
            _channelMembership.Object,
            _sessionMapping.Object);
    }

    [TestMethod]
    public async Task BroadcastAsync_SendsToAllOpenClients()
    {
        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws1.Object, 1L);
        await _bus.AddClientAsync(ws2.Object, 2L);

        await _bus.BroadcastAsync(new { type = "test" });

        ws1.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
        ws2.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_RemovesClosedClients()
    {
        var dead = CreateMockWebSocket(WebSocketState.Closed);
        await _bus.AddClientAsync(dead.Object, 1L);

        await _bus.BroadcastAsync(new { type = "test" });

        dead.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task BroadcastAsync_RemovesClientOnSendError()
    {
        var failing = CreateMockWebSocket(WebSocketState.Open);
        failing.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .ThrowsAsync(new WebSocketException("connection reset"));
        await _bus.AddClientAsync(failing.Object, 1L);

        await _bus.BroadcastAsync(new { type = "first" });

        var healthy = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(healthy.Object, 2L);
        await _bus.BroadcastAsync(new { type = "second" });

        healthy.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_NoClientsDoesNotThrow()
    {
        await _bus.BroadcastAsync(new { type = "test" });
    }

    [TestMethod]
    public async Task RemoveClient_IsIdempotent()
    {
        var ws = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws.Object, 1L);
        _bus.RemoveClient(ws.Object);
        _bus.RemoveClient(ws.Object);
    }

    [TestMethod]
    public async Task HasConnectedClient_TracksRemainingClientsForUser()
    {
        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws1.Object, 1L);
        await _bus.AddClientAsync(ws2.Object, 1L);

        _bus.RemoveClient(ws1.Object);

        Assert.IsTrue(_bus.HasConnectedClient(1L));

        _bus.RemoveClient(ws2.Object);

        Assert.IsFalse(_bus.HasConnectedClient(1L));
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_SendsOnlyToUsersInChannel()
    {
        // Set up channel membership: channel 5 has sessions 10 and 20
        _channelMembership.Setup(c => c.GetSessionsInChannel(5))
            .Returns(new List<int> { 10, 20 });

        // Set up session mapping: session 10 -> userId 1, session 20 -> userId 2
        _sessionMapping.Setup(s => s.GetSnapshot())
            .Returns(new Dictionary<int, SessionMapping>
            {
                { 10, new SessionMapping("@user1:matrix.org", "User1", 1L, "bee") },
                { 20, new SessionMapping("@user2:matrix.org", "User2", 2L, "bee") }
            });

        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        var ws3 = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws1.Object, 1L);
        await _bus.AddClientAsync(ws2.Object, 2L);
        await _bus.AddClientAsync(ws3.Object, 3L); // Not in channel

        await _bus.BroadcastToChannelAsync(5, new { type = "channelEvent" });

        // WS1 and WS2 should receive the message
        ws1.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
        ws2.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);

        // WS3 should NOT receive the message
        ws3.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_EmptyChannel_SendsToNobody()
    {
        // Set up empty channel
        _channelMembership.Setup(c => c.GetSessionsInChannel(99))
            .Returns(new List<int>());

        _sessionMapping.Setup(s => s.GetSnapshot())
            .Returns(new Dictionary<int, SessionMapping>());

        var ws = CreateMockWebSocket(WebSocketState.Open);
        await _bus.AddClientAsync(ws.Object, 1L);

        await _bus.BroadcastToChannelAsync(99, new { type = "channelEvent" });

        // WS should NOT receive anything
        ws.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task BroadcastAsync_DoesNotOverlapSendsOnTheSameSocket()
    {
        // WebSocket.SendAsync is not thread-safe: a second concurrent call on the same
        // socket throws "There is already one outstanding 'SendAsync' call". Independent
        // broadcasts (e.g. screen share and session mapping) must not collide.
        var tracker = new ConcurrencyTracker();
        var ws = CreateMockWebSocket(WebSocketState.Open);
        ws.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(() => tracker.RecordSendAsync());
        await _bus.AddClientAsync(ws.Object, 1L);

        var first = _bus.BroadcastAsync(new { type = "screenShare.stopped" });
        var second = _bus.BroadcastAsync(new { type = "userMappingAdded" });
        await Task.WhenAll(first, second);

        Assert.AreEqual(1, tracker.MaxConcurrent, "Sends to a single socket must be serialized.");
        Assert.AreEqual(2, tracker.TotalSends);
    }

    [TestMethod]
    public async Task RemoveClient_CompletesQueuedBroadcastsWithoutWaitingForTheSocket()
    {
        // Serializing sends means a stalled socket can hold a queue behind it. When the
        // client goes away, everything still queued must be released instead of waiting
        // on a socket that will never drain.
        var release = new TaskCompletionSource();
        var firstSendStarted = new TaskCompletionSource();
        var sendCount = 0;
        var ws = CreateMockWebSocket(WebSocketState.Open);
        ws.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                if (Interlocked.Increment(ref sendCount) == 1)
                {
                    firstSendStarted.TrySetResult();
                    return release.Task;
                }

                return Task.CompletedTask;
            });
        await _bus.AddClientAsync(ws.Object, 1L);

        var blocked = _bus.BroadcastAsync(new { type = "first" });
        await firstSendStarted.Task;
        var queued = _bus.BroadcastAsync(new { type = "second" });

        _bus.RemoveClient(ws.Object);

        await queued.WaitAsync(TimeSpan.FromSeconds(2));

        release.TrySetResult();
        await blocked.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.AreEqual(1, Volatile.Read(ref sendCount), "A removed client must not receive queued payloads.");
    }

    [TestMethod]
    public async Task AddClientAsync_QueuesSnapshotBeforePublishingClient()
    {
        // Registering the client and then sending the snapshot as two separate steps lets a
        // broadcast slip in between, so the client can observe a mutation before the snapshot
        // it amends. The snapshot must be queued before the client is visible to broadcasts.
        var recorded = new List<string>();
        var ws = CreateRecordingWebSocket(recorded);
        var connectedDuringFactory = true;

        await _bus.AddClientAsync(ws.Object, 1L, () =>
        {
            connectedDuringFactory = _bus.HasConnectedClient(1L);
            return new { type = "sessionMappingSnapshot" };
        });
        await _bus.BroadcastAsync(new { type = "userMappingAdded" });

        Assert.IsFalse(connectedDuringFactory, "Client must not be broadcast-visible before its snapshot is queued.");
        CollectionAssert.AreEqual(
            new[] { "sessionMappingSnapshot", "userMappingAdded" },
            recorded,
            "The snapshot must be the first payload the client receives.");
    }

    private static Mock<WebSocket> CreateRecordingWebSocket(List<string> recorded)
    {
        var mock = new Mock<WebSocket>();
        mock.Setup(w => w.State).Returns(WebSocketState.Open);
        mock.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns((ArraySegment<byte> buffer, WebSocketMessageType _, bool _, CancellationToken _) =>
            {
                var type = JsonDocument.Parse(Encoding.UTF8.GetString(buffer))
                    .RootElement.GetProperty("type").GetString()!;
                lock (recorded)
                {
                    recorded.Add(type);
                }

                return Task.CompletedTask;
            });
        return mock;
    }

    private sealed class ConcurrencyTracker
    {
        private readonly object _gate = new();
        private int _current;

        public int MaxConcurrent { get; private set; }
        public int TotalSends { get; private set; }

        public async Task RecordSendAsync()
        {
            lock (_gate)
            {
                _current++;
                TotalSends++;
                if (_current > MaxConcurrent)
                    MaxConcurrent = _current;
            }

            await Task.Delay(25);

            lock (_gate)
            {
                _current--;
            }
        }
    }

    private static Mock<WebSocket> CreateMockWebSocket(WebSocketState state)
    {
        var mock = new Mock<WebSocket>();
        mock.Setup(w => w.State).Returns(state);
        mock.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        return mock;
    }
}
