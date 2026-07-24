using System.Text.Json;

namespace Brmble.Server.Paint;

public sealed class MatrixPaintSourceResolver(IMatrixPaintService matrixPaintService)
{
    private static readonly HashSet<string> SupportedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png",
        "image/jpeg",
        "image/webp",
    };

    public async Task<PaintSource> ResolveAsync(string matrixRoomId, string hostMatrixUserId, string sourceEventId, CancellationToken cancellationToken)
    {
        var roomEvent = await matrixPaintService.GetRoomEventAsync(matrixRoomId, sourceEventId, cancellationToken);
        ValidateRoomEvent(matrixRoomId, hostMatrixUserId, roomEvent);

        var content = GetRequiredObject(roomEvent, "content");
        var mxcUrl = GetRequiredString(content, "url");
        if (string.IsNullOrWhiteSpace(mxcUrl))
        {
            throw new PaintValidationException("source event is missing media url.");
        }

        var mimeType = TryGetNestedString(content, "info", "mimetype") ?? "application/octet-stream";
        if (string.Equals(mimeType, "image/svg+xml", StringComparison.OrdinalIgnoreCase))
        {
            throw new PaintValidationException("svg sources are not supported.");
        }

        if (string.Equals(mimeType, "image/gif", StringComparison.OrdinalIgnoreCase))
        {
            throw new PaintValidationException("gif sources are not supported.");
        }

        if (!SupportedMimeTypes.Contains(mimeType))
        {
            throw new PaintValidationException("source image type is invalid.");
        }

        var bytes = await matrixPaintService.DownloadMediaAsync(mxcUrl, cancellationToken);
        var metadata = ImageMetadataReader.Read(bytes, mimeType);
        if (metadata.Width > 4096 || metadata.Height > 4096)
        {
            throw new PaintValidationException("source image dimensions exceed 4096x4096.");
        }

        var sizeBytes = TryGetNestedInt64(content, "info", "size") ?? bytes.LongLength;
        return new PaintSource(
            matrixRoomId,
            sourceEventId,
            mxcUrl,
            metadata.MimeType,
            metadata.Width,
            metadata.Height,
            sizeBytes);
    }

    private static void ValidateRoomEvent(string matrixRoomId, string hostMatrixUserId, JsonElement roomEvent)
    {
        var eventRoomId = GetRequiredString(roomEvent, "room_id");
        if (!string.Equals(eventRoomId, matrixRoomId, StringComparison.Ordinal))
        {
            throw new PaintValidationException("source event must belong to the paint room.");
        }

        var eventType = GetRequiredString(roomEvent, "type");
        if (!string.Equals(eventType, "m.room.message", StringComparison.Ordinal))
        {
            throw new PaintValidationException("source event must be an m.room.message event.");
        }

        var content = GetRequiredObject(roomEvent, "content");
        var messageType = GetRequiredString(content, "msgtype");
        if (!string.Equals(messageType, "m.image", StringComparison.Ordinal))
        {
            throw new PaintValidationException("source event content must be an m.image message.");
        }

        var sender = GetRequiredString(roomEvent, "sender");
        if (!string.Equals(sender, hostMatrixUserId, StringComparison.Ordinal))
        {
            throw new PaintValidationException("source event must be uploaded by the host.");
        }
    }

    private static string? TryGetNestedString(JsonElement element, string propertyName, string nestedPropertyName)
    {
        if (!element.TryGetProperty(propertyName, out var child) || !child.TryGetProperty(nestedPropertyName, out var nested))
        {
            return null;
        }

        return nested.GetString();
    }

    private static JsonElement GetRequiredObject(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.Object)
            throw new PaintValidationException($"source event is missing {propertyName}.");
        return value;
    }

    private static string GetRequiredString(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
            throw new PaintValidationException($"source event is missing {propertyName}.");
        return value.GetString()!;
    }

    private static long? TryGetNestedInt64(JsonElement element, string propertyName, string nestedPropertyName)
    {
        if (!element.TryGetProperty(propertyName, out var child) || !child.TryGetProperty(nestedPropertyName, out var nested))
        {
            return null;
        }

        return nested.ValueKind == JsonValueKind.Number ? nested.GetInt64() : null;
    }
}
