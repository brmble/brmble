using System.Text.Json;
using Brmble.Server.Events;
using Brmble.Server.LiveKit;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Events;

[TestClass]
public sealed class BrmbleEventBusPaintSerializationTests
{
    [TestMethod]
    [DataRow(PaintStrokeWidth.Thin, 3)]
    [DataRow(PaintStrokeWidth.Medium, 6)]
    [DataRow(PaintStrokeWidth.Wide, 12)]
    public void PaintStrokeCommitted_SerializesWidthAsNumber(PaintStrokeWidth width, int expected)
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
            width,
            [new PaintPoint(0.1, 0.2, null)],
            true);

        using var json = JsonDocument.Parse(BrmbleEventBus.SerializeForWebSocketForTest(new
        {
            type = PaintEventNames.StrokeCommitted,
            sessionId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            stroke,
            revision = 1L,
            generation = 0L,
        }));

        var widthElement = json.RootElement.GetProperty("stroke").GetProperty("width");
        Assert.AreEqual(JsonValueKind.Number, widthElement.ValueKind);
        Assert.AreEqual(expected, widthElement.GetInt32());
        Assert.AreEqual("pen", json.RootElement.GetProperty("stroke").GetProperty("tool").GetString());
    }

    [TestMethod]
    public void PaintPreview_SerializesInputWidthAsNumber()
    {
        var input = new PaintStrokeInput(
            Guid.Parse("22222222-2222-2222-2222-222222222222"),
            0,
            PaintTool.Eraser,
            null,
            PaintStrokeWidth.Wide,
            [new PaintPoint(0.1, 0.2, null)]);

        using var json = JsonDocument.Parse(BrmbleEventBus.SerializeForWebSocketForTest(new
        {
            type = PaintEventNames.PreviewUpdated,
            sessionId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            generation = 0L,
            authorUserId = 7L,
            authorMatrixUserId = "@alice:test",
            input,
        }));

        var widthElement = json.RootElement.GetProperty("input").GetProperty("width");
        Assert.AreEqual(JsonValueKind.Number, widthElement.ValueKind);
        Assert.AreEqual(12, widthElement.GetInt32());
        Assert.AreEqual("eraser", json.RootElement.GetProperty("input").GetProperty("tool").GetString());
    }

    [TestMethod]
    public void PaintSessionStatus_RemainsString()
    {
        using var json = JsonDocument.Parse(BrmbleEventBus.SerializeForWebSocketForTest(new
        {
            type = PaintEventNames.SessionEnded,
            sessionId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
            status = PaintSessionStatus.Ended,
            revision = 1L,
            generation = 0L,
        }));

        Assert.AreEqual(JsonValueKind.String, json.RootElement.GetProperty("status").ValueKind);
        Assert.AreEqual("ended", json.RootElement.GetProperty("status").GetString());
    }

    [TestMethod]
    public void UnrelatedEnum_RemainsStringUnderGlobalConverter()
    {
        using var json = JsonDocument.Parse(BrmbleEventBus.SerializeForWebSocketForTest(new
        {
            type = "test.enum",
            accessMode = LiveKitAccessMode.Subscribe,
        }));

        Assert.AreEqual(JsonValueKind.String, json.RootElement.GetProperty("accessMode").ValueKind);
        Assert.AreEqual("subscribe", json.RootElement.GetProperty("accessMode").GetString());
    }
}
