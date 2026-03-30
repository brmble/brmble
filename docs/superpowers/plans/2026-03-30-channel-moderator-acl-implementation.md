# Channel Moderator ACL System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a channel-level moderator permission system where admins can assign users as moderators for specific voice channels with configurable powers (kick, deny-enter, rename, password, description).

**Architecture:** Dual-validation system using Brmble DB as source of truth with Mumble group sync for UI consistency. Admin actions bypass moderator permission checks. Failed Mumble syncs queue for retry.

**Tech Stack:** C# (.NET), SQLite (existing Database.cs pattern), MumbleSharp ICE, TypeScript/React frontend

---

## File Structure Overview

```
Brmble.Server/
├── Data/
│   ├── Database.cs              # Add new table migrations
│   ├── ModeratorRoleRepository.cs # NEW - CRUD for roles
│   └── ModeratorAssignmentRepository.cs # NEW - CRUD for assignments
├── Moderator/
│   ├── ModeratorService.cs      # NEW - Business logic
│   ├── MumbleGroupSyncService.cs # NEW - Sync to Mumble groups
│   ├── PermissionEnforcer.cs     # NEW - Dual-validation
│   └── ModeratorEndpoints.cs     # NEW - API endpoints
└── Program.cs                    # Register services

Brmble.Web/src/
├── hooks/
│   ├── useModeratorPermissions.ts # NEW - Check moderator permissions
│   └── useModeratorStore.ts     # NEW - Moderator roles/assignments state
├── components/
│   ├── ChannelEditModal/         # NEW - Edit window with tabs
│   │   ├── ChannelEditModal.tsx
│   │   ├── ManageModeratorsTab.tsx
│   │   └── ModeratorRoleModal.tsx
│   └── SettingsModal/
│       └── ModeratorRolesTab.tsx # NEW - Admin role management
└── bridge.ts                     # Add moderator handlers
```

---

## Task 1: Database Schema

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs:18-64`

- [ ] **Step 1: Add table migrations**

Add after existing migrations in `Database.cs`:

```csharp
// Migrate: add moderator_roles table
var hasModeratorRoles = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('moderator_roles') WHERE name='id'");
if (hasModeratorRoles == 0)
    conn.Execute("""
        CREATE TABLE moderator_roles (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            permissions INTEGER NOT NULL DEFAULT 0,
            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """);

// Migrate: add moderator_assignments table
var hasModeratorAssignments = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('moderator_assignments') WHERE name='id'");
if (hasModeratorAssignments == 0)
    conn.Execute("""
        CREATE TABLE moderator_assignments (
            id          TEXT PRIMARY KEY,
            role_id     TEXT NOT NULL,
            channel_id  INTEGER NOT NULL,
            user_id     INTEGER NOT NULL,
            assigned_by INTEGER NOT NULL,
            assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (role_id) REFERENCES moderator_roles(id) ON DELETE CASCADE,
            UNIQUE (channel_id, user_id)
        )
    """);

// Migrate: add sync_failed_assignments table for retry queue
var hasSyncFailed = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('sync_failed_assignments') WHERE name='id'");
if (hasSyncFailed == 0)
    conn.Execute("""
        CREATE TABLE sync_failed_assignments (
            id              TEXT PRIMARY KEY,
            assignment_id    TEXT NOT NULL,
            action          TEXT NOT NULL,
            error_message   TEXT,
            retry_count     INTEGER NOT NULL DEFAULT 0,
            next_retry_at   DATETIME NOT NULL,
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assignment_id) REFERENCES moderator_assignments(id) ON DELETE CASCADE
        )
    """);
```

- [ ] **Step 2: Add permission bit constants**

Add to `ModeratorPermissions.cs` (create new file):

```csharp
namespace Brmble.Server.Moderator;

[Flags]
public enum ModeratorPermission
{
    None = 0,
    Kick = 0x001,
    DenyEnter = 0x002,
    RenameChannel = 0x004,
    SetPassword = 0x008,
    EditDesc = 0x010,
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Data/Database.cs src/Brmble.Server/Moderator/ModeratorPermissions.cs
git commit -m "feat: add moderator ACL database tables"
```

---

## Task 2: Repository Layer

**Files:**
- Create: `src/Brmble.Server/Data/ModeratorRoleRepository.cs`
- Create: `src/Brmble.Server/Data/ModeratorAssignmentRepository.cs`
- Create: `src/Brmble.Server/Data/SyncFailedAssignmentRepository.cs`

- [ ] **Step 1: Write tests for ModeratorRoleRepository**

Create `tests/Brmble.Server.Tests/ModeratorRoleRepositoryTests.cs`:

```csharp
using Brmble.Server.Data;
using Brmble.Server.Moderator;
using Xunit;

namespace Brmble.Server.Tests;

public class ModeratorRoleRepositoryTests
{
    private readonly Database _db;
    private readonly ModeratorRoleRepository _repo;

    public ModeratorRoleRepositoryTests()
    {
        _db = new Database("DataSource=:memory:");
        _db.Initialize();
        _repo = new ModeratorRoleRepository(_db);
    }

    [Fact]
    public async Task CreateAsync_ReturnsRoleWithId()
    {
        var role = await _repo.CreateAsync("Test Role", ModeratorPermission.Kick | ModeratorPermission.DenyEnter);
        
        Assert.NotNull(role.Id);
        Assert.Equal("Test Role", role.Name);
        Assert.Equal(ModeratorPermission.Kick | ModeratorPermission.DenyEnter, role.Permissions);
    }

    [Fact]
    public async Task GetByIdAsync_ReturnsRole()
    {
        var created = await _repo.CreateAsync("Test Role", ModeratorPermission.Kick);
        var retrieved = await _repo.GetByIdAsync(created.Id);
        
        Assert.NotNull(retrieved);
        Assert.Equal(created.Id, retrieved.Id);
        Assert.Equal("Test Role", retrieved.Name);
    }

    [Fact]
    public async Task GetAllAsync_ReturnsAllRoles()
    {
        await _repo.CreateAsync("Role 1", ModeratorPermission.Kick);
        await _repo.CreateAsync("Role 2", ModeratorPermission.DenyEnter);
        
        var roles = await _repo.GetAllAsync();
        
        Assert.Equal(2, roles.Count);
    }

    [Fact]
    public async Task UpdateAsync_ModifiesRole()
    {
        var role = await _repo.CreateAsync("Original", ModeratorPermission.Kick);
        await _repo.UpdateAsync(role.Id, "Updated", ModeratorPermission.DenyEnter);
        
        var updated = await _repo.GetByIdAsync(role.Id);
        Assert.Equal("Updated", updated?.Name);
        Assert.Equal(ModeratorPermission.DenyEnter, updated?.Permissions);
    }

