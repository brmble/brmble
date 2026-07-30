namespace Brmble.Server.Companions;

public sealed class CustomCompanionOptions
{
    public const int MaxBytes = 5 * 1024 * 1024;
    public const int MaxWidth = 4_096;
    public const int MaxHeight = 4_096;
    public const long MaxPixels = 12_000_000;
    public const long MaxDecodedBytes = MaxPixels * 4;
    public const int MaxFrames = 1;
    public int MaxActivePerUser { get; init; } = 10;
    public int MaxActiveTotal { get; init; } = 100;
    public int UploadPermitLimit { get; init; } = 5;
    public int UploadWindowMinutes { get; init; } = 10;
}
