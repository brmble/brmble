using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;
using Brmble.Server.Paint;
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
        _bus.AddClient(ws1.Object, 1L);
        _bus.AddClient(ws2.Object, 2L);

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
        _bus.AddClient(dead.Object, 1L);

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
        _bus.AddClient(failing.Object, 1L);

        await _bus.BroadcastAsync(new { type = "first" });

        var healthy = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(healthy.Object, 2L);
        await _bus.BroadcastAsync(new { type = "second" });

        healthy.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_SendFailureCompletesQueuedBroadcasts()
    {
        var firstSendStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var failFirstSend = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var failing = CreateMockWebSocket(WebSocketState.Open);
        failing.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()))
            .Returns(async () =>
            {
                firstSendStarted.SetResult();
                await failFirstSend.Task;
                throw new WebSocketException("connection reset");
            });
        _bus.AddClient(failing.Object, 1L);

        var first = _bus.BroadcastAsync(new { type = "first" });
        await firstSendStarted.Task;
        var queuedOne = _bus.BroadcastAsync(new { type = "queued-one" });
        var queuedTwo = _bus.BroadcastAsync(new { type = "queued-two" });

        failFirstSend.SetResult();
        var broadcasts = Task.WhenAll(first, queuedOne, queuedTwo);
        var completed = await Task.WhenAny(broadcasts, Task.Delay(TimeSpan.FromSeconds(1)));

        Assert.AreSame(broadcasts, completed, "Queued broadcasts must not wait indefinitely after a socket send failure.");
        await broadcasts;
        failing.Verify(w => w.Abort(), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_PermanentPaintSendError_AbortsAndRemovesClient()
    {
        _channelMembership.Setup(c => c.GetSessionsInChannel(5)).Returns(new List<int> { 10 });
        _sessionMapping.Setup(s => s.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 10, new SessionMapping("@user:test", "User", 1L, "bee") },
        });

        var failing = CreateMockWebSocket(WebSocketState.Open);
        failing.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(), It.IsAny<WebSocketMessageType>(), true,
            It.IsAny<CancellationToken>()))
            .ThrowsAsync(new WebSocketException("connection reset"));
        _bus.AddClient(failing.Object, 1L);

        await _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.StrokeCommitted });

        failing.Verify(w => w.Abort(), Times.Once);
        Assert.IsFalse(_bus.HasConnectedClient(1L));
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_PreviewWaitsForPermanentPaintSendOnSameSocket()
    {
        _channelMembership.Setup(c => c.GetSessionsInChannel(5)).Returns(new List<int> { 10 });
        _sessionMapping.Setup(s => s.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            { 10, new SessionMapping("@user:test", "User", 1L, "bee") },
        });
        var releaseFirstSend = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sendsInProgress = 0;
        var concurrentSend = false;
        var socket = CreateMockWebSocket(WebSocketState.Open);
        socket.Setup(w => w.SendAsync(It.IsAny<ArraySegment<byte>>(), WebSocketMessageType.Text, true, It.IsAny<CancellationToken>()))
            .Returns(async () =>
            {
                if (Interlocked.Increment(ref sendsInProgress) > 1) concurrentSend = true;
                try { await releaseFirstSend.Task; }
                finally { Interlocked.Decrement(ref sendsInProgress); }
            });
        _bus.AddClient(socket.Object, 1L);

        var permanent = _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.StrokeCommitted });
        await Task.Yield();
        var preview = _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.PreviewUpdated });
        await Task.Yield();
        releaseFirstSend.SetResult();
        await Task.WhenAll(permanent, preview);

        Assert.IsFalse(concurrentSend);
    }

    [TestMethod]
    public async Task AddClientWithInitialMessageAsync_SerializesBroadcastsAfterInitialMessage()
    {
        var blocked = CreateBlockingSocket();

        var initial = _bus.AddClientWithInitialMessageAsync(blocked.Socket.Object, 1L, () => new { type = "sessionMappingSnapshot" });
        await blocked.FirstSendStarted.Task;
        var broadcast = _bus.BroadcastAsync(new { type = "delta" });

        blocked.ReleaseFirstSend.SetResult();
        await Task.WhenAll(initial, broadcast);

        Assert.AreEqual(2, blocked.Payloads.Count);
        using var first = JsonDocument.Parse(blocked.Payloads[0]);
        using var second = JsonDocument.Parse(blocked.Payloads[1]);
        Assert.AreEqual("sessionMappingSnapshot", first.RootElement.GetProperty("type").GetString());
        Assert.AreEqual("delta", second.RootElement.GetProperty("type").GetString());
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_CoalescesQueuedPreviewsBySessionAndAuthor()
    {
        RouteChannelFiveToUserOne();
        var blocked = CreateBlockingSocket();
        _bus.AddClient(blocked.Socket.Object, 1L);
        var sessionId = Guid.Parse("11111111-1111-1111-1111-111111111111");

        var permanent = _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.StrokeCommitted });
        await blocked.FirstSendStarted.Task;
        var previewOne = _bus.BroadcastToChannelAsync(5, new
        {
            type = PaintEventNames.PreviewUpdated,
            sessionId,
            authorUserId = 7L,
            input = new { sequence = 1 },
        });
        var previewTwo = _bus.BroadcastToChannelAsync(5, new
        {
            type = PaintEventNames.PreviewUpdated,
            sessionId,
            authorUserId = 7L,
            input = new { sequence = 2 },
        });

        blocked.ReleaseFirstSend.SetResult();
        await Task.WhenAll(permanent, previewOne, previewTwo);

        Assert.AreEqual(2, blocked.Payloads.Count);
        using var preview = JsonDocument.Parse(blocked.Payloads.Single(payload =>
            JsonDocument.Parse(payload).RootElement.GetProperty("type").GetString() == PaintEventNames.PreviewUpdated));
        Assert.AreEqual(2, preview.RootElement.GetProperty("input").GetProperty("sequence").GetInt32());
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_PreviewCapacityPreservesSessionEnded()
    {
        RouteChannelFiveToUserOne();
        var blocked = CreateBlockingSocket();
        _bus.AddClient(blocked.Socket.Object, 1L);

        var permanent = _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.StrokeCommitted });
        await blocked.FirstSendStarted.Task;
        var previews = Enumerable.Range(1, 64).Select(sequence => _bus.BroadcastToChannelAsync(5, new
        {
            type = PaintEventNames.PreviewUpdated,
            sessionId = Guid.NewGuid(),
            authorUserId = (long)sequence,
            input = new { sequence },
        })).ToArray();
        var ended = _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.SessionEnded });

        blocked.ReleaseFirstSend.SetResult();
        await Task.WhenAll(previews.Append(permanent).Append(ended));

        Assert.IsTrue(blocked.Payloads.Any(payload =>
            JsonDocument.Parse(payload).RootElement.GetProperty("type").GetString() == PaintEventNames.SessionEnded));
        Assert.AreEqual(65, blocked.Payloads.Count);
    }

    [TestMethod]
    public async Task BroadcastToChannelAsync_PermanentCapacityAbortsSocket()
    {
        RouteChannelFiveToUserOne();
        var blocked = CreateBlockingSocket();
        _bus.AddClient(blocked.Socket.Object, 1L);

        var permanent = _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.StrokeCommitted });
        await blocked.FirstSendStarted.Task;
        var queued = Enumerable.Range(1, 64).Select(sequence => _bus.BroadcastToChannelAsync(5, new
        {
            type = PaintEventNames.StrokeCommitted,
            sequence,
        })).ToArray();
        var cleared = _bus.BroadcastToChannelAsync(5, new { type = PaintEventNames.CanvasCleared });

        blocked.ReleaseFirstSend.SetResult();
        await permanent;
        var queuedBroadcasts = Task.WhenAll(queued);
        var completed = await Task.WhenAny(queuedBroadcasts, Task.Delay(TimeSpan.FromSeconds(1)));

        Assert.AreSame(queuedBroadcasts, completed, "Queued permanent broadcasts must settle when the socket queue aborts.");
        await Assert.ThrowsExceptionAsync<WebSocketException>(() => queuedBroadcasts);
        await Assert.ThrowsExceptionAsync<WebSocketException>(() => cleared);

        blocked.Socket.Verify(socket => socket.Abort(), Times.Once);
        Assert.IsFalse(_bus.HasConnectedClient(1L));
    }

    [TestMethod]
    public async Task BroadcastAsync_FullPermanentQueueStopsDrainAndCompletesQueuedBroadcasts()
    {
        var blocked = CreateBlockingSocket();
        _bus.AddClient(blocked.Socket.Object, 1L);

        var inFlight = _bus.BroadcastAsync(new { type = "in-flight" });
        await blocked.FirstSendStarted.Task;
        var queued = Enumerable.Range(1, 64)
            .Select(sequence => _bus.BroadcastAsync(new { type = "queued", sequence }))
            .ToArray();

        var overflow = _bus.BroadcastAsync(new { type = "overflow" });
        await Assert.ThrowsExceptionAsync<WebSocketException>(() => overflow);

        blocked.ReleaseFirstSend.SetResult();
        var queuedBroadcasts = Task.WhenAll(queued.Append(inFlight));
        var completed = await Task.WhenAny(queuedBroadcasts, Task.Delay(TimeSpan.FromSeconds(1)));

        Assert.AreSame(queuedBroadcasts, completed, "Queued broadcasts must not wait indefinitely after a full-queue abort.");
        await Assert.ThrowsExceptionAsync<WebSocketException>(() => queuedBroadcasts);
        blocked.Socket.Verify(socket => socket.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task RemoveClient_CompletesQueuedBroadcastsAndStopsDrain()
    {
        var blocked = CreateBlockingSocket();
        _bus.AddClient(blocked.Socket.Object, 1L);

        var inFlight = _bus.BroadcastAsync(new { type = "in-flight" });
        await blocked.FirstSendStarted.Task;
        var queuedOne = _bus.BroadcastAsync(new { type = "queued-one" });
        var queuedTwo = _bus.BroadcastAsync(new { type = "queued-two" });

        _bus.RemoveClient(blocked.Socket.Object);
        blocked.ReleaseFirstSend.SetResult();
        var broadcasts = Task.WhenAll(inFlight, queuedOne, queuedTwo);
        var completed = await Task.WhenAny(broadcasts, Task.Delay(TimeSpan.FromSeconds(1)));

        Assert.AreSame(broadcasts, completed, "Queued broadcasts must settle when a client is removed.");
        await broadcasts;
        blocked.Socket.Verify(socket => socket.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_NoClientsDoesNotThrow()
    {
        await _bus.BroadcastAsync(new { type = "test" });
    }

    [TestMethod]
    public void RemoveClient_IsIdempotent()
    {
        var ws = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(ws.Object, 1L);
        _bus.RemoveClient(ws.Object);
        _bus.RemoveClient(ws.Object);
    }

    [TestMethod]
    public void HasConnectedClient_TracksRemainingClientsForUser()
    {
        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(ws1.Object, 1L);
        _bus.AddClient(ws2.Object, 1L);

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
        _bus.AddClient(ws1.Object, 1L);
        _bus.AddClient(ws2.Object, 2L);
        _bus.AddClient(ws3.Object, 3L); // Not in channel

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
        _bus.AddClient(ws.Object, 1L);

        await _bus.BroadcastToChannelAsync(99, new { type = "channelEvent" });

        // WS should NOT receive anything
        ws.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
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

    private void RouteChannelFiveToUserOne()
    {
        _channelMembership.Setup(x => x.GetSessionsInChannel(5)).Returns([10]);
        _sessionMapping.Setup(x => x.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
        {
            [10] = new("@user:test", "User", 1L, "bee"),
        });
    }

    private static BlockingSocket CreateBlockingSocket()
    {
        var socket = CreateMockWebSocket(WebSocketState.Open);
        var firstSendStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirstSend = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var payloads = new List<string>();
        var sendCount = 0;

        socket.Setup(webSocket => webSocket.SendAsync(
                It.IsAny<ArraySegment<byte>>(),
                WebSocketMessageType.Text,
                true,
                It.IsAny<CancellationToken>()))
            .Returns(async (ArraySegment<byte> bytes, WebSocketMessageType _, bool _, CancellationToken _) =>
            {
                if (Interlocked.Increment(ref sendCount) == 1)
                {
                    firstSendStarted.SetResult();
                    await releaseFirstSend.Task;
                }

                lock (payloads)
                    payloads.Add(Encoding.UTF8.GetString(bytes));
            });

        return new BlockingSocket(socket, firstSendStarted, releaseFirstSend, payloads);
    }

    private sealed record BlockingSocket(
        Mock<WebSocket> Socket,
        TaskCompletionSource FirstSendStarted,
        TaskCompletionSource ReleaseFirstSend,
        List<string> Payloads);
}
