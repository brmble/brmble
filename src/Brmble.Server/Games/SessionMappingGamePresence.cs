using Brmble.Server.Events;

namespace Brmble.Server.Games;

public sealed class SessionMappingGamePresence : IGamePresence
{
    private readonly ISessionMappingService _sessions;
    private readonly IChannelMembershipService _membership;

    public SessionMappingGamePresence(ISessionMappingService sessions, IChannelMembershipService membership)
    {
        _sessions = sessions;
        _membership = membership;
    }

    public bool TryGetChannel(long userId, out int channelId, out bool isBrmble)
    {
        channelId = 0;
        isBrmble = false;
        if (!_sessions.TryGetMappingByUserId(userId, out var sessionId, out var mapping) || mapping is null)
            return false;
        isBrmble = mapping.IsBrmbleClient;
        return _membership.TryGetChannel(sessionId, out channelId);
    }
}
