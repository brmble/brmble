using System.Collections.Concurrent;

namespace Brmble.Server.Events;

public class ChannelMembershipService : IChannelMembershipService
{
    private readonly ConcurrentDictionary<int, int> _sessionToChannel = new();

    public void Update(int sessionId, int channelId)
        => _sessionToChannel[sessionId] = channelId;

    public void Remove(int sessionId)
        => _sessionToChannel.TryRemove(sessionId, out _);

    public bool TryGetChannel(int sessionId, out int channelId)
        => _sessionToChannel.TryGetValue(sessionId, out channelId);

    public IReadOnlyList<int> GetSessionsInChannel(int channelId)
        => _sessionToChannel.Where(kvp => kvp.Value == channelId).Select(kvp => kvp.Key).ToList();
}
