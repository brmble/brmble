using Brmble.Server.Events;
using Brmble.Server.Games.Duels;
using Brmble.Server.WebSockets;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;
using System.Net.WebSockets;
using System.Text;

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
    public async Task SendQueueSnapshotAsync_SendsCanonicalSnapshotOnlyToProvidedSocket()
    {
        var provider = new Mock<IDuelSnapshotProvider>();
        provider.Setup(x => x.GetSnapshotForSessionAsync(7)).ReturnsAsync(new DuelQueueSnapshot(
            1, 1, 4, 3, DateTimeOffset.UtcNow, 0, null, null, []));
        var socket = new Mock<WebSocket>();
        string? payload = null;
        socket.Setup(x => x.SendAsync(It.IsAny<ArraySegment<byte>>(), WebSocketMessageType.Text, true,
                It.IsAny<CancellationToken>()))
            .Callback((ArraySegment<byte> bytes, WebSocketMessageType _, bool _, CancellationToken _) =>
                payload = Encoding.UTF8.GetString(bytes))
            .Returns(Task.CompletedTask);

        await BrmbleWebSocketHandler.SendQueueSnapshotAsync(socket.Object, provider.Object, 7, CancellationToken.None);

        StringAssert.Contains(payload, "\"type\":\"game.queueSnapshot\"");
        StringAssert.Contains(payload, "\"revision\":4");
        Assert.IsFalse(payload!.Contains("\"snapshot\""));
        provider.Verify(x => x.GetSnapshotForSessionAsync(7), Times.Once);
    }
}
