using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintValidationTests
{
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
}
