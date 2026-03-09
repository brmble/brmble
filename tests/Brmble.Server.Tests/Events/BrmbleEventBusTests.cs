using System.Net.WebSockets;
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
    public async Task BroadcastToChannelAsync_SendsOnlyToUsersInChannel()
    {
        // Set up channel membership: channel 5 has sessions 10 and 20
        _channelMembership.Setup(c => c.GetSessionsInChannel(5))
            .Returns(new List<int> { 10, 20 });

        // Set up session mapping: session 10 -> userId 1, session 20 -> userId 2
        _sessionMapping.Setup(s => s.GetSnapshot())
            .Returns(new Dictionary<int, SessionMapping>
            {
                { 10, new SessionMapping("@user1:matrix.org", "User1", 1L) },
                { 20, new SessionMapping("@user2:matrix.org", "User2", 2L) }
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
}
