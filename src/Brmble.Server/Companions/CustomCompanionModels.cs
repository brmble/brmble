namespace Brmble.Server.Companions;

public static class CustomCompanionId
{
    public const string Prefix = "custom:";

    public static bool TryParse(string? value, out string eventId)
    {
        eventId = string.Empty;
        if (value is null || !value.StartsWith(Prefix, StringComparison.Ordinal)) return false;
        var candidate = value[Prefix.Length..];
        if (candidate.Length < 2 || candidate[0] != '$' || candidate.Any(char.IsControl)) return false;
        eventId = candidate;
        return true;
    }

    public static string FromEventId(string eventId) => $"{Prefix}{eventId}";
}

public sealed record CustomCompanionRecord(
    string EventId,
    string StateKey,
    string RoomId,
    long UploaderUserId,
    string UploaderMatrixUserId,
    string UploaderDisplayName,
    string Name,
    string MediaUri,
    string MimeType,
    int Width,
    int Height,
    int FrameCount,
    long ByteSize,
    DateTimeOffset CreatedAt,
    DateTimeOffset? DeletedAt,
    long? DeletedByUserId);

public sealed record CustomCompanionCreateRequest(
    string? Name,
    string? MediaUri);

public enum CompanionImageValidationCode
{
    Valid,
    UnsupportedFormat,
    InvalidImage,
    UnsafeDimensions,
    AnimationNotSupported
}

public sealed record ValidatedCompanionImage(
    string MimeType,
    int Width,
    int Height,
    int FrameCount);

public sealed record CompanionImageValidationResult(
    CompanionImageValidationCode Code,
    ValidatedCompanionImage? Image,
    bool PixelBufferAllocated = false)
{
    public bool IsValid => Code == CompanionImageValidationCode.Valid;
}

public sealed record CustomCompanionCapability(
    bool Enabled,
    int SchemaVersion,
    string GalleryRoomId,
    string TrustedSender,
    bool CanModerate,
    string SelectedCompanionId,
    int MaxActivePerUser,
    int MaxActiveTotal);

public sealed record CompanionWireSelection(
    string CompanionId,
    string? CustomCompanionId)
{
    public static CompanionWireSelection FromPersisted(string selection) =>
        Brmble.Server.Companions.CustomCompanionId.TryParse(selection, out _)
            ? new("floppy", selection)
            : new(selection, null);
}
