namespace Brmble.Server.LiveKit;

public enum LiveKitAuthorizationFailure
{
    Unauthorized,
    Forbidden,
    InvalidRoom,
}

public sealed record LiveKitAuthorizationResult(
    bool Allowed,
    string? CertHash,
    string? RoomName,
    LiveKitAccessMode? AccessMode,
    LiveKitAuthorizationFailure? Failure)
{
    public static LiveKitAuthorizationResult Success(string certHash, string roomName, LiveKitAccessMode mode) =>
        new(true, certHash, roomName, mode, null);

    public static LiveKitAuthorizationResult Denied(LiveKitAuthorizationFailure failure) =>
        new(false, null, null, null, failure);
}
