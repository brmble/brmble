using System.Text.Json;

namespace Brmble.Server.Paint;

public sealed class MatrixPaintSourceResolver(IMatrixPaintService matrixPaintService)
{
    private static readonly PaintSourceValidator SourceValidator = new();

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
        ValidateMxcUrl(mxcUrl, matrixRoomId);

        var mimeType = TryGetNestedString(content, "info", "mimetype") ?? "application/octet-stream";

        var declaredSizeBytes = TryGetNestedInt64(content, "info", "size");
        if (declaredSizeBytes is < 0 or > PaintSourceValidator.MaxSourceImageBytes)
        {
            throw new PaintValidationException($"source image exceeds the {PaintSourceValidator.MaxSourceImageBytes} byte limit.");
        }

        byte[] bytes;
        try
        {
            bytes = await matrixPaintService.DownloadMediaAsync(mxcUrl, PaintSourceValidator.MaxSourceImageBytes, cancellationToken);
        }
        catch (InvalidDataException)
        {
            throw new PaintValidationException($"source image exceeds the {PaintSourceValidator.MaxSourceImageBytes} byte limit.");
        }
        var metadata = SourceValidator.Validate(mimeType, bytes);
        return new PaintSource(
            metadata.MimeType,
            metadata.Width,
            metadata.Height,
            declaredSizeBytes ?? metadata.SizeBytes);
    }

    private static void ValidateMxcUrl(string mxcUrl, string matrixRoomId)
    {
        if (!Uri.TryCreate(mxcUrl, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, "mxc", StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(uri.Host)
            || string.IsNullOrWhiteSpace(uri.AbsolutePath.Trim('/'))
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw new PaintValidationException("source media url must be a valid mxc:// URI.");
        }

        var separator = matrixRoomId.IndexOf(':');
        if (separator < 1 || separator == matrixRoomId.Length - 1
            || !string.Equals(uri.Authority, matrixRoomId[(separator + 1)..], StringComparison.OrdinalIgnoreCase))
        {
            throw new PaintValidationException("source media must be hosted by the local Matrix server.");
        }
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
        var child = GetOptionalObject(element, propertyName);
        if (child is null || !child.Value.TryGetProperty(nestedPropertyName, out var nested) || nested.ValueKind != JsonValueKind.String)
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
        var child = GetOptionalObject(element, propertyName);
        if (child is null || !child.Value.TryGetProperty(nestedPropertyName, out var nested))
        {
            return null;
        }

        if (nested.ValueKind != JsonValueKind.Number || !nested.TryGetInt64(out var value))
        {
            throw new PaintValidationException("source image size must be an integer.");
        }

        return value;
    }

    private static JsonElement? GetOptionalObject(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value)) return null;
        if (value.ValueKind != JsonValueKind.Object)
            throw new PaintValidationException($"source event {propertyName} must be an object.");
        return value;
    }
}