    [Fact]
    public async Task DeleteAsync_RemovesRole()
    {
        var role = await _repo.CreateAsync("To Delete", ModeratorPermission.Kick);
        await _repo.DeleteAsync(role.Id);
        
        var deleted = await _repo.GetByIdAsync(role.Id);
        Assert.Null(deleted);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ModeratorRoleRepositoryTests"
```

Expected: FAIL (types not defined)

- [ ] **Step 3: Implement ModeratorRoleRepository**

Create `src/Brmble.Server/Data/ModeratorRoleRepository.cs`:

```csharp
using Dapper;
using Brmble.Server.Moderator;

namespace Brmble.Server.Data;

public class ModeratorRole
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = string.Empty;
    public ModeratorPermission Permissions { get; set; }
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

    public async Task<ModeratorRole> CreateAsync(string name, ModeratorPermission permissions)
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

    public async Task UpdateAsync(string id, string? name = null, ModeratorPermission? permissions = null)
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ModeratorRoleRepositoryTests"
```

Expected: PASS

- [ ] **Step 5: Write tests for ModeratorAssignmentRepository**

Create `tests/Brmble.Server.Tests/ModeratorAssignmentRepositoryTests.cs`:

```csharp
using Brmble.Server.Data;
using Brmble.Server.Moderator;
using Xunit;

namespace Brmble.Server.Tests;

public class ModeratorAssignmentRepositoryTests
{
    private readonly Database _db;
    private readonly ModeratorRoleRepository _roleRepo;
    private readonly ModeratorAssignmentRepository _repo;

    public ModeratorAssignmentRepositoryTests()
    {
        _db = new Database("DataSource=:memory:");
        _db.Initialize();
        _roleRepo = new ModeratorRoleRepository(_db);
        _repo = new ModeratorAssignmentRepository(_db);
    }

    [Fact]
    public async Task CreateAsync_ReturnsAssignment()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermission.Kick);
        var assignment = await _repo.CreateAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);
        
        Assert.NotNull(assignment.Id);
        Assert.Equal(role.Id, assignment.RoleId);
        Assert.Equal(5, assignment.ChannelId);
        Assert.Equal(123, assignment.UserId);
    }

    [Fact]
    public async Task GetByChannelAsync_ReturnsAssignmentsForChannel()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermission.Kick);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 1, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 2, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 6, userId: 1, assignedBy: 1);
        
        var channel5Assignments = await _repo.GetByChannelAsync(5);
        
        Assert.Equal(2, channel5Assignments.Count);
    }

    [Fact]
    public async Task GetByUserAndChannelAsync_ReturnsSpecificAssignment()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermission.Kick);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);
        
        var assignment = await _repo.GetByUserAndChannelAsync(userId: 123, channelId: 5);
        
        Assert.NotNull(assignment);
        Assert.Equal(123, assignment.UserId);
    }

    [Fact]
    public async Task DeleteAsync_RemovesAssignment()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermission.Kick);
        var assignment = await _repo.CreateAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);
        await _repo.DeleteAsync(assignment.Id);
        
        var deleted = await _repo.GetByIdAsync(assignment.Id);
        Assert.Null(deleted);
    }

    [Fact]
    public async Task GetByChannelAndUserIdsAsync_ReturnsMatchingAssignments()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermission.Kick);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 1, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 2, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 6, userId: 3, assignedBy: 1);
        
        var assignments = await _repo.GetByChannelAndUserIdsAsync(5, new[] { 1, 2, 3 });
        
        Assert.Equal(2, assignments.Count);
    }
}
```

- [ ] **Step 6: Implement ModeratorAssignmentRepository**

Create `src/Brmble.Server/Data/ModeratorAssignmentRepository.cs`:

```csharp
using Dapper;

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
    public ModeratorPermission RolePermissions { get; set; }
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
            @"SELECT ma.*, mr.name as RoleName, mr.permissions as RolePermissions
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
            @"SELECT ma.*, mr.name as RoleName, mr.permissions as RolePermissions
              FROM moderator_assignments ma
              JOIN moderator_roles mr ON ma.role_id = mr.id
              WHERE ma.user_id = @UserId AND ma.channel_id = @ChannelId",
            new { UserId = userId, ChannelId = channelId });
    }

    public async Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetByChannelAndUserIdsAsync(int channelId, IEnumerable<int> userIds)
    {
        using var conn = _db.CreateConnection();
        var result = await conn.QueryAsync<ModeratorAssignmentWithRole>(
            @"SELECT ma.*, mr.name as RoleName, mr.permissions as RolePermissions
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
```

- [ ] **Step 7: Run assignment tests to verify they pass**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ModeratorAssignmentRepositoryTests"
```

Expected: PASS

- [ ] **Step 8: Implement SyncFailedAssignmentRepository (minimal for retry queue)**

Create `src/Brmble.Server/Data/SyncFailedAssignmentRepository.cs`:

```csharp
using Dapper;

namespace Brmble.Server.Data;

public class SyncFailedAssignment
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string AssignmentId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty; // "add" or "remove"
    public string? ErrorMessage { get; set; }
    public int RetryCount { get; set; }
    public DateTime NextRetryAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class SyncFailedAssignmentRepository
{
    private readonly Database _db;
    private static readonly int[] RetryDelays = { 30, 60, 120, 240, 480 }; // seconds

    public SyncFailedAssignmentRepository(Database db)
    {
        _db = db;
    }

    public async Task AddAsync(string assignmentId, string action, string errorMessage)
    {
        using var conn = _db.CreateConnection();
        var failed = new SyncFailedAssignment
        {
            AssignmentId = assignmentId,
            Action = action,
            ErrorMessage = errorMessage,
            RetryCount = 0,
            NextRetryAt = DateTime.UtcNow.AddSeconds(RetryDelays[0])
        };
        await conn.ExecuteAsync(
            @"INSERT INTO sync_failed_assignments (id, assignment_id, action, error_message, retry_count, next_retry_at, created_at)
              VALUES (@Id, @AssignmentId, @Action, @ErrorMessage, @RetryCount, @NextRetryAt, @CreatedAt)",
            failed);
    }

    public async Task<IReadOnlyList<SyncFailedAssignment>> GetPendingAsync()
    {
        using var conn = _db.CreateConnection();
        var result = await conn.QueryAsync<SyncFailedAssignment>(
            "SELECT * FROM sync_failed_assignments WHERE next_retry_at <= @Now ORDER BY next_retry_at",
            new { Now = DateTime.UtcNow });
        return result.ToList();
    }

    public async Task IncrementRetryAsync(string id, string errorMessage)
    {
        using var conn = _db.CreateConnection();
        var existing = await conn.QuerySingleOrDefaultAsync<SyncFailedAssignment>(
            "SELECT * FROM sync_failed_assignments WHERE id = @Id", new { Id = id });
        if (existing == null) return;

        var nextDelayIndex = Math.Min(existing.RetryCount, RetryDelays.Length - 1);
        var nextRetryAt = DateTime.UtcNow.AddSeconds(RetryDelays[nextDelayIndex]);
        var retryCount = existing.RetryCount + 1;

        await conn.ExecuteAsync(
            @"UPDATE sync_failed_assignments SET retry_count = @RetryCount, next_retry_at = @NextRetryAt, error_message = @ErrorMessage
              WHERE id = @Id",
            new { Id = id, RetryCount = retryCount, NextRetryAt = nextRetryAt, ErrorMessage = errorMessage });
    }

    public async Task RemoveAsync(string id)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("DELETE FROM sync_failed_assignments WHERE id = @Id", new { Id = id });
    }
}
```

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Server/Data/ModeratorRoleRepository.cs src/Brmble.Server/Data/ModeratorAssignmentRepository.cs src/Brmble.Server/Data/SyncFailedAssignmentRepository.cs
git commit -m "feat: add moderator repositories"
```

---

## Task 3: Mumble Group Sync Service

**Files:**
- Create: `src/Brmble.Server/Moderator/MumbleGroupSyncService.cs`
- Modify: `src/Brmble.Server/Program.cs` (register service)

- [ ] **Step 1: Write interface**

Create `src/Brmble.Server/Moderator/IMumbleGroupSyncService.cs`:

```csharp
namespace Brmble.Server.Moderator;

public interface IMumbleGroupSyncService
{
    Task AddUserToChannelGroupAsync(int userId, int channelId);
    Task RemoveUserFromChannelGroupAsync(int userId, int channelId);
    Task<bool> SyncAssignmentAsync(string assignmentId, int userId, int channelId, bool add);
}
```

- [ ] **Step 2: Implement MumbleGroupSyncService**

Create `src/Brmble.Server/Moderator/MumbleGroupSyncService.cs`:

```csharp
using Microsoft.Extensions.Logging;

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

    public async Task AddUserToChannelGroupAsync(int userId, int channelId)
    {
        var groupName = GetGroupName(channelId);
        _logger.LogInformation("Adding user {UserId} to Mumble group {GroupName}", userId, groupName);
        
        // TODO: Implement actual Mumble ICE call to add user to ACL group
        // This requires looking up the Mumble ICE API for ACL group management
        // Expected call pattern similar to MumbleRegistrationService
        
        _logger.LogDebug("Mumble group add: user {UserId} to group {GroupName} (stub)", userId, groupName);
    }

    public async Task RemoveUserFromChannelGroupAsync(int userId, int channelId)
    {
        var groupName = GetGroupName(channelId);
        _logger.LogInformation("Removing user {UserId} from Mumble group {GroupName}", userId, groupName);
        
        // TODO: Implement actual Mumble ICE call to remove user from ACL group
        
        _logger.LogDebug("Mumble group remove: user {UserId} from group {GroupName} (stub)", userId, groupName);
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
```

- [ ] **Step 3: Register service in Program.cs**

Find the service registration section in `Program.cs` and add:

```csharp
services.AddSingleton<IMumbleGroupSyncService, MumbleGroupSyncService>();
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Server/Moderator/MumbleGroupSyncService.cs src/Brmble.Server/Program.cs
git commit -m "feat: add Mumble group sync service"
```

---

## Task 4: Permission Enforcer Service

**Files:**
- Create: `src/Brmble.Server/Moderator/PermissionEnforcer.cs`
- Create: `src/Brmble.Server/Moderator/ModeratorService.cs`

- [ ] **Step 1: Write tests for PermissionEnforcer**

Create `tests/Brmble.Server.Tests/PermissionEnforcerTests.cs`:

```csharp
using Brmble.Server.Data;
using Brmble.Server.Moderator;
using Moq;
using Xunit;

namespace Brmble.Server.Tests;

public class PermissionEnforcerTests
{
    private readonly Mock<IModeratorPermissionChecker> _checkerMock;
    private readonly PermissionEnforcer _enforcer;

    public PermissionEnforcerTests()
    {
        _checkerMock = new Mock<IModeratorPermissionChecker>();
        _enforcer = new PermissionEnforcer(_checkerMock.Object);
    }

    [Fact]
    public async Task HasModeratorPermission_ReturnsTrue_WhenUserHasPermission()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermission.Kick | ModeratorPermission.DenyEnter);

        var result = await _enforcer.HasModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermission.Kick);

        Assert.True(result);
    }

    [Fact]
    public async Task HasModeratorPermission_ReturnsFalse_WhenUserLacksPermission()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermission.Kick);

        var result = await _enforcer.HasModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermission.DenyEnter);

        Assert.False(result);
    }

    [Fact]
    public async Task HasModeratorPermission_ReturnsFalse_WhenUserHasNoModeratorRole()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermission.None);

        var result = await _enforcer.HasModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermission.Kick);

        Assert.False(result);
    }

    [Fact]
    public async Task RequireModeratorPermission_Throws_WhenUserLacksPermission()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermission.None);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => _enforcer.RequireModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermission.Kick));
    }
}
```

- [ ] **Step 2: Define IModeratorPermissionChecker**

Create `src/Brmble.Server/Moderator/IModeratorPermissionChecker.cs`:

```csharp
namespace Brmble.Server.Moderator;

