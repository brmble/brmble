namespace Brmble.Server.Mumble;

public interface IAclSyncCoordinator
{
    Task<AclChannelSnapshotDto> RefreshFromReadAsync(int channelId, string? cachedSnapshotHash);
    Task<AclWriteResult> WriteAndRefreshAsync(int channelId, AclUpdateRequest request);
    Task<AclWriteResult> AddUserToGroupAndRefreshAsync(int channelId, int sessionId, string group);
    Task<AclWriteResult> RemoveUserFromGroupAndRefreshAsync(int channelId, int sessionId, string group);
}

public sealed class AclSyncCoordinator : IAclSyncCoordinator
{
    private readonly IMumbleAclService _aclService;
    private readonly IAclSnapshotRepository _snapshots;
    private readonly IAclEventDispatcher _events;
    private readonly ILogger<AclSyncCoordinator> _logger;

    public AclSyncCoordinator(
        IMumbleAclService aclService,
        IAclSnapshotRepository snapshots,
        IAclEventDispatcher events,
        ILogger<AclSyncCoordinator> logger)
    {
        _aclService = aclService;
        _snapshots = snapshots;
        _events = events;
        _logger = logger;
    }

    public async Task<AclChannelSnapshotDto> RefreshFromReadAsync(int channelId, string? cachedSnapshotHash)
    {
        var snapshot = await RefreshCoreAsync(channelId);
        if (!string.IsNullOrWhiteSpace(cachedSnapshotHash)
            && !string.Equals(snapshot.SnapshotHash, cachedSnapshotHash, StringComparison.OrdinalIgnoreCase))
        {
            await _events.DispatchAclChangedAsync(channelId, snapshot);
        }

        return snapshot;
    }

    public async Task<AclWriteResult> WriteAndRefreshAsync(int channelId, AclUpdateRequest request)
    {
        var current = await _aclService.GetChannelAclAsync(channelId);
        var currentHash = AclSnapshotHasher.Compute(current);
        if (!string.Equals(request.ExpectedSnapshotHash, currentHash, StringComparison.OrdinalIgnoreCase))
        {
            return new AclWriteResult(false, current with { SnapshotHash = currentHash }, null, "ACL changed since it was opened.");
        }

        await _aclService.SetChannelAclAsync(channelId, request);
        try
        {
            var snapshot = await RefreshAfterWriteAsync(channelId);
            return new AclWriteResult(true, snapshot, null, null);
        }
        catch (Exception ex)
        {
            const string warning = "ACL change may have succeeded in Mumble, but Brmble could not refresh canonical ACL state.";
            var staleReason = $"{warning} {ex.Message}";
            _logger.LogWarning(ex, "ACL write for channel {ChannelId} succeeded before refresh failed", channelId);
            await _snapshots.MarkStaleAsync(channelId, staleReason);
            return new AclWriteResult(false, null, warning, ex.Message);
        }
    }

    public async Task<AclWriteResult> AddUserToGroupAndRefreshAsync(int channelId, int sessionId, string group)
    {
        try
        {
            await _aclService.AddUserToGroupAsync(channelId, sessionId, group);
            var snapshot = await RefreshAfterWriteAsync(channelId);
            return new AclWriteResult(true, snapshot, null, null);
        }
        catch (Exception ex)
        {
            await _snapshots.MarkStaleAsync(channelId, "ACL group add may have succeeded, but refresh failed.");
            return new AclWriteResult(false, null, "ACL group add may have succeeded, but refresh failed.", ex.Message);
        }
    }

    public async Task<AclWriteResult> RemoveUserFromGroupAndRefreshAsync(int channelId, int sessionId, string group)
    {
        try
        {
            await _aclService.RemoveUserFromGroupAsync(channelId, sessionId, group);
            var snapshot = await RefreshAfterWriteAsync(channelId);
            return new AclWriteResult(true, snapshot, null, null);
        }
        catch (Exception ex)
        {
            await _snapshots.MarkStaleAsync(channelId, "ACL group remove may have succeeded, but refresh failed.");
            return new AclWriteResult(false, null, "ACL group remove may have succeeded, but refresh failed.", ex.Message);
        }
    }

    private async Task<AclChannelSnapshotDto> RefreshAfterWriteAsync(int channelId)
    {
        var snapshot = await RefreshCoreAsync(channelId);
        await _events.DispatchAclChangedAsync(channelId, snapshot);
        return snapshot;
    }

    private async Task<AclChannelSnapshotDto> RefreshCoreAsync(int channelId)
    {
        var snapshot = await _aclService.GetChannelAclAsync(channelId);
        snapshot = snapshot with { SnapshotHash = AclSnapshotHasher.Compute(snapshot) };
        await _snapshots.UpsertAsync(snapshot);
        return snapshot;
    }
}
