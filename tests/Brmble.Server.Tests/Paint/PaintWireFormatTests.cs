using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;
using Brmble.Server.Paint;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Paint;

/// <summary>
/// Pins the JSON shape paint events have on the wire, serialized by the real event bus.
/// The frontend's types in src/types/paint.ts are the contract: tool and status are
/// camelCase strings, width is a number. Asserting through the bus rather than a local
/// serializer is deliberate, since the defect these guard against is the bus serializing
/// paint's enums differently from how paint's own tests serialize them.
/// </summary>
[TestClass]
public sealed class PaintWireFormatTests
{
    [TestMethod]
    public async Task StrokeCommitted_SerializesToolAsCamelCaseStringAndWidthAsNumber()
    {
        var stroke = new PaintStroke(
            Guid.Parse("11111111-1111-1111-1111-111111111111"),
            Guid.Parse("22222222-2222-2222-2222-222222222222"),
            7,
            "@alice:test",
            1,
            0,
            PaintTool.Pen,
            "#111827",
            PaintStrokeWidth.Thin,
            [new PaintPoint(0.1, 0.2, null)],
            true);

        using var json = await BroadcastAndCaptureAsync(new
        {
            type = PaintEventNames.StrokeCommitted,
            sessionId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            stroke,
            revision = 1L,
            generation = 0L,
        });

        var serialized = json.RootElement.GetProperty("stroke");
        Assert.AreEqual(JsonValueKind.String, serialized.GetProperty("tool").ValueKind);
        Assert.AreEqual("pen", serialized.GetProperty("tool").GetString());
        Assert.AreEqual(JsonValueKind.Number, serialized.GetProperty("width").ValueKind);
        Assert.AreEqual(3, serialized.GetProperty("width").GetInt32());
    }

    [TestMethod]
    public async Task PreviewUpdated_SerializesEraserAndWideWidth()
    {
        var input = new PaintStrokeInput(
            Guid.Parse("22222222-2222-2222-2222-222222222222"),
            0,
            PaintTool.Eraser,
            null,
            PaintStrokeWidth.Wide,
            [new PaintPoint(0.1, 0.2, null)]);

        using var json = await BroadcastAndCaptureAsync(new
        {
            type = PaintEventNames.PreviewUpdated,
            sessionId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            generation = 0L,
            authorUserId = 7L,
            input,
        });

        var serialized = json.RootElement.GetProperty("input");
        Assert.AreEqual("eraser", serialized.GetProperty("tool").GetString());
        Assert.AreEqual(JsonValueKind.Number, serialized.GetProperty("width").ValueKind);
        Assert.AreEqual(12, serialized.GetProperty("width").GetInt32());
    }

    [TestMethod]
    public async Task SessionEnded_SerializesStatusAsCamelCaseString()
    {
        using var json = await BroadcastAndCaptureAsync(new
        {
            type = PaintEventNames.SessionEnded,
            sessionId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            status = PaintSessionStatus.Ended,
        });

        Assert.AreEqual(JsonValueKind.String, json.RootElement.GetProperty("status").ValueKind);
        Assert.AreEqual("ended", json.RootElement.GetProperty("status").GetString());
    }

    [TestMethod]
    public async Task PendingSourceStatus_SerializesAsCamelCaseNotPascalCase()
    {
        using var json = await BroadcastAndCaptureAsync(new
        {
            type = PaintEventNames.SessionUnavailable,
            status = PaintSessionStatus.PendingSource,
        });

        Assert.AreEqual("pendingSource", json.RootElement.GetProperty("status").GetString());
    }

    private static async Task<JsonDocument> BroadcastAndCaptureAsync(object message)
    {
        var bus = new BrmbleEventBus(
            NullLogger<BrmbleEventBus>.Instance,
            new Mock<IChannelMembershipService>().Object,
            new Mock<ISessionMappingService>().Object,
            Options.Create(new EventBusSettings()));

        string? captured = null;
        var ws = new Mock<WebSocket>();
        ws.Setup(w => w.State).Returns(WebSocketState.Open);
        ws.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns((ArraySegment<byte> buffer, WebSocketMessageType _, bool _, CancellationToken _) =>
            {
                captured = Encoding.UTF8.GetString(buffer);
                return Task.CompletedTask;
            });

        await bus.AddClientAsync(ws.Object, 1L);
        await bus.BroadcastToUsersAsync(new HashSet<long> { 1L }, message);

        Assert.IsNotNull(captured, "The event bus did not send the payload.");
        return JsonDocument.Parse(captured);
    }
}
