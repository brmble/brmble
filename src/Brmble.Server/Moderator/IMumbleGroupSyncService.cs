namespace Brmble.Server.Moderator;

public interface IMumbleGroupSyncService
{
    Task AddUserToChannelGroupAsync(int userId, int channelId);
    Task RemoveUserFromChannelGroupAsync(int userId, int channelId);
    Task<bool> SyncAssignmentAsync(string assignmentId, int userId, int channelId, bool add);
}
