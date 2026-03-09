namespace Brmble.Server.Events;

public interface IChannelMembershipService
{
    void Update(int sessionId, int channelId);
    void Remove(int sessionId);
    bool TryGetChannel(int sessionId, out int channelId);
    IReadOnlyList<int> GetSessionsInChannel(int channelId);
}
