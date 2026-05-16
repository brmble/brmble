using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public interface IAclEventDispatcher
{
    Task DispatchAclChangedAsync(int channelId, AclChannelSnapshotDto snapshot);
}

public sealed class AclEventDispatcher : IAclEventDispatcher
{
    private readonly IAclAuthorizationService _authorization;
    private readonly IBrmbleEventBus _eventBus;

    public AclEventDispatcher(
        IAclAuthorizationService authorization,
        IBrmbleEventBus eventBus)
    {
        _authorization = authorization;
        _eventBus = eventBus;
    }

    public async Task DispatchAclChangedAsync(int channelId, AclChannelSnapshotDto snapshot)
    {
        var connectedUserIds = await _eventBus.GetConnectedUserIdsAsync();
        if (connectedUserIds.Count == 0)
        {
            return;
        }

        var allowed = new HashSet<long>();
        foreach (var userId in connectedUserIds)
        {
            if (await _authorization.CanManageChannelAclAsync(userId, channelId))
            {
                allowed.Add(userId);
            }
        }

        if (allowed.Count == 0)
        {
            return;
        }

        await _eventBus.BroadcastToUsersAsync(
            allowed,
            new { type = "acl.changed", channelId, snapshot });
    }
}
