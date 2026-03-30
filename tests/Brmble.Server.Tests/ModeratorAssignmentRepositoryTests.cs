using Brmble.Server.Data;
using Brmble.Server.Moderator;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests;

[TestClass]
public class ModeratorAssignmentRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private Database _db = null!;
    private ModeratorRoleRepository _roleRepo = null!;
    private ModeratorAssignmentRepository _repo = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        _roleRepo = new ModeratorRoleRepository(_db);
        _repo = new ModeratorAssignmentRepository(_db);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task CreateAsync_ReturnsAssignment()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermissions.Kick);
        var assignment = await _repo.CreateAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);
        
        Assert.IsNotNull(assignment.Id);
        Assert.AreEqual(role.Id, assignment.RoleId);
        Assert.AreEqual(5, assignment.ChannelId);
        Assert.AreEqual(123, assignment.UserId);
    }

    [TestMethod]
    public async Task GetByChannelAsync_ReturnsAssignmentsForChannel()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermissions.Kick);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 1, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 2, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 6, userId: 1, assignedBy: 1);
        
        var channel5Assignments = await _repo.GetByChannelAsync(5);
        
        Assert.AreEqual(2, channel5Assignments.Count);
    }

    [TestMethod]
    public async Task GetByUserAndChannelAsync_ReturnsSpecificAssignment()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermissions.Kick);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);
        
        var assignment = await _repo.GetByUserAndChannelAsync(userId: 123, channelId: 5);
        
        Assert.IsNotNull(assignment);
        Assert.AreEqual(123, assignment.UserId);
    }

    [TestMethod]
    public async Task DeleteAsync_RemovesAssignment()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermissions.Kick);
        var assignment = await _repo.CreateAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);
        await _repo.DeleteAsync(assignment.Id);
        
        var deleted = await _repo.GetByIdAsync(assignment.Id);
        Assert.IsNull(deleted);
    }

    [TestMethod]
    public async Task GetByChannelAndUserIdsAsync_ReturnsMatchingAssignments()
    {
        var role = await _roleRepo.CreateAsync("Test Role", ModeratorPermissions.Kick);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 1, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 5, userId: 2, assignedBy: 1);
        await _repo.CreateAsync(role.Id, channelId: 6, userId: 3, assignedBy: 1);
        
        var assignments = await _repo.GetByChannelAndUserIdsAsync(5, new[] { 1, 2, 3 });
        
        Assert.AreEqual(2, assignments.Count);
    }
}
