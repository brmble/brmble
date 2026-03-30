using Brmble.Server.Data;
using Brmble.Server.Moderator;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests;

[TestClass]
public class ModeratorServiceIntegrationTests
{
    private SqliteConnection? _keepAlive;
    private Database _db = null!;
    private ModeratorRoleRepository _roleRepo = null!;
    private ModeratorAssignmentRepository _assignmentRepo = null!;
    private SyncFailedAssignmentRepository _syncFailedRepo = null!;
    private Mock<IMumbleGroupSyncService> _mumbleSyncMock = null!;
    private ModeratorService _service = null!;

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

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task CreateAndAssignModerator_SyncsToMumble()
    {
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermissions.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), true))
            .ReturnsAsync(true);

        var assignment = await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        Assert.IsNotNull(assignment);
        _mumbleSyncMock.Verify(x => x.SyncAssignmentAsync(
            assignment.Id, 123, 5, true), Times.Once);
    }

    [TestMethod]
    public async Task RemoveModerator_SyncsToMumble()
    {
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermissions.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<bool>()))
            .ReturnsAsync(true);
        var assignment = await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        _mumbleSyncMock.Invocations.Clear();

        await _service.RemoveModeratorAsync(assignment.Id);

        _mumbleSyncMock.Verify(x => x.SyncAssignmentAsync(
            assignment.Id, 123, 5, false), Times.Once);
    }

    [TestMethod]
    public async Task FailedSync_QueuesForRetry()
    {
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermissions.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), true))
            .ReturnsAsync(false);

        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        var pending = await _syncFailedRepo.GetPendingAsync();
        Assert.AreEqual(1, pending.Count);
        Assert.AreEqual("add", pending[0].Action);
    }

    [TestMethod]
    public async Task GetUserPermissionsForChannel_ReturnsCorrectPermissions()
    {
        var role = await _service.CreateRoleAsync("Full Mod", 
            ModeratorPermissions.Kick | ModeratorPermissions.DenyEnter | ModeratorPermissions.RenameChannel);
        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 123, assignedBy: 1);

        var perms = await _service.GetUserPermissionsForChannelAsync(123, 5);

        Assert.AreEqual(ModeratorPermissions.Kick | ModeratorPermissions.DenyEnter | ModeratorPermissions.RenameChannel, perms);
    }

    [TestMethod]
    public async Task GetUserPermissionsForChannel_NoAssignment_ReturnsNone()
    {
        var perms = await _service.GetUserPermissionsForChannelAsync(999, 5);

        Assert.AreEqual(ModeratorPermissions.None, perms);
    }

    [TestMethod]
    public async Task CleanupChannelAssignments_DeletesAllAssignments()
    {
        var role = await _service.CreateRoleAsync("Test Mod", ModeratorPermissions.Kick);
        _mumbleSyncMock.Setup(x => x.SyncAssignmentAsync(
            It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<bool>()))
            .ReturnsAsync(true);
        
        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 1, assignedBy: 1);
        await _service.AssignModeratorAsync(role.Id, channelId: 5, userId: 2, assignedBy: 1);
        await _service.AssignModeratorAsync(role.Id, channelId: 6, userId: 1, assignedBy: 1);

        await _service.CleanupChannelAssignmentsAsync(5);

        var remaining = await _service.GetChannelModeratorsAsync(5);
        Assert.AreEqual(0, remaining.Count);
        
        var otherChannel = await _service.GetChannelModeratorsAsync(6);
        Assert.AreEqual(1, otherChannel.Count);
    }
}
