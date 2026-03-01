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

    [TestInitialize]
    public void Setup() => _bus = new BrmbleEventBus(NullLogger<BrmbleEventBus>.Instance);

    [TestMethod]
    public async Task BroadcastAsync_SendsToAllOpenClients()
    {
        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(ws1.Object);
        _bus.AddClient(ws2.Object);

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
        _bus.AddClient(dead.Object);

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
        _bus.AddClient(failing.Object);

        await _bus.BroadcastAsync(new { type = "first" });

        var healthy = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(healthy.Object);
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
        _bus.AddClient(ws.Object);
        _bus.RemoveClient(ws.Object);
        _bus.RemoveClient(ws.Object);
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
