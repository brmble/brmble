using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public interface IAclAuthorizationService
{
    Task<bool> CanManageChannelAclAsync(long userId, int channelId);
    Task<bool> CanModerateServerAsync(long userId);
}

public sealed class AclAuthorizationService : IAclAuthorizationService
{
    private readonly IMumbleAclService _aclService;
    private readonly ISessionMappingService _sessionMapping;

    public AclAuthorizationService(IMumbleAclService aclService, ISessionMappingService sessionMapping)
    {
        _aclService = aclService;
        _sessionMapping = sessionMapping;
    }

    public async Task<bool> CanManageChannelAclAsync(long userId, int channelId)
    {
        if (!_sessionMapping.TryGetSessionByUserId(userId, out var sessionId))
        {
            return false;
        }

        return await _aclService.HasWritePermissionAsync(sessionId, channelId);
    }

    public async Task<bool> CanModerateServerAsync(long userId)
    {
        if (!_sessionMapping.TryGetSessionByUserId(userId, out var sessionId)) return false;
        return await _aclService.HasPermissionAsync(sessionId, 0, MumbleServer.PermissionKick.value)
            || await _aclService.HasPermissionAsync(sessionId, 0, MumbleServer.PermissionBan.value);
    }
}
