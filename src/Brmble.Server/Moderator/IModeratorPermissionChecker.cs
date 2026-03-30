namespace Brmble.Server.Moderator;

public interface IModeratorPermissionChecker
{
    Task<ModeratorPermissions> GetModeratorPermissionsAsync(int userId, int channelId);
}
