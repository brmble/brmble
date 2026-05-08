using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AdminServiceTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;
    private UserRepository? _repo;
    private Mock<IMumbleRegistrationService> _mumbleMock = null!;
    private AdminService? _service;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "adminsvc_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        var settings = Options.Create(
            new Brmble.Server.Matrix.MatrixSettings { HomeserverUrl = "http://localhost", AppServiceToken = "test", ServerDomain = "test.local" });
        _repo = new UserRepository(_db, settings);
        _mumbleMock = new Mock<IMumbleRegistrationService>();
        var logger = new Mock<ILogger<AdminService>>();
        _service = new AdminService(_repo, _mumbleMock.Object, logger.Object);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task GetRegisteredUsersAsync_MergesSqliteAndMumble()
    {
        // Arrange: Add a user to SQLite
        var user = await _repo!.Insert("cert1", "Alice");
        await _repo.SetAdmin(user.Id, false);

        // Arrange: Mock Mumble returning a registered user
        _mumbleMock.Setup(m => m.GetRegisteredUsersAsync(""))
            .ReturnsAsync(new Dictionary<int, string> { { 42, "Alice" } });

        // Act
        var result = await _service!.GetRegisteredUsersAsync();

        // Assert
        Assert.AreEqual(1, result.Count);
        Assert.AreEqual("Alice", result[0].DisplayName);
        Assert.IsTrue(result[0].IsMumbleRegistered);
        Assert.AreEqual(0, result[0].IsAdmin);
    }

    [TestMethod]
    public async Task GetRegisteredUsersAsync_IncludesMumbleOnlyUsers()
    {
        // Arrange: No SQLite users
        // Arrange: Mock Mumble returning a registered user not in SQLite
        _mumbleMock.Setup(m => m.GetRegisteredUsersAsync(""))
            .ReturnsAsync(new Dictionary<int, string> { { 99, "Bob" } });

        // Act
        var result = await _service!.GetRegisteredUsersAsync();

        // Assert
        Assert.AreEqual(1, result.Count);
        Assert.AreEqual("Bob", result[0].DisplayName);
        Assert.IsTrue(result[0].IsMumbleRegistered);
        Assert.IsFalse(result[0].IsBrmbleUser);
    }
}
