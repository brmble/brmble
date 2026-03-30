using Brmble.Server.Data;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Moderator;

public interface IModeratorService
{
    Task<IReadOnlyList<ModeratorRole>> GetRolesAsync();
    Task<ModeratorRole> CreateRoleAsync(string name, ModeratorPermissions permissions);
    Task UpdateRoleAsync(string id, string? name, ModeratorPermissions? permissions);
    Task DeleteRoleAsync(string id);
    
    Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetChannelModeratorsAsync(int channelId);
    Task<ModeratorAssignment> AssignModeratorAsync(string roleId, int channelId, int userId, int assignedBy);
    Task RemoveModeratorAsync(string assignmentId);
    Task CleanupChannelAssignmentsAsync(int channelId);
    
    Task<ModeratorPermissions> GetUserPermissionsForChannelAsync(int userId, int channelId);
}

public class ModeratorService : IModeratorService, IModeratorPermissionChecker
{
    private readonly ModeratorRoleRepository _roleRepo;
    private readonly ModeratorAssignmentRepository _assignmentRepo;
    private readonly SyncFailedAssignmentRepository _syncFailedRepo;
    private readonly IMumbleGroupSyncService _mumbleSync;
    private readonly ILogger<ModeratorService> _logger;

    public ModeratorService(
        ModeratorRoleRepository roleRepo,
        ModeratorAssignmentRepository assignmentRepo,
        SyncFailedAssignmentRepository syncFailedRepo,
        IMumbleGroupSyncService mumbleSync,
        ILogger<ModeratorService> logger)
    {
        _roleRepo = roleRepo;
        _assignmentRepo = assignmentRepo;
        _syncFailedRepo = syncFailedRepo;
        _mumbleSync = mumbleSync;
        _logger = logger;
    }

    public async Task<IReadOnlyList<ModeratorRole>> GetRolesAsync() => await _roleRepo.GetAllAsync();
    
    public async Task<ModeratorRole> CreateRoleAsync(string name, ModeratorPermissions permissions)
    {
        return await _roleRepo.CreateAsync(name, permissions);
    }
    
    public async Task UpdateRoleAsync(string id, string? name, ModeratorPermissions? permissions)
    {
        await _roleRepo.UpdateAsync(id, name, permissions);
    }
    
    public async Task DeleteRoleAsync(string id)
    {
        await _roleRepo.DeleteAsync(id);
    }

    public async Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetChannelModeratorsAsync(int channelId)
    {
        return await _assignmentRepo.GetByChannelAsync(channelId);
    }

    public async Task<ModeratorAssignment> AssignModeratorAsync(string roleId, int channelId, int userId, int assignedBy)
    {
        var assignment = await _assignmentRepo.CreateAsync(roleId, channelId, userId, assignedBy);
        
        var success = await _mumbleSync.SyncAssignmentAsync(assignment.Id, userId, channelId, add: true);
        if (!success)
        {
            _logger.LogWarning("Mumble sync failed for assignment {AssignmentId}, queuing for retry", assignment.Id);
            await _syncFailedRepo.AddAsync(assignment.Id, "add", "Initial sync failed");
        }
        
        return assignment;
    }

    public async Task RemoveModeratorAsync(string assignmentId)
    {
        var assignment = await _assignmentRepo.GetByIdAsync(assignmentId);
        if (assignment == null) return;

        var userId = assignment.UserId;
        var channelId = assignment.ChannelId;
        
        await _assignmentRepo.DeleteAsync(assignmentId);
        
        var success = await _mumbleSync.SyncAssignmentAsync(assignmentId, userId, channelId, add: false);
        if (!success)
        {
            _logger.LogWarning("Mumble sync removal failed for assignment {AssignmentId}, queuing for retry", assignmentId);
            await _syncFailedRepo.AddAsync(assignmentId, "remove", "Removal sync failed");
        }
    }

    public async Task CleanupChannelAssignmentsAsync(int channelId)
    {
        var assignments = await _assignmentRepo.GetByChannelAsync(channelId);
        
        await _assignmentRepo.DeleteByChannelAsync(channelId);
        
        foreach (var assignment in assignments)
        {
            var success = await _mumbleSync.SyncAssignmentAsync(assignment.Id, assignment.UserId, channelId, add: false);
            if (!success)
            {
                _logger.LogWarning("Mumble sync removal failed for assignment {AssignmentId} during channel cleanup, queuing for retry", assignment.Id);
                await _syncFailedRepo.AddAsync(assignment.Id, "remove", "Cleanup sync failed");
            }
        }
    }

    public async Task<ModeratorPermissions> GetUserPermissionsForChannelAsync(int userId, int channelId)
    {
        var assignment = await _assignmentRepo.GetByUserAndChannelAsync(userId, channelId);
        return assignment?.RolePermissions ?? ModeratorPermissions.None;
    }

    Task<ModeratorPermissions> IModeratorPermissionChecker.GetModeratorPermissionsAsync(int userId, int channelId)
    {
        return GetUserPermissionsForChannelAsync(userId, channelId);
    }
}
