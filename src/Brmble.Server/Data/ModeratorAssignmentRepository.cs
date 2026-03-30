using Dapper;
using Brmble.Server.Moderator;

namespace Brmble.Server.Data;

public class ModeratorAssignment
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string RoleId { get; set; } = string.Empty;
    public int ChannelId { get; set; }
    public int UserId { get; set; }
    public int AssignedBy { get; set; }
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
}

public class ModeratorAssignmentWithRole : ModeratorAssignment
{
    public string RoleName { get; set; } = string.Empty;
    public ModeratorPermissions RolePermissions { get; set; }
}

public class ModeratorAssignmentRepository
{
    private readonly Database _db;

    public ModeratorAssignmentRepository(Database db)
    {
        _db = db;
    }

    public async Task<ModeratorAssignment> CreateAsync(string roleId, int channelId, int userId, int assignedBy)
    {
        using var conn = _db.CreateConnection();
        var assignment = new ModeratorAssignment
        {
            RoleId = roleId,
            ChannelId = channelId,
            UserId = userId,
            AssignedBy = assignedBy
        };
        await conn.ExecuteAsync(
            @"INSERT INTO moderator_assignments (id, role_id, channel_id, user_id, assigned_by, assigned_at)
              VALUES (@Id, @RoleId, @ChannelId, @UserId, @AssignedBy, @AssignedAt)",
            assignment);
        return assignment;
    }

    public async Task<ModeratorAssignment?> GetByIdAsync(string id)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<ModeratorAssignment>(
            "SELECT * FROM moderator_assignments WHERE id = @Id", new { Id = id });
    }

    public async Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetByChannelAsync(int channelId)
    {
        using var conn = _db.CreateConnection();
        var result = await conn.QueryAsync<ModeratorAssignmentWithRole>(
            @"SELECT ma.id as Id, ma.role_id as RoleId, ma.channel_id as ChannelId, ma.user_id as UserId, ma.assigned_by as AssignedBy, ma.assigned_at as AssignedAt, mr.name as RoleName, mr.permissions as RolePermissions
              FROM moderator_assignments ma
              JOIN moderator_roles mr ON ma.role_id = mr.id
              WHERE ma.channel_id = @ChannelId
              ORDER BY mr.name, ma.assigned_at",
            new { ChannelId = channelId });
        return result.ToList();
    }

    public async Task<ModeratorAssignmentWithRole?> GetByUserAndChannelAsync(int userId, int channelId)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<ModeratorAssignmentWithRole>(
            @"SELECT ma.id as Id, ma.role_id as RoleId, ma.channel_id as ChannelId, ma.user_id as UserId, ma.assigned_by as AssignedBy, ma.assigned_at as AssignedAt, mr.name as RoleName, mr.permissions as RolePermissions
              FROM moderator_assignments ma
              JOIN moderator_roles mr ON ma.role_id = mr.id
              WHERE ma.user_id = @UserId AND ma.channel_id = @ChannelId",
            new { UserId = userId, ChannelId = channelId });
    }

    public async Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetByChannelAndUserIdsAsync(int channelId, IEnumerable<int> userIds)
    {
        using var conn = _db.CreateConnection();
        var result = await conn.QueryAsync<ModeratorAssignmentWithRole>(
            @"SELECT ma.id as Id, ma.role_id as RoleId, ma.channel_id as ChannelId, ma.user_id as UserId, ma.assigned_by as AssignedBy, ma.assigned_at as AssignedAt, mr.name as RoleName, mr.permissions as RolePermissions
              FROM moderator_assignments ma
              JOIN moderator_roles mr ON ma.role_id = mr.id
              WHERE ma.channel_id = @ChannelId AND ma.user_id IN @UserIds",
            new { ChannelId = channelId, UserIds = userIds.ToList() });
        return result.ToList();
    }

    public async Task DeleteAsync(string id)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("DELETE FROM moderator_assignments WHERE id = @Id", new { Id = id });
    }

    public async Task DeleteByChannelAsync(int channelId)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("DELETE FROM moderator_assignments WHERE channel_id = @ChannelId", new { ChannelId = channelId });
    }
}
