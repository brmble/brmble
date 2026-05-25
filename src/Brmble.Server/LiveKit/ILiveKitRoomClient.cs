namespace Brmble.Server.LiveKit;

public interface ILiveKitRoomClient
{
    Task RemoveParticipant(string roomName, string participantIdentity);

    Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName);
}
