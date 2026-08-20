using SkiaSharp;

namespace Brmble.Server.Paint;

public sealed record ImageMetadata(string MimeType, int Width, int Height);

public static class ImageMetadataReader
{
    public static ImageMetadata Read(byte[] data, string? declaredMimeType = null)
    {
        try
        {
            using var encoded = SKData.CreateCopy(data);
            using var codec = SKCodec.Create(encoded);
            if (codec is null)
            {
                throw new PaintValidationException("source image is invalid.");
            }

            var mimeType = codec.EncodedFormat switch
            {
                SKEncodedImageFormat.Png => "image/png",
                SKEncodedImageFormat.Jpeg => "image/jpeg",
                SKEncodedImageFormat.Webp => "image/webp",
                _ => null,
            };
            if (mimeType is null)
            {
                throw new PaintValidationException("source image type is invalid.");
            }

            var width = codec.Info.Width;
            var height = codec.Info.Height;
            if (width <= 0 || height <= 0 || width > 4096 || height > 4096)
            {
                throw new PaintValidationException("source image dimensions are invalid.");
            }

            var decodeInfo = new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul);
            using var bitmap = new SKBitmap(decodeInfo);
            if (codec.GetPixels(bitmap.Info, bitmap.GetPixels()) != SKCodecResult.Success)
            {
                throw new PaintValidationException("source image is invalid.");
            }

            return new(mimeType, width, height);
        }
        catch (ArgumentException)
        {
            throw new PaintValidationException("source image is invalid.");
        }
        catch (InvalidOperationException)
        {
            throw new PaintValidationException("source image is invalid.");
        }
    }
}
