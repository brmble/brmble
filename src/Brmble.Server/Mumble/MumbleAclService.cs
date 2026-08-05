namespace Brmble.Server.Mumble;

public sealed class MumbleAclService : IMumbleAclService
{
    private readonly IMumbleAclIceClient _iceClient;
    private readonly ILogger<MumbleAclService> _logger;

    public MumbleAclService(IMumbleAclIceClient iceClient, ILogger<MumbleAclService> logger)
    {
        _iceClient = iceClient;
        _logger = logger;
    }

    public async Task<AclChannelSnapshotDto> GetChannelAclAsync(int channelId)
    {
        try
        {
            var result = await _iceClient.GetAclAsync(channelId);
            return AclMapper.FromIce(channelId, result, DateTimeOffset.UtcNow, stale: false, warning: null);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException)
        {
            _logger.LogWarning("Failed to fetch ACL for channel {ChannelId} errorType={ErrorType}", channelId, ex.GetType().Name);
            throw new MumbleAclException($"Failed to fetch ACL for channel {channelId}.");
        }
    }

    public async Task SetChannelAclAsync(int channelId, AclUpdateRequest request)
    {
        var (acls, groups, inherit) = AclMapper.ToIce(request);

        try
        {
            await _iceClient.SetAclAsync(channelId, acls, groups, inherit);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException)
        {
            _logger.LogWarning("Failed to set ACL for channel {ChannelId} errorType={ErrorType}", channelId, ex.GetType().Name);
            throw new MumbleAclException($"Failed to set ACL for channel {channelId}.");
        }
    }

    public async Task UpdateChannelStateAsync(int channelId, ChannelUpdateRequest request)
    {
        try
        {
            var current = await _iceClient.GetChannelStateAsync(channelId);
            var updated = new MumbleServer.Channel(
                current.id,
                request.Name.Trim(),
                current.parent,
                current.links,
                request.Description ?? current.description,
                current.temporary,
                request.Position);

            await _iceClient.SetChannelStateAsync(updated);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to update channel state for channel {ChannelId}", channelId);
            throw new MumbleAclException($"Failed to update channel {channelId}.", ex);
        }
    }

    public async Task AddUserToGroupAsync(int channelId, int sessionId, string group)
    {
        try
        {
            await _iceClient.AddUserToGroupAsync(channelId, sessionId, group);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to add session {SessionId} to group {Group} on channel {ChannelId}", sessionId, group, channelId);
            throw new MumbleAclException($"Failed adding session {sessionId} to group {group} on channel {channelId}.", ex);
        }
    }

    public async Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group)
    {
        try
        {
            await _iceClient.RemoveUserFromGroupAsync(channelId, sessionId, group);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to remove session {SessionId} from group {Group} on channel {ChannelId}", sessionId, group, channelId);
            throw new MumbleAclException($"Failed removing session {sessionId} from group {group} on channel {channelId}.", ex);
        }
    }

    public async Task<bool> HasWritePermissionAsync(int sessionId, int channelId)
    {
        return await HasPermissionAsync(sessionId, channelId, MumbleServer.PermissionWrite.value);
    }

    public async Task<bool> HasTextMessagePermissionAsync(int sessionId, int channelId)
    {
        return await HasPermissionAsync(sessionId, channelId, MumbleServer.PermissionTextMessage.value);
    }

    public async Task<bool> HasPermissionAsync(int sessionId, int channelId, int permission)
    {
        try
        {
            return await _iceClient.HasPermissionAsync(sessionId, channelId, permission);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to verify permission for session {SessionId} on channel {ChannelId}", sessionId, channelId);
            throw new MumbleAclException($"Failed to verify permission for session {sessionId} on channel {channelId}.", ex);
        }
    }
}
