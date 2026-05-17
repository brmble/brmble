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

        // Parallelize authorization checks for better performance with many connected users
        var authTasks = connectedUserIds.Select(async userId =>
        {
            var canManage = await _authorization.CanManageChannelAclAsync(userId, channelId);
            return (userId, canManage);
        });

        var authResults = await Task.WhenAll(authTasks);
        var allowed = authResults.Where(r => r.canManage).Select(r => r.userId).ToHashSet();

        if (allowed.Count == 0)
        {
            return;
        }

        await _eventBus.BroadcastToUsersAsync(
            allowed,
            new { type = "acl.changed", channelId, snapshot });
    }
}
