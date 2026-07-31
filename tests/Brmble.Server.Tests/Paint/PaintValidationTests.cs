using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintValidationTests
{
    [TestMethod]
    public void ValidateStrokeInput_AcceptsDocumentedThinWidthAndPalette()
    {
        var input = new PaintStrokeInput(
            Guid.NewGuid(),
            0,
            PaintTool.Pen,
            "#FFFFFF",
            (PaintStrokeWidth)3,
            new[] { new PaintPoint(0.1, 0.2, 0.5) });

        var result = PaintValidation.ValidateStrokeInput(input);

        Assert.AreEqual("#ffffff", result.Color);
        Assert.AreEqual(3, (int)result.Width);
    }

    [TestMethod]
    public void ValidateStrokeInput_NormalizesPenColor()
    {
        var input = new PaintStrokeInput(
            Guid.Parse("11111111-1111-1111-1111-111111111111"),
            0,
            PaintTool.Pen,
            "#EF4444",
            PaintStrokeWidth.Medium,
            new[] { new PaintPoint(0.1, 0.2, 0.5) });

        var result = PaintValidation.ValidateStrokeInput(input);

        Assert.AreEqual("#ef4444", result.Color);
    }

    [TestMethod]
    public void ValidateStrokeInput_RejectsOutOfRangePoint()
    {
        var input = new PaintStrokeInput(
            Guid.NewGuid(),
            0,
            PaintTool.Pen,
            "#ef4444",
            PaintStrokeWidth.Medium,
            new[] { new PaintPoint(1.1, 0.2, null) });

        Assert.ThrowsException<PaintValidationException>(() => PaintValidation.ValidateStrokeInput(input));
    }

    [TestMethod]
    public void ValidateStrokeInput_RejectsUnsupportedColor()
    {
        var input = new PaintStrokeInput(
            Guid.NewGuid(),
            0,
            PaintTool.Pen,
            "#a855f7",
            PaintStrokeWidth.Medium,
            new[] { new PaintPoint(0.1, 0.2, null) });

        Assert.ThrowsException<PaintValidationException>(() => PaintValidation.ValidateStrokeInput(input));
    }

    [TestMethod]
    public void ValidateStrokeInput_IgnoresEraserColor()
    {
        var input = new PaintStrokeInput(
            Guid.NewGuid(),
            0,
            PaintTool.Eraser,
            "#ef4444",
            PaintStrokeWidth.Wide,
            new[] { new PaintPoint(0.1, 0.2, null) });

        var result = PaintValidation.ValidateStrokeInput(input);

        Assert.IsNull(result.Color);
    }

    [TestMethod]
    public void ValidateStrokeInput_Accepts2000PointsAndRejects2001Points()
    {
        var accepted = Enumerable.Range(0, 2000)
            .Select(i => new PaintPoint(i / 2000d, i / 2000d, null)).ToArray();
        Assert.AreEqual(2000, PaintValidation.ValidateStrokeInput(new PaintStrokeInput(
            Guid.NewGuid(), 0, PaintTool.Pen, "#ef4444", PaintStrokeWidth.Medium, accepted)).Points.Count);

        var rejected = Enumerable.Range(0, 2001)
            .Select(i => new PaintPoint(i / 2001d, i / 2001d, null)).ToArray();
        var exception = Assert.ThrowsException<PaintValidationException>(() =>
            PaintValidation.ValidateStrokeInput(new PaintStrokeInput(
                Guid.NewGuid(), 0, PaintTool.Pen, "#ef4444", PaintStrokeWidth.Medium, rejected)));
        StringAssert.Contains(exception.Message, "2000");
    }
}
