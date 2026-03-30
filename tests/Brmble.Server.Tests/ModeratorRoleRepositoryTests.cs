using Brmble.Server.Data;
using Brmble.Server.Moderator;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests;

[TestClass]
public class ModeratorRoleRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private Database _db = null!;
    private ModeratorRoleRepository _repo = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        _repo = new ModeratorRoleRepository(_db);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task CreateAsync_ReturnsRoleWithId()
    {
        var role = await _repo.CreateAsync("Test Role", ModeratorPermissions.Kick | ModeratorPermissions.DenyEnter);
        
        Assert.IsNotNull(role.Id);
        Assert.AreEqual("Test Role", role.Name);
        Assert.AreEqual(ModeratorPermissions.Kick | ModeratorPermissions.DenyEnter, role.Permissions);
    }

    [TestMethod]
    public async Task GetByIdAsync_ReturnsRole()
    {
        var created = await _repo.CreateAsync("Test Role", ModeratorPermissions.Kick);
        var retrieved = await _repo.GetByIdAsync(created.Id);
        
        Assert.IsNotNull(retrieved);
        Assert.AreEqual(created.Id, retrieved.Id);
        Assert.AreEqual("Test Role", retrieved.Name);
    }

    [TestMethod]
    public async Task GetAllAsync_ReturnsAllRoles()
    {
        await _repo.CreateAsync("Role 1", ModeratorPermissions.Kick);
        await _repo.CreateAsync("Role 2", ModeratorPermissions.DenyEnter);
        
        var roles = await _repo.GetAllAsync();
        
        Assert.AreEqual(2, roles.Count);
    }

    [TestMethod]
    public async Task UpdateAsync_ModifiesRole()
    {
        var role = await _repo.CreateAsync("Original", ModeratorPermissions.Kick);
        await _repo.UpdateAsync(role.Id, "Updated", ModeratorPermissions.DenyEnter);
        
        var updated = await _repo.GetByIdAsync(role.Id);
        Assert.AreEqual("Updated", updated?.Name);
        Assert.AreEqual(ModeratorPermissions.DenyEnter, updated?.Permissions);
    }

    [TestMethod]
    public async Task DeleteAsync_RemovesRole()
    {
        var role = await _repo.CreateAsync("To Delete", ModeratorPermissions.Kick);
        await _repo.DeleteAsync(role.Id);
        
        var deleted = await _repo.GetByIdAsync(role.Id);
        Assert.IsNull(deleted);
    }
}
