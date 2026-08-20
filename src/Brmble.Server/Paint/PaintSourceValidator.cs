namespace Brmble.Server.Paint;

public sealed record PaintSourceMetadata(
    string MimeType,
    int Width,
    int Height,
    long SizeBytes);

public sealed class PaintSourceValidator
{
    public const long MaxSourceImageBytes = 10 * 1024 * 1024;

    private static readonly HashSet<string> SupportedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png",
        "image/jpeg",
        "image/webp",
    };

    public PaintSourceMetadata Validate(string declaredMimeType, ReadOnlySpan<byte> bytes)
    {
        if (!SupportedMimeTypes.Contains(declaredMimeType))
        {
            if (string.Equals(declaredMimeType, "image/svg+xml", StringComparison.OrdinalIgnoreCase))
            {
                throw new PaintValidationException("svg sources are not supported.");
            }

            if (string.Equals(declaredMimeType, "image/gif", StringComparison.OrdinalIgnoreCase))
            {
                throw new PaintValidationException("gif sources are not supported.");
            }

            throw new PaintValidationException("source image type is invalid.");
        }

        if (bytes.Length > MaxSourceImageBytes)
        {
            throw new PaintValidationException($"source image exceeds the {MaxSourceImageBytes} byte limit.");
        }

        var metadata = ImageMetadataReader.Read(bytes.ToArray(), declaredMimeType);
        if (metadata.Width <= 0 || metadata.Height <= 0)
        {
            throw new PaintValidationException("source image dimensions are invalid.");
        }

        if (metadata.Width > 4096 || metadata.Height > 4096)
        {
            throw new PaintValidationException("source image dimensions exceed 4096x4096.");
        }

        return new PaintSourceMetadata(
            metadata.MimeType,
            metadata.Width,
            metadata.Height,
            bytes.Length);
    }
}
