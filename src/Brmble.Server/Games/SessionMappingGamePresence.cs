using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.Games;

public sealed class SessionMappingGamePresence : IGamePresence
{
    private readonly ISessionMappingService _sessions;
    private readonly IChannelMembershipService _membership;
    private readonly UserRepository _users;

    public SessionMappingGamePresence(ISessionMappingService sessions, IChannelMembershipService membership, UserRepository users)
    {
        _sessions = sessions;
        _membership = membership;
        _users = users;
    }

    public bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)
    {
        channelId = 0;
        isBrmble = false;
        userId = 0;
        if (!_sessions.GetSnapshot().TryGetValue((int)sessionId, out var mapping) || mapping is null)
            return false;
        isBrmble = mapping.IsBrmbleClient;
        userId = mapping.UserId;
        return _membership.TryGetChannel((int)sessionId, out channelId);
    }

    public string? GetDisplayName(long sessionId)
        => _sessions.GetSnapshot().TryGetValue((int)sessionId, out var mapping) && mapping is not null
            ? mapping.MumbleName
            : null;

    public async Task<bool> AreChallengesBlockedAsync(long sessionId)
    {
        if (!_sessions.GetSnapshot().TryGetValue((int)sessionId, out var mapping) || mapping is null)
            return false;
        return await _users.GetChallengesBlocked(mapping.UserId);
    }
}
