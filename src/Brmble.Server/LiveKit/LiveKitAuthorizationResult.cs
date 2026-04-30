namespace Brmble.Server.LiveKit;

public enum LiveKitAuthorizationFailure
{
    Unauthorized,
    Forbidden,
    InvalidRoom,
}

public sealed record LiveKitAuthorizationResult
{
    private LiveKitAuthorizationResult(
        bool allowed,
        string? certHash,
        string? roomName,
        LiveKitAccessMode? accessMode,
        LiveKitAuthorizationFailure? failure)
    {
        Allowed = allowed;
        CertHash = certHash;
        RoomName = roomName;
        AccessMode = accessMode;
        Failure = failure;
    }

    public bool Allowed { get; init; }

    public string? CertHash { get; init; }

    public string? RoomName { get; init; }

    public LiveKitAccessMode? AccessMode { get; init; }

    public LiveKitAuthorizationFailure? Failure { get; init; }

    public static LiveKitAuthorizationResult Success(string certHash, string roomName, LiveKitAccessMode mode) =>
        new(true, certHash, roomName, mode, null);

    public static LiveKitAuthorizationResult Denied(LiveKitAuthorizationFailure failure) =>
        new(false, null, null, null, failure);
}
