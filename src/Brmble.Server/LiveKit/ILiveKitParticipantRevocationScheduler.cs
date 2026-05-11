namespace Brmble.Server.LiveKit;

public interface ILiveKitParticipantRevocationScheduler
{
    Task RevokeParticipants(IReadOnlyList<LiveKitParticipantRecord> records);
}
