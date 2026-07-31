using Brmble.Server.Events;

namespace Brmble.Server.Paint;

public sealed record PaintPresenceParticipant(long UserId, int ChannelId, int MumbleSessionId, string MatrixUserId);

public interface IPaintPresence
{
    bool TryGetParticipant(long userId, out PaintPresenceParticipant participant);
    bool TryGetParticipantByMumbleSessionId(int mumbleSessionId, out PaintPresenceParticipant participant);
    IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId);
}

public sealed class SessionMappingPaintPresence(ISessionMappingService sessions, IChannelMembershipService membership) : IPaintPresence
{
    public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant)
    {
        participant = null!;
        if (!sessions.TryGetMappingByUserId(userId, out var sessionId, out var mapping) || mapping is null ||
            mapping.IsBrmbleClient != true || !membership.TryGetChannel(sessionId, out var channelId))
            return false;
        participant = new PaintPresenceParticipant(userId, channelId, sessionId, mapping.MatrixUserId);
        return true;
    }

    public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId)
    {
        var snapshot = sessions.GetSnapshot();
        return membership.GetSessionsInChannel(channelId)
            .Where(sessionId => snapshot.TryGetValue(sessionId, out var mapping) && mapping.IsBrmbleClient == true)
            .Select(sessionId =>
            {
                var mapping = snapshot[sessionId];
                return new PaintPresenceParticipant(mapping.UserId, channelId, sessionId, mapping.MatrixUserId);
            })
            .ToArray();
    }

    public bool TryGetParticipantByMumbleSessionId(int mumbleSessionId, out PaintPresenceParticipant participant)
    {
        participant = null!;
        var snapshot = sessions.GetSnapshot();
        if (!snapshot.TryGetValue(mumbleSessionId, out var mapping)
            || mapping.IsBrmbleClient != true
            || !membership.TryGetChannel(mumbleSessionId, out var channelId))
            return false;

        participant = new PaintPresenceParticipant(
            mapping.UserId,
            channelId,
            mumbleSessionId,
            mapping.MatrixUserId);
        return true;
    }
}
