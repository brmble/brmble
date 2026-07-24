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

        var content = roomEvent.GetProperty("content");
        var mxcUrl = content.GetProperty("url").GetString();
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
        var eventRoomId = roomEvent.GetProperty("room_id").GetString();
        if (!string.Equals(eventRoomId, matrixRoomId, StringComparison.Ordinal))
        {
            throw new PaintValidationException("source event must belong to the paint room.");
        }

        var eventType = roomEvent.GetProperty("type").GetString();
        if (!string.Equals(eventType, "m.room.message", StringComparison.Ordinal))
        {
            throw new PaintValidationException("source event must be an m.room.message event.");
        }

        var content = roomEvent.GetProperty("content");
        var messageType = content.GetProperty("msgtype").GetString();
        if (!string.Equals(messageType, "m.image", StringComparison.Ordinal))
        {
            throw new PaintValidationException("source event content must be an m.image message.");
        }

        var sender = roomEvent.GetProperty("sender").GetString();
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

    private static long? TryGetNestedInt64(JsonElement element, string propertyName, string nestedPropertyName)
    {
        if (!element.TryGetProperty(propertyName, out var child) || !child.TryGetProperty(nestedPropertyName, out var nested))
        {
            return null;
        }

        return nested.ValueKind == JsonValueKind.Number ? nested.GetInt64() : null;
    }
}
