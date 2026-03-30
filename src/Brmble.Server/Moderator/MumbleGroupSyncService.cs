using Microsoft.Extensions.Logging;
using Brmble.Server.Mumble;

namespace Brmble.Server.Moderator;

public class MumbleGroupSyncService : IMumbleGroupSyncService
{
    private readonly IMumbleRegistrationService _mumbleRegistration;
    private readonly ILogger<MumbleGroupSyncService> _logger;

    public MumbleGroupSyncService(
        IMumbleRegistrationService mumbleRegistration,
        ILogger<MumbleGroupSyncService> logger)
    {
        _mumbleRegistration = mumbleRegistration;
        _logger = logger;
    }

    private static string GetGroupName(int channelId) => $"brmble_mod_{channelId}";

    public Task AddUserToChannelGroupAsync(int userId, int channelId)
    {
        var groupName = GetGroupName(channelId);
        _logger.LogInformation("Adding user {UserId} to Mumble group {GroupName}", userId, groupName);
        
        // TODO: Implement actual Mumble ICE call to add user to ACL group
        // This requires looking up the Mumble ICE API for ACL group management
        
        _logger.LogDebug("Mumble group add: user {UserId} to group {GroupName} (stub)", userId, groupName);
        return Task.CompletedTask;
    }

    public Task RemoveUserFromChannelGroupAsync(int userId, int channelId)
    {
        var groupName = GetGroupName(channelId);
        _logger.LogInformation("Removing user {UserId} from Mumble group {GroupName}", userId, groupName);
        
        // TODO: Implement actual Mumble ICE call to remove user from ACL group
        
        _logger.LogDebug("Mumble group remove: user {UserId} from group {GroupName} (stub)", userId, groupName);
        return Task.CompletedTask;
    }

    public async Task<bool> SyncAssignmentAsync(string assignmentId, int userId, int channelId, bool add)
    {
        try
        {
            if (add)
            {
                await AddUserToChannelGroupAsync(userId, channelId);
            }
            else
            {
                await RemoveUserFromChannelGroupAsync(userId, channelId);
            }
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to sync assignment {AssignmentId} to Mumble", assignmentId);
            return false;
        }
    }
}
