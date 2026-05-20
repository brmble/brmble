namespace Brmble.Server.Mumble;

public sealed class MumbleAclIceClient : IMumbleAclIceClient
{
    private volatile MumbleServer.ServerPrx? _serverProxy;

    internal void SetServerProxy(MumbleServer.ServerPrx proxy) => _serverProxy = proxy;

    private MumbleServer.ServerPrx GetProxy()
    {
        return _serverProxy ?? throw new MumbleAclUnavailableException("Mumble ICE server proxy is not available.");
    }

    public Task<MumbleServer.Server_GetACLResult> GetAclAsync(int channelId)
        => GetProxy().getACLAsync(channelId);

    public Task SetAclAsync(int channelId, MumbleServer.ACL[] acls, MumbleServer.Group[] groups, bool inherit)
        => GetProxy().setACLAsync(channelId, acls, groups, inherit);

    public Task AddUserToGroupAsync(int channelId, int sessionId, string group)
        => GetProxy().addUserToGroupAsync(channelId, sessionId, group);

    public Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group)
        => GetProxy().removeUserFromGroupAsync(channelId, sessionId, group);

    public Task<bool> HasPermissionAsync(int sessionId, int channelId, int permission)
        => GetProxy().hasPermissionAsync(sessionId, channelId, permission);
}
