using System.Text.Json;
using System.Text.Json.Serialization;

namespace Brmble.Server.Paint;

/// <summary>
/// Paint's wire format is declared on paint's own types rather than configured on a shared
/// serializer, so every path that serializes them - the event bus, the HTTP endpoints, and
/// anything added later - produces the same shape, and no other feature's encoding changes.
/// </summary>
public sealed class PaintToolJsonConverter() : JsonStringEnumConverter<PaintTool>(JsonNamingPolicy.CamelCase);

/// <inheritdoc cref="PaintToolJsonConverter"/>
public sealed class PaintSessionStatusJsonConverter() : JsonStringEnumConverter<PaintSessionStatus>(JsonNamingPolicy.CamelCase);

/// <summary>
/// Stroke widths travel as the pixel width they represent (3, 6 or 12) rather than as a name,
/// because the client applies them directly to the canvas.
/// </summary>
public sealed class PaintStrokeWidthJsonConverter : JsonConverter<PaintStrokeWidth>
{
    public override PaintStrokeWidth Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.Number
            || !reader.TryGetInt32(out var value)
            || !Enum.IsDefined((PaintStrokeWidth)value))
            throw new JsonException("Paint stroke width must be 3, 6, or 12.");

        return (PaintStrokeWidth)value;
    }

    public override void Write(Utf8JsonWriter writer, PaintStrokeWidth value, JsonSerializerOptions options)
    {
        if (!Enum.IsDefined(value))
            throw new JsonException($"Unsupported paint stroke width: {value}.");

        writer.WriteNumberValue((int)value);
    }
}
