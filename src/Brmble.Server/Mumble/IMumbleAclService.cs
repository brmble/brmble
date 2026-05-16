namespace Brmble.Server.Mumble;

public interface IMumbleAclService
{
    Task<AclChannelSnapshotDto> GetChannelAclAsync(int channelId);
    Task SetChannelAclAsync(int channelId, AclUpdateRequest request);
    Task AddUserToGroupAsync(int channelId, int sessionId, string group);
    Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group);
    Task<bool> HasWritePermissionAsync(int sessionId, int channelId);
}

public interface IMumbleAclIceClient
{
    Task<MumbleServer.Server_GetACLResult> GetAclAsync(int channelId);
    Task SetAclAsync(int channelId, MumbleServer.ACL[] acls, MumbleServer.Group[] groups, bool inherit);
    Task AddUserToGroupAsync(int channelId, int sessionId, string group);
    Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group);
    Task<bool> HasPermissionAsync(int sessionId, int channelId, int permission);
}

public sealed class MumbleAclException : Exception
{
    public MumbleAclException(string message, Exception? inner = null) : base(message, inner) { }
}

public sealed class MumbleAclUnavailableException : Exception
{
    public MumbleAclUnavailableException(string message) : base(message) { }
}
