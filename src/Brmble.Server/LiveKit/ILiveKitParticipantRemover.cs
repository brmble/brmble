namespace Brmble.Server.LiveKit;

public interface ILiveKitParticipantRemover
{
    Task<bool> RemoveParticipant(string roomName, string participantIdentity);
}
