using Dapper;
using Brmble.Server.Moderator;

namespace Brmble.Server.Data;

public class ModeratorRole
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = string.Empty;
    public ModeratorPermissions Permissions { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class ModeratorRoleRepository
{
    private readonly Database _db;

    public ModeratorRoleRepository(Database db)
    {
        _db = db;
    }

    public async Task<ModeratorRole> CreateAsync(string name, ModeratorPermissions permissions)
    {
        using var conn = _db.CreateConnection();
        var role = new ModeratorRole { Name = name, Permissions = permissions };
        await conn.ExecuteAsync(
            "INSERT INTO moderator_roles (id, name, permissions, created_at, updated_at) VALUES (@Id, @Name, @Permissions, @CreatedAt, @UpdatedAt)",
            role);
        return role;
    }

    public async Task<ModeratorRole?> GetByIdAsync(string id)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<ModeratorRole>(
            "SELECT * FROM moderator_roles WHERE id = @Id", new { Id = id });
    }

    public async Task<IReadOnlyList<ModeratorRole>> GetAllAsync()
    {
        using var conn = _db.CreateConnection();
        var result = await conn.QueryAsync<ModeratorRole>("SELECT * FROM moderator_roles ORDER BY name");
        return result.ToList();
    }

    public async Task UpdateAsync(string id, string? name = null, ModeratorPermissions? permissions = null)
    {
        using var conn = _db.CreateConnection();
        var existing = await GetByIdAsync(id);
        if (existing == null) return;

        await conn.ExecuteAsync(
            "UPDATE moderator_roles SET name = @Name, permissions = @Permissions, updated_at = @UpdatedAt WHERE id = @Id",
            new { Id = id, Name = name ?? existing.Name, Permissions = permissions ?? existing.Permissions, UpdatedAt = DateTime.UtcNow });
    }

    public async Task DeleteAsync(string id)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("DELETE FROM moderator_roles WHERE id = @Id", new { Id = id });
    }
}
