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
    string? CompanionId,
    string? CustomCompanionId)
{
    /// <summary>
    /// The legacy split: a custom skin is sent as <c>"floppy"</c> plus the truth in
    /// <c>customCompanionId</c>, because clients predating custom companions cannot parse
    /// <c>custom:$…</c> in <c>companionId</c>.
    /// </summary>
    public static CompanionWireSelection FromPersisted(string? selection)
    {
        // A mapping with no companion at all is unknown, not a floppy. Nothing writes this
        // today — SessionMapping.CompanionId is non-null — but the wire type must be able to
        // express "unknown" or the projection's null-means-unknown rule has no way to reach it.
        if (selection is null) return new(null, null);

        return Brmble.Server.Companions.CustomCompanionId.TryParse(selection, out _)
            ? new("floppy", selection)
            : new(selection, null);
    }

    /// <summary>
    /// Builds the companion fields for a client at the given projection version.
    /// </summary>
    /// <remarks>
    /// Version 0 predates custom companions being first-class and cannot parse
    /// <c>custom:$…</c> in <c>companionId</c>, so it gets <c>"floppy"</c> plus the truth in
    /// <c>customCompanionId</c>. That is a lie told at the compatibility boundary; it must never
    /// reach the projection.
    /// </remarks>
    public static CompanionWireSelection For(string? persisted, int projectionVersion) =>
        projectionVersion >= 1
            ? new CompanionWireSelection(persisted, null)
            : FromPersisted(persisted);
}