public interface IModeratorPermissionChecker
{
    Task<ModeratorPermission> GetModeratorPermissionsAsync(int userId, int channelId);
}
```

- [ ] **Step 3: Implement PermissionEnforcer**

Create `src/Brmble.Server/Moderator/PermissionEnforcer.cs`:

```csharp
namespace Brmble.Server.Moderator;

public class PermissionEnforcer
{
    private readonly IModeratorPermissionChecker _permissionChecker;

    public PermissionEnforcer(IModeratorPermissionChecker permissionChecker)
    {
        _permissionChecker = permissionChecker;
    }

    public async Task<bool> HasModeratorPermissionAsync(int userId, int channelId, ModeratorPermission required)
    {
        var permissions = await _permissionChecker.GetModeratorPermissionsAsync(userId, channelId);
        return permissions.HasFlag(required);
    }

    public async Task RequireModeratorPermissionAsync(int userId, int channelId, ModeratorPermission required)
    {
        if (!await HasModeratorPermissionAsync(userId, channelId, required))
        {
            throw new UnauthorizedAccessException(
                $"User {userId} lacks required permission {required} for channel {channelId}");
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "PermissionEnforcerTests"
```

Expected: PASS

- [ ] **Step 5: Implement ModeratorService (business logic combining repositories, sync, enforcer)**

Create `src/Brmble.Server/Moderator/ModeratorService.cs`:

```csharp
using Brmble.Server.Data;

namespace Brmble.Server.Moderator;

public interface IModeratorService
{
    // Role management
    Task<IReadOnlyList<ModeratorRole>> GetRolesAsync();
    Task<ModeratorRole> CreateRoleAsync(string name, ModeratorPermission permissions);
    Task UpdateRoleAsync(string id, string? name, ModeratorPermission? permissions);
    Task DeleteRoleAsync(string id);
    
    // Assignment management
    Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetChannelModeratorsAsync(int channelId);
    Task<ModeratorAssignment> AssignModeratorAsync(string roleId, int channelId, int userId, int assignedBy);
    Task RemoveModeratorAsync(string assignmentId);
    Task CleanupChannelAssignmentsAsync(int channelId);
    
    // Permission checking
    Task<ModeratorPermission> GetUserPermissionsForChannelAsync(int userId, int channelId);
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

    // Role management
    public async Task<IReadOnlyList<ModeratorRole>> GetRolesAsync() => await _roleRepo.GetAllAsync();
    
    public async Task<ModeratorRole> CreateRoleAsync(string name, ModeratorPermission permissions)
    {
        return await _roleRepo.CreateAsync(name, permissions);
    }
    
    public async Task UpdateRoleAsync(string id, string? name, ModeratorPermission? permissions)
    {
        await _roleRepo.UpdateAsync(id, name, permissions);
    }
    
    public async Task DeleteRoleAsync(string id)
    {
        await _roleRepo.DeleteAsync(id);
    }

    // Assignment management
    public async Task<IReadOnlyList<ModeratorAssignmentWithRole>> GetChannelModeratorsAsync(int channelId)
    {
        return await _assignmentRepo.GetByChannelAsync(channelId);
    }

    public async Task<ModeratorAssignment> AssignModeratorAsync(string roleId, int channelId, int userId, int assignedBy)
    {
        var assignment = await _assignmentRepo.CreateAsync(roleId, channelId, userId, assignedBy);
        
        // Sync to Mumble
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
        
        // Sync removal to Mumble
        var success = await _mumbleSync.SyncAssignmentAsync(assignmentId, userId, channelId, add: false);
        if (!success)
        {
            _logger.LogWarning("Mumble sync removal failed for assignment {AssignmentId}, queuing for retry", assignmentId);
            await _syncFailedRepo.AddAsync(assignmentId, "remove", "Removal sync failed");
        }
    }

    public async Task CleanupChannelAssignmentsAsync(int channelId)
    {
        // Get assignments before deletion for Mumble cleanup
        var assignments = await _assignmentRepo.GetByChannelAsync(channelId);
        
        await _assignmentRepo.DeleteByChannelAsync(channelId);
        
        // Sync removals to Mumble
        foreach (var assignment in assignments)
        {
            var success = await _mumbleSync.SyncAssignmentAsync(assignment.Id, assignment.UserId, channelId, add: false);
            if (!success)
            {
                await _syncFailedRepo.AddAsync(assignment.Id, "remove", "Cleanup sync failed");
            }
        }
    }

    // Permission checking
    public async Task<ModeratorPermission> GetUserPermissionsForChannelAsync(int userId, int channelId)
    {
        var assignment = await _assignmentRepo.GetByUserAndChannelAsync(userId, channelId);
        return assignment?.RolePermissions ?? ModeratorPermission.None;
    }

    Task<ModeratorPermission> IModeratorPermissionChecker.GetModeratorPermissionsAsync(int userId, int channelId)
    {
        return GetUserPermissionsForChannelAsync(userId, channelId);
    }
}
```

- [ ] **Step 6: Register ModeratorService in Program.cs**

Find service registration section and add:

```csharp
services.AddSingleton<ModeratorRoleRepository>();
services.AddSingleton<ModeratorAssignmentRepository>();
services.AddSingleton<SyncFailedAssignmentRepository>();
services.AddSingleton<IModeratorService, ModeratorService>();
services.AddSingleton<IModeratorPermissionChecker>(sp => sp.GetRequiredService<IModeratorService>());
services.AddSingleton<PermissionEnforcer>();
```

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Moderator/ModeratorService.cs src/Brmble.Server/Moderator/PermissionEnforcer.cs
git commit -m "feat: add moderator service and permission enforcer"
```

---

## Task 5: API Endpoints

**Files:**
- Create: `src/Brmble.Server/Moderator/ModeratorEndpoints.cs`
- Modify: `src/Brmble.Server/Program.cs` (register endpoints)

- [ ] **Step 1: Implement ModeratorEndpoints**

Create `src/Brmble.Server/Moderator/ModeratorEndpoints.cs`:

```csharp
using Brmble.Server.Data;

namespace Brmble.Server.Moderator;

public static class ModeratorEndpoints
{
    public static IEndpointRouteBuilder MapModeratorEndpoints(this IEndpointRouteBuilder app)
    {
        // Role management (admin only - add admin auth check)
        app.MapGet("/api/admin/moderator-roles", async (IModeratorService moderatorService) =>
        {
            var roles = await moderatorService.GetRolesAsync();
            return Results.Ok(roles.Select(r => new
            {
                r.Id,
                r.Name,
                Permissions = (int)r.Permissions
            }));
        });

        app.MapPost("/api/admin/moderator-roles", async (
            IModeratorService moderatorService,
            CreateRoleRequest request) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
                return Results.BadRequest("Role name is required");
            
            var role = await moderatorService.CreateRoleAsync(request.Name, request.Permissions);
            return Results.Created($"/api/admin/moderator-roles/{role.Id}", new
            {
                role.Id,
                role.Name,
                Permissions = (int)role.Permissions
            });
        });

        app.MapPut("/api/admin/moderator-roles/{id}", async (
            IModeratorService moderatorService,
            string id,
            UpdateRoleRequest request) =>
        {
            await moderatorService.UpdateRoleAsync(id, request.Name, request.Permissions);
            return Results.NoContent();
        });

        app.MapDelete("/api/admin/moderator-roles/{id}", async (
            IModeratorService moderatorService,
            string id) =>
        {
            await moderatorService.DeleteRoleAsync(id);
            return Results.NoContent();
        });

        // Assignment management
        app.MapGet("/api/channels/{channelId}/moderators", async (
            IModeratorService moderatorService,
            int channelId) =>
        {
            var moderators = await moderatorService.GetChannelModeratorsAsync(channelId);
            return Results.Ok(moderators.Select(m => new
            {
                m.Id,
                m.UserId,
                m.RoleId,
                m.RoleName,
                m.RolePermissions,
                m.AssignedAt
            }));
        });

        app.MapPost("/api/channels/{channelId}/moderators", async (
            IModeratorService moderatorService,
            int channelId,
            CreateAssignmentRequest request) =>
        {
            if (string.IsNullOrWhiteSpace(request.RoleId))
                return Results.BadRequest("Role ID is required");
            
            // assignedBy should come from auth context - using 0 for now as placeholder
            var assignment = await moderatorService.AssignModeratorAsync(
                request.RoleId, channelId, request.UserId, assignedBy: 0);
            
            return Results.Created($"/api/channels/{channelId}/moderators/{assignment.Id}", new
            {
                assignment.Id,
                assignment.UserId,
                assignment.RoleId,
                assignment.AssignedAt
            });
        });

        app.MapDelete("/api/channels/{channelId}/moderators/{assignmentId}", async (
            IModeratorService moderatorService,
            int channelId,
            string assignmentId) =>
        {
            await moderatorService.RemoveModeratorAsync(assignmentId);
            return Results.NoContent();
        });

        return app;
    }
}

public record CreateRoleRequest(string Name, ModeratorPermission Permissions);
public record UpdateRoleRequest(string? Name, ModeratorPermission? Permissions);
public record CreateAssignmentRequest(string RoleId, int UserId);
```

- [ ] **Step 2: Register endpoints in Program.cs**

Find endpoint registration and add:

```csharp
app.MapModeratorEndpoints();
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Moderator/ModeratorEndpoints.cs src/Brmble.Server/Program.cs
git commit -m "feat: add moderator API endpoints"
```

---

## Task 6: Frontend - Permission Hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useModeratorPermissions.ts`
- Modify: `src/Brmble.Web/src/bridge.ts`

- [ ] **Step 1: Implement useModeratorPermissions hook**

Create `src/Brmble.Web/src/hooks/useModeratorPermissions.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import bridge from '../bridge';

export interface ModeratorRole {
  id: string;
  name: string;
  permissions: number;
}

export interface ModeratorAssignment {
  id: string;
  userId: number;
  roleId: string;
  roleName: string;
  rolePermissions: number;
  assignedAt: string;
}

export const ModeratorPermission = {
  Kick: 0x001,
  DenyEnter: 0x002,
  RenameChannel: 0x004,
  SetPassword: 0x008,
  EditDesc: 0x010,
} as const;

export function useModeratorPermissions(channelId: number | null) {
  const [roles, setRoles] = useState<ModeratorRole[]>([]);
  const [moderators, setModerators] = useState<ModeratorAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserPermissions, setCurrentUserPermissions] = useState<number>(0);

  const loadRoles = useCallback(() => {
    bridge.send('moderator.getRoles');
  }, []);

  const loadModerators = useCallback((chId: number) => {
    setLoading(true);
    bridge.send('moderator.getChannelModerators', { channelId: chId });
  }, []);

  const createRole = useCallback((name: string, permissions: number) => {
    bridge.send('moderator.createRole', { name, permissions });
  }, []);

  const updateRole = useCallback((id: string, name?: string, permissions?: number) => {
    bridge.send('moderator.updateRole', { id, name, permissions });
  }, []);

  const deleteRole = useCallback((id: string) => {
    bridge.send('moderator.deleteRole', { id });
  }, []);

  const assignModerator = useCallback((roleId: string, userId: number) => {
    if (channelId === null) return;
    bridge.send('moderator.assign', { channelId, roleId, userId });
  }, [channelId]);

  const removeModerator = useCallback((assignmentId: string) => {
    if (channelId === null) return;
    bridge.send('moderator.remove', { channelId, assignmentId });
  }, [channelId]);

  useEffect(() => {
    const handleRoles = (data: unknown) => {
      setRoles(data as ModeratorRole[]);
    };

    const handleModerators = (data: unknown) => {
      setModerators(data as ModeratorAssignment[]);
      setLoading(false);
    };

    const handleCurrentUserPermissions = (data: unknown) => {
      const payload = data as { channelId: number; permissions: number };
      if (channelId !== null && payload.channelId === channelId) {
        setCurrentUserPermissions(payload.permissions);
      }
    };

    bridge.on('moderator.roles', handleRoles);
    bridge.on('moderator.channelModerators', handleModerators);
    bridge.on('moderator.currentUserPermissions', handleCurrentUserPermissions);

    loadRoles();

    return () => {
      bridge.off('moderator.roles', handleRoles);
      bridge.off('moderator.channelModerators', handleModerators);
      bridge.off('moderator.currentUserPermissions', handleCurrentUserPermissions);
    };
  }, [loadRoles]);

  useEffect(() => {
    if (channelId !== null) {
      loadModerators(channelId);
      bridge.send('moderator.getCurrentUserPermissions', { channelId });
    }
  }, [channelId, loadModerators]);

  const hasPermission = useCallback((permission: number): boolean => {
    return (currentUserPermissions & permission) !== 0;
  }, [currentUserPermissions]);

  const hasAnyModeratorRole = currentUserPermissions > 0;

  return {
    roles,
    moderators,
    loading,
    currentUserPermissions,
    hasPermission,
    hasAnyModeratorRole,
    loadRoles,
    loadModerators,
    createRole,
    updateRole,
    deleteRole,
    assignModerator,
    removeModerator,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Web/src/hooks/useModeratorPermissions.ts
git commit -m "feat: add useModeratorPermissions hook"
```

---

## Task 7: Frontend - Manage Moderators Tab Component

**Files:**
- Create: `src/Brmble.Web/src/components/ManageModeratorsTab/ManageModeratorsTab.tsx`
- Create: `src/Brmble.Web/src/components/ManageModeratorsTab/ManageModeratorsTab.css`
- Create: `src/Brmble.Web/src/components/ManageModeratorsTab/ModeratorRoleModal.tsx`

- [ ] **Step 1: Implement ManageModeratorsTab**

Create `src/Brmble.Web/src/components/ManageModeratorsTab/ManageModeratorsTab.tsx`:

```typescript
import { useState } from 'react';
import { useModeratorPermissions, ModeratorPermission } from '../../hooks/useModeratorPermissions';
import bridge from '../../bridge';
import { prompt, confirm } from '../../hooks/usePrompt';
import './ManageModeratorsTab.css';

interface ManageModeratorsTabProps {
  channelId: number;
  isAdmin: boolean;
}

export function ManageModeratorsTab({ channelId, isAdmin }: ManageModeratorsTabProps) {
  const {
    roles,
    moderators,
    loading,
    hasAnyModeratorRole,
    createRole,
    updateRole,
    deleteRole,
    assignModerator,
    removeModerator,
  } = useModeratorPermissions(channelId);

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<{ id: string; name: string; permissions: number } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');

  const canEdit = isAdmin;

  const handleAddModerator = async () => {
    const userIdStr = await prompt({
      title: 'Add Moderator',
      message: 'Enter the user ID to assign as moderator:',
      placeholder: 'User ID',
    });
    if (userIdStr === null) return;

    const userId = parseInt(userIdStr, 10);
    if (isNaN(userId)) {
      alert('Invalid user ID');
      return;
    }

    const roleId = await prompt({
      title: 'Select Role',
      message: 'Select a role for this moderator:',
      options: roles.map(r => ({ label: r.name, value: r.id })),
    });
    if (!roleId) return;

    assignModerator(roleId, userId);
  };

  const handleRemoveModerator = async (assignmentId: string, userId: number) => {
    const confirmed = await confirm({
      title: 'Remove Moderator',
      message: `Remove moderator (User ID: ${userId}) from this channel?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;

    removeModerator(assignmentId);
  };

  const handleCreateRole = () => {
    setEditingRole(null);
    setShowRoleModal(true);
  };

  const handleEditRole = (role: { id: string; name: string; permissions: number }) => {
    setEditingRole(role);
    setShowRoleModal(true);
  };

  const handleSaveRole = (name: string, permissions: number) => {
    if (editingRole) {
      updateRole(editingRole.id, name, permissions);
    } else {
      createRole(name, permissions);
    }
    setShowRoleModal(false);
  };

  const handleDeleteRole = async (roleId: string, roleName: string) => {
    const confirmed = await confirm({
      title: 'Delete Role',
      message: `Delete role "${roleName}"? This will remove all assignments using this role.`,
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    deleteRole(roleId);
  };

  const getPermissionLabel = (perm: number): string => {
    switch (perm) {
      case ModeratorPermission.Kick: return 'Kick';
      case ModeratorPermission.DenyEnter: return 'Deny Enter';
      case ModeratorPermission.RenameChannel: return 'Rename Channel';
      case ModeratorPermission.SetPassword: return 'Set Password';
      case ModeratorPermission.EditDesc: return 'Edit Description';
      default: return 'Unknown';
    }
  };

  const renderPermission = (perm: number, checked: boolean) => (
    <span key={perm} className={`permission-badge ${checked ? 'granted' : ''}`}>
      {checked ? '✓' : '✗'} {getPermissionLabel(perm)}
    </span>
  );

  return (
    <div className="manage-moderators-tab">
      {!canEdit && !hasAnyModeratorRole && (
        <div className="moderator-view-only-banner">
          View only — Contact an admin to modify moderator settings.
        </div>
      )}

      {!canEdit && hasAnyModeratorRole && (
        <div className="moderator-view-banner">
          You are a moderator of this channel.
        </div>
      )}

      <div className="moderators-section">
        <div className="section-header">
          <h4 className="heading-label">Channel Moderators</h4>
          {canEdit && (
            <button className="btn btn-primary btn-sm" onClick={handleAddModerator}>
              Add Moderator
            </button>
          )}
        </div>

        {loading && <div className="loading">Loading...</div>}

        {!loading && moderators.length === 0 && (
          <div className="empty-state">No moderators assigned to this channel.</div>
        )}

        {!loading && moderators.length > 0 && (
          <div className="moderator-list">
            {moderators.map(mod => (
              <div key={mod.id} className="moderator-row">
                <div className="moderator-info">
                  <span className="moderator-user-id">User #{mod.userId}</span>
                  <span className="moderator-role-name">{mod.roleName}</span>
                  <div className="moderator-permissions">
                    {[ModeratorPermission.Kick, ModeratorPermission.DenyEnter, ModeratorPermission.RenameChannel, ModeratorPermission.SetPassword, ModeratorPermission.EditDesc].map(perm =>
                      renderPermission(perm, (mod.rolePermissions & perm) !== 0)
                    )}
                  </div>
                </div>
                {canEdit && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleRemoveModerator(mod.id, mod.userId)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="roles-section">
          <div className="section-header">
            <h4 className="heading-label">Moderator Roles</h4>
            <button className="btn btn-secondary btn-sm" onClick={handleCreateRole}>
              Create Role
            </button>
          </div>

          {roles.length === 0 && (
            <div className="empty-state">No roles defined. Create one to get started.</div>
          )}

          {roles.length > 0 && (
            <div className="role-list">
              {roles.map(role => (
                <div key={role.id} className="role-row">
                  <div className="role-info">
                    <span className="role-name">{role.name}</span>
                    <div className="role-permissions">
                      {[ModeratorPermission.Kick, ModeratorPermission.DenyEnter, ModeratorPermission.RenameChannel, ModeratorPermission.SetPassword, ModeratorPermission.EditDesc].map(perm =>
                        renderPermission(perm, (role.permissions & perm) !== 0)
                      )}
                    </div>
                  </div>
                  <div className="role-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEditRole(role)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteRole(role.id, role.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRoleModal && (
        <ModeratorRoleModal
          role={editingRole}
          onSave={handleSaveRole}
          onClose={() => setShowRoleModal(false)}
        />
      )}
    </div>
  );
}

function ModeratorRoleModal({
  role,
  onSave,
  onClose,
}: {
  role: { id: string; name: string; permissions: number } | null;
  onSave: (name: string, permissions: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [permissions, setPermissions] = useState(role?.permissions ?? 0);

  const togglePermission = (perm: number) => {
    setPermissions(prev => prev ^ perm);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name, permissions);
  };

  const permissionItems = [
    { perm: ModeratorPermission.Kick, label: 'Kick users from channel' },
    { perm: ModeratorPermission.DenyEnter, label: 'Deny user from entering channel' },
    { perm: ModeratorPermission.RenameChannel, label: 'Rename channel' },
    { perm: ModeratorPermission.SetPassword, label: 'Set/change channel password' },
    { perm: ModeratorPermission.EditDesc, label: 'Edit channel description' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prompt glass-panel animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">
            {role ? 'Edit Role' : 'Create Role'}
          </h2>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Role Name</label>
            <input
              type="text"
              className="brmble-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter role name..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Permissions</label>
            <div className="permission-checkboxes">
              {permissionItems.map(({ perm, label }) => (
                <label key={perm} className="permission-checkbox">
                  <input
                    type="checkbox"
                    checked={(permissions & perm) !== 0}
                    onChange={() => togglePermission(perm)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="prompt-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CSS**

Create `src/Brmble.Web/src/components/ManageModeratorsTab/ManageModeratorsTab.css`:

```css
.manage-moderators-tab {
  padding: var(--spacing-md);
}

.moderator-view-only-banner,
.moderator-view-banner {
  padding: var(--spacing-sm) var(--spacing-md);
  margin-bottom: var(--spacing-md);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.moderator-view-only-banner {
  background: var(--color-warning-bg, rgba(255, 193, 7, 0.1));
  border: 1px solid var(--color-warning, #ffc107);
  color: var(--color-warning-text, #856404);
}

.moderator-view-banner {
  background: var(--color-info-bg, rgba(0, 123, 255, 0.1));
  border: 1px solid var(--color-info, #007bff);
  color: var(--color-info-text, #004085);
}

.moderators-section,
.roles-section {
  margin-bottom: var(--spacing-lg);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.moderator-list,
.role-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.moderator-row,
.role-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
}

.moderator-info,
.role-info {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.moderator-user-id {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--text-muted);
}

.moderator-role-name,
.role-name {
  font-weight: 500;
}

.moderator-permissions,
.role-permissions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.permission-badge {
  padding: 2px var(--spacing-xs);
  font-size: var(--font-size-xs);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.permission-badge.granted {
  background: var(--color-success-bg, rgba(40, 167, 69, 0.1));
  color: var(--color-success, #28a745);
}

.role-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.form-group {
  margin-bottom: var(--spacing-md);
}

.form-label {
  display: block;
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.permission-checkboxes {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.permission-checkbox {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  cursor: pointer;
}

.permission-checkbox input {
  width: auto;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ManageModeratorsTab/
git commit -m "feat: add ManageModeratorsTab component"
```

---

## Task 8: Channel Edit Modal with Tabs

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Create: `src/Brmble.Web/src/components/ChannelEditModal/ChannelEditModal.tsx`
- Create: `src/Brmble.Web/src/components/ChannelEditModal/ChannelEditModal.css`

- [ ] **Step 1: Create ChannelEditModal component**

Create `src/Brmble.Web/src/components/ChannelEditModal/ChannelEditModal.tsx`:

```typescript
import { useState } from 'react';
import { ManageModeratorsTab } from '../ManageModeratorsTab/ManageModeratorsTab';
import bridge from '../../bridge';
import './ChannelEditModal.css';

interface ChannelEditModalProps {
  channelId: number;
  channelName: string;
  isAdmin: boolean;
  onClose: () => void;
}

export function ChannelEditModal({ channelId, channelName, isAdmin, onClose }: ChannelEditModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'moderators'>('general');
  const [name, setName] = useState(channelName);
  const [description, setDescription] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    bridge.send('voice.updateChannel', {
      channelId,
      name: name !== channelName ? name : undefined,
      description,
      password: password || null,
    });
    setSaving(false);
    onClose();
  };

  const hasModeratorPermissions = () => {
    // Check via bridge if user has moderator permissions for this channel
    return true; // TODO: implement permission check
  };

  const showModeratorsTab = isAdmin || hasModeratorPermissions();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="channel-edit-modal glass-panel animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Edit Channel</h2>
          <p className="modal-subtitle">{channelName}</p>
        </div>

        <div className="edit-tabs">
          <button
            className={`edit-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          {showModeratorsTab && (
            <button
              className={`edit-tab ${activeTab === 'moderators' ? 'active' : ''}`}
              onClick={() => setActiveTab('moderators')}
            >
              Manage Moderators
            </button>
          )}
        </div>

        <div className="modal-body">
          {activeTab === 'general' && (
            <div className="general-tab-content">
              <div className="form-group">
                <label className="form-label">Channel Name</label>
                <input
                  type="text"
                  className="brmble-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="brmble-input"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Channel description..."
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password (leave empty to clear)</label>
                <input
                  type="password"
                  className="brmble-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter new password..."
                />
              </div>
            </div>
          )}

          {activeTab === 'moderators' && (
            <ManageModeratorsTab
              channelId={channelId}
              isAdmin={isAdmin}
            />
          )}
        </div>

        {activeTab === 'general' && (
          <div className="prompt-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update ChannelTree to use ChannelEditModal**

Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`:

Replace the `editChannelDialog` state usage with the new modal:

```typescript
// In the imports section, add:
import { ChannelEditModal } from '../ChannelEditModal/ChannelEditModal';

// Change the editChannelDialog state to track admin status:
const [editChannelDialog, setEditChannelDialog] = useState<{ id: number; name: string; isAdmin: boolean } | null>(null);

// Update the channel context menu "Edit" click:
if (hasEditPermission) {
  adminItems.push({
    type: 'item' as const,
    label: 'Edit',
    onClick: () => {
      setEditChannelDialog({ id: channelContextMenu.channelId, name: channelContextMenu.channelName, isAdmin: hasEditPermission });
      setChannelContextMenu(null);
    },
  });
}

// Replace the editChannelDialog modal rendering:
{editChannelDialog && (
  <ChannelEditModal
    channelId={editChannelDialog.id}
    channelName={editChannelDialog.name}
    isAdmin={editChannelDialog.isAdmin}
    onClose={() => setEditChannelDialog(null)}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChannelEditModal/ src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git commit -m "feat: add channel edit modal with Manage Moderators tab"
```

---

## Task 9: Bridge Integration

**Files:**
- Modify: `src/Brmble.Client/Bridge/NativeBridge.cs` (add moderator handlers)
- Modify: `src/Brmble.Server/Mumble/MumbleAdapter.cs` (if needed for voice actions)

- [ ] **Step 1: Add bridge handlers on client side**

Add to `NativeBridge.cs`:

```csharp
// Moderator role management
bridge.RegisterHandler("moderator.getRoles", _ =>
{
    var roles = _moderatorService.GetRoles();
    bridge.Send("moderator.roles", roles.Select(r => new {
        r.Id,
        r.Name,
        Permissions = (int)r.Permissions
    }));
});

bridge.RegisterHandler("moderator.createRole", data =>
{
    if (data is not JsonElement e) return;
    var name = e.GetProperty("name").GetString() ?? "";
    var permissions = (ModeratorPermission)e.GetProperty("permissions").GetInt32();
    var role = _moderatorService.CreateRole(name, permissions);
    bridge.Send("moderator.roleCreated", new { role.Id });
});

bridge.RegisterHandler("moderator.updateRole", data =>
{
    if (data is not JsonElement e) return;
    var id = e.GetProperty("id").GetString();
    string? name = null;
    ModeratorPermission? permissions = null;
    if (e.TryGetProperty("name", out var nameEl) && nameEl.ValueKind != JsonValueKind.Null)
        name = nameEl.GetString();
    if (e.TryGetProperty("permissions", out var permEl) && permEl.ValueKind != JsonValueKind.Null)
        permissions = (ModeratorPermission)permEl.GetInt32();
    _moderatorService.UpdateRole(id!, name, permissions);
    bridge.Send("moderator.roleUpdated", new { id });
});

bridge.RegisterHandler("moderator.deleteRole", data =>
{
    if (data is not JsonElement e) return;
    var id = e.GetProperty("id").GetString();
    _moderatorService.DeleteRole(id!);
    bridge.Send("moderator.roleDeleted", new { id });
});

// Channel moderator management
bridge.RegisterHandler("moderator.getChannelModerators", data =>
{
    if (data is not JsonElement e) return;
    var channelId = e.GetProperty("channelId").GetUInt32();
    var moderators = _moderatorService.GetChannelModerators((int)channelId);
    bridge.Send("moderator.channelModerators", moderators.Select(m => new {
        m.Id,
        m.UserId,
        m.RoleId,
        m.RoleName,
        RolePermissions = (int)m.RolePermissions,
        m.AssignedAt
    }));
});

bridge.RegisterHandler("moderator.assign", data =>
{
    if (data is not JsonElement e) return;
    var channelId = e.GetProperty("channelId").GetUInt32();
    var roleId = e.GetProperty("roleId").GetString();
    var userId = e.GetProperty("userId").GetInt32();
    var assignment = _moderatorService.AssignModerator(roleId!, (int)channelId, userId, assignedBy: 0);
    bridge.Send("moderator.assigned", new { assignment.Id });
});

bridge.RegisterHandler("moderator.remove", data =>
{
    if (data is not JsonElement e) return;
    var assignmentId = e.GetProperty("assignmentId").GetString();
    _moderatorService.RemoveModerator(assignmentId!);
    bridge.Send("moderator.removed", new { assignmentId });
});

bridge.RegisterHandler("moderator.getCurrentUserPermissions", data =>
{
    if (data is not JsonElement e) return;
    var channelId = e.GetProperty("channelId").GetUInt32();
    var permissions = _moderatorService.GetUserPermissionsForChannel(_localUserId, (int)channelId);
    bridge.Send("moderator.currentUserPermissions", new {
        channelId,
        permissions = (int)permissions
    });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Client/Bridge/NativeBridge.cs
git commit -m "feat: add moderator bridge handlers"
```

---

## Task 10: Sync Retry Background Service

**Files:**
- Create: `src/Brmble.Server/Moderator/SyncRetryBackgroundService.cs`
- Modify: `src/Brmble.Server/Program.cs` (register hosted service)

- [ ] **Step 1: Implement background retry service**

Create `src/Brmble.Server/Moderator/SyncRetryBackgroundService.cs`:

```csharp
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Brmble.Server.Data;

namespace Brmble.Server.Moderator;

public class SyncRetryBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<SyncRetryBackgroundService> _logger;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);

    public SyncRetryBackgroundService(
        IServiceProvider serviceProvider,
        ILogger<SyncRetryBackgroundService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Sync retry background service started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessFailedSyncsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing failed syncs");
            }

            await Task.Delay(PollInterval, stoppingToken);
        }
    }

    private async Task ProcessFailedSyncsAsync(CancellationToken stoppingToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var syncFailedRepo = scope.ServiceProvider.GetRequiredService<SyncFailedAssignmentRepository>();
        var assignmentRepo = scope.ServiceProvider.GetRequiredService<ModeratorAssignmentRepository>();
        var mumbleSync = scope.ServiceProvider.GetRequiredService<IMumbleGroupSyncService>();
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<SyncRetryBackgroundService>>();

        var pending = await syncFailedRepo.GetPendingAsync();
        if (pending.Count == 0) return;

        logger.LogInformation("Processing {Count} pending sync failures", pending.Count);

        foreach (var failed in pending)
        {
            if (stoppingToken.IsCancellationRequested) break;

            if (failed.RetryCount >= 5)
            {
                logger.LogWarning("Max retries exceeded for sync {Id}, marking as failed permanently", failed.Id);
                await syncFailedRepo.RemoveAsync(failed.Id);
                continue;
            }

            var assignment = await assignmentRepo.GetByIdAsync(failed.AssignmentId);
            if (assignment == null)
            {
                logger.LogInformation("Assignment {Id} no longer exists, removing sync record", failed.AssignmentId);
                await syncFailedRepo.RemoveAsync(failed.Id);
                continue;
            }

            try
            {
                var success = await mumbleSync.SyncAssignmentAsync(
                    failed.AssignmentId,
                    assignment.UserId,
                    assignment.ChannelId,
                    failed.Action == "add");

                if (success)
                {
                    logger.LogInformation("Successfully synced assignment {Id} on retry", failed.AssignmentId);
                    await syncFailedRepo.RemoveAsync(failed.Id);
                }
                else
                {
                    await syncFailedRepo.IncrementRetryAsync(failed.Id, "Retry failed");
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error retrying sync {Id}", failed.Id);
                await syncFailedRepo.IncrementRetryAsync(failed.Id, ex.Message);
            }
        }
    }
}
```

- [ ] **Step 2: Register hosted service in Program.cs**

```csharp
services.AddHostedService<SyncRetryBackgroundService>();
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Moderator/SyncRetryBackgroundService.cs src/Brmble.Server/Program.cs
git commit -m "feat: add sync retry background service"
```

---

## Task 11: Integration Tests

**Files:**
- Create: `tests/Brmble.Server.Tests/ModeratorServiceIntegrationTests.cs`

- [ ] **Step 1: Write integration test**

Create `tests/Brmble.Server.Tests/ModeratorServiceIntegrationTests.cs`:

```csharp
using Brmble.Server.Data;
using Brmble.Server.Moderator;
using Moq;
using Xunit;

namespace Brmble.Server.Tests;

public class ModeratorServiceIntegrationTests
{
    private readonly Database _db;
    private readonly ModeratorRoleRepository _roleRepo;
    private readonly ModeratorAssignmentRepository _assignmentRepo;
    private readonly SyncFailedAssignmentRepository _syncFailedRepo;
    private readonly Mock<IMumbleGroupSyncService> _mumbleSyncMock;
    private readonly ModeratorService _service;

    public ModeratorServiceIntegrationTests()
    {
        _db = new Database("DataSource=:memory:");
        _db.Initialize();
        _roleRepo = new ModeratorRoleRepository(_db);
        _assignmentRepo = new ModeratorAssignmentRepository(_db);
        _syncFailedRepo = new SyncFailedAssignmentRepository(_db);
        _mumbleSyncMock = new Mock<IMumbleGroupSyncService>();
        
        var logger = new Microsoft.Extensions.Logging.Abstractions.NullLogger<ModeratorService>();
        _service = new ModeratorService(
            _roleRepo,
            _assignmentRepo,
            _syncFailedRepo,
            _mumbleSyncMock.Object,
            logger);
    }

    [Fact]
    public async Task CreateAndAssignModerator_SyncsToMumble()
    {
        // Arrange
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermission.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), true))
            .ReturnsAsync(true);

        // Act
        var assignment = await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        // Assert
        Assert.NotNull(assignment);
        _mumbleSyncMock.Verify(x => x.SyncAssignmentAsync(
            assignment.Id, 123, 5, true), Times.Once);
    }

    [Fact]
    public async Task RemoveModerator_SyncsToMumble()
    {
        // Arrange
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermission.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<bool>()))
            .ReturnsAsync(true);
        var assignment = await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        _mumbleSyncMock.Invocations.Clear();

        // Act
        await _service.RemoveModeratorAsync(assignment.Id);

        // Assert
        _mumbleSyncMock.Verify(x => x.SyncAssignmentAsync(
            assignment.Id, 123, 5, false), Times.Once);
    }

    [Fact]
    public async Task FailedSync_QueuesForRetry()
    {
        // Arrange
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermission.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), true))
            .ReturnsAsync(false);

        // Act
        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        // Assert
        var pending = await _syncFailedRepo.GetPendingAsync();
        Assert.Single(pending);
        Assert.Equal("add", pending[0].Action);
    }

    [Fact]
    public async Task GetUserPermissionsForChannel_ReturnsCorrectPermissions()
    {
        // Arrange
        var role = await _service.CreateRoleAsync("Full Mod", 
            ModeratorPermission.Kick | ModeratorPermission.DenyEnter | ModeratorPermission.RenameChannel);
        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        // Act
        var perms = await _service.GetUserPermissionsForChannelAsync(123, 5);

        // Assert
        Assert.Equal(ModeratorPermission.Kick | ModeratorPermission.DenyEnter | ModeratorPermission.RenameChannel, perms);
    }

    [Fact]
    public async Task GetUserPermissionsForChannel_NoAssignment_ReturnsNone()
    {
        // Act
        var perms = await _service.GetUserPermissionsForChannelAsync(999, 5);

        // Assert
        Assert.Equal(ModeratorPermission.None, perms);
    }

    [Fact]
    public async Task CleanupChannelAssignments_DeletesAllAssignments()
    {
        // Arrange
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermission.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<bool>()))
            .ReturnsAsync(true);
        
        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 1, assignedBy: 1);
        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 2, assignedBy: 1);
        await _service.AssignModeratorAsync(role.Id, channelId: 6, userId: 1, assignedBy: 1);

        // Act
        await _service.CleanupChannelAssignmentsAsync(5);

        // Assert
        var remaining = await _service.GetChannelModeratorsAsync(5);
        Assert.Empty(remaining);
        
        var otherChannel = await _service.GetChannelModeratorsAsync(6);
        Assert.Single(otherChannel);
    }
}
```

- [ ] **Step 2: Run integration tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ModeratorServiceIntegrationTests"
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/ModeratorServiceIntegrationTests.cs
git commit -m "test: add moderator service integration tests"
```

---

## Verification

After all tasks complete, run the full test suite:

```bash
dotnet build
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Build the frontend:

```bash
cd src/Brmble.Web && npm run build
```
