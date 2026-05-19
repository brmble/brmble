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
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to fetch ACL for channel {ChannelId}", channelId);
            throw new MumbleAclException($"Failed to fetch ACL for channel {channelId}.", ex);
        }
    }

    public async Task SetChannelAclAsync(int channelId, AclUpdateRequest request)
    {
        var (acls, groups, inherit) = AclMapper.ToIce(request);

        try
        {
            await _iceClient.SetAclAsync(channelId, acls, groups, inherit);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to set ACL for channel {ChannelId}", channelId);
            throw new MumbleAclException($"Failed to set ACL for channel {channelId}.", ex);
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
        try
        {
            return await _iceClient.HasPermissionAsync(sessionId, channelId, MumbleServer.PermissionWrite.value);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to verify write permission for session {SessionId} on channel {ChannelId}", sessionId, channelId);
            throw new MumbleAclException($"Failed to verify write permission for session {sessionId} on channel {channelId}.", ex);
        }
    }

    public async Task<bool> HasTextMessagePermissionAsync(int sessionId, int channelId)
    {
        try
        {
            return await _iceClient.HasPermissionAsync(sessionId, channelId, MumbleServer.PermissionTextMessage.value);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
        {
            _logger.LogWarning(ex, "Failed to verify text message permission for session {SessionId} on channel {ChannelId}", sessionId, channelId);
            throw new MumbleAclException($"Failed to verify text message permission for session {sessionId} on channel {channelId}.", ex);
        }
    }
}
