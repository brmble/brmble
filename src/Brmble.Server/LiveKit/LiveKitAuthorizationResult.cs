namespace Brmble.Server.LiveKit;

public enum LiveKitAuthorizationFailure
{
    Unauthorized,
    Forbidden,
    InvalidRoom,
}

public sealed class LiveKitAuthorizationResult
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

    public bool Allowed { get; }

    public string? CertHash { get; }

    public string? RoomName { get; }

    public LiveKitAccessMode? AccessMode { get; }

    public LiveKitAuthorizationFailure? Failure { get; }

    public static LiveKitAuthorizationResult Success(string certHash, string roomName, LiveKitAccessMode mode) =>
        new(true, certHash, roomName, mode, null);

    public static LiveKitAuthorizationResult Denied(LiveKitAuthorizationFailure failure) =>
        new(false, null, null, null, failure);
}
