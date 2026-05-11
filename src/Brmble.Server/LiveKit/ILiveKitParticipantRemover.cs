namespace Brmble.Server.LiveKit;

public interface ILiveKitParticipantRemover
{
    Task RemoveParticipant(string roomName, string participantIdentity);
}
