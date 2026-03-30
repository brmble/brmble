namespace Brmble.Server.Moderator;

public class PermissionEnforcer
{
    private readonly IModeratorPermissionChecker _permissionChecker;

    public PermissionEnforcer(IModeratorPermissionChecker permissionChecker)
    {
        _permissionChecker = permissionChecker;
    }

    public async Task<bool> HasModeratorPermissionAsync(int userId, int channelId, ModeratorPermissions required)
    {
        var permissions = await _permissionChecker.GetModeratorPermissionsAsync(userId, channelId);
        return permissions.HasFlag(required);
    }

    public async Task RequireModeratorPermissionAsync(int userId, int channelId, ModeratorPermissions required)
    {
        if (!await HasModeratorPermissionAsync(userId, channelId, required))
        {
            throw new UnauthorizedAccessException(
                $"User {userId} lacks required permission {required} for channel {channelId}");
        }
    }
}
