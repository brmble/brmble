namespace Brmble.Server.Paint;

public sealed class PaintValidationException(string message) : Exception(message);

public static class PaintValidation
{
    public static readonly ISet<string> AllowedColors = new HashSet<string>(StringComparer.Ordinal)
    {
        "#111827",
        "#ef4444",
        "#f97316",
        "#eab308",
        "#22c55e",
        "#3b82f6",
    };

    public static PaintStrokeInput ValidateStrokeInput(PaintStrokeInput input)
    {
        if (input.CorrelationId == Guid.Empty)
        {
            throw new PaintValidationException("correlationId is required.");
        }

        if (input.Generation < 0)
        {
            throw new PaintValidationException("generation must be non-negative.");
        }

        if (!Enum.IsDefined(input.Tool))
        {
            throw new PaintValidationException("tool is invalid.");
        }

        if (!Enum.IsDefined(input.Width))
        {
            throw new PaintValidationException("width is invalid.");
        }

        if (input.Points.Count == 0)
        {
            throw new PaintValidationException("points must contain at least one point.");
        }

        foreach (var point in input.Points)
        {
            if (!IsUnit(point.X) || !IsUnit(point.Y) || (point.Pressure is { } pressure && !IsUnit(pressure)))
            {
                throw new PaintValidationException("points must be normalized finite numbers.");
            }
        }

        if (input.Tool == PaintTool.Eraser)
        {
            return input with { Color = null };
        }

        var color = input.Color?.ToLowerInvariant();
        if (color is null || !AllowedColors.Contains(color))
        {
            throw new PaintValidationException("color is invalid.");
        }

        return input with { Color = color };
    }

    private static bool IsUnit(double value) => double.IsFinite(value) && value >= 0 && value <= 1;
}
