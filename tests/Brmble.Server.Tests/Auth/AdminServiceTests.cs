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
    public async Task GetRegisteredUsersAsync_ReturnsMumbleRegisteredUsers()
    {
        // Arrange: Mock Mumble returning registered users
        _mumbleMock.Setup(m => m.GetRegisteredUsersAsync(""))
            .ReturnsAsync(new Dictionary<int, string> 
            { 
                { 42, "Alice" },
                { 99, "Bob" }
            });

        // Act
        var result = await _service!.GetRegisteredUsersAsync();

        // Assert
        Assert.AreEqual(2, result.Count);
        Assert.AreEqual("Alice", result[0].DisplayName);
        Assert.AreEqual(42, result[0].MumbleUserId);
        Assert.IsTrue(result[0].IsMumbleRegistered);
        Assert.AreEqual("Bob", result[1].DisplayName);
        Assert.AreEqual(99, result[1].MumbleUserId);
        Assert.IsTrue(result[1].IsMumbleRegistered);
    }

      [TestMethod]
      public async Task GetRegisteredUsersAsync_EmptyWhenNoMumbleUsers()
      {
          // Arrange: Mock Mumble returning no registered users
          _mumbleMock.Setup(m => m.GetRegisteredUsersAsync(""))
              .ReturnsAsync(new Dictionary<int, string>());

          // Act
          var result = await _service!.GetRegisteredUsersAsync();

          // Assert
          Assert.AreEqual(0, result.Count);
      }

     [TestMethod]
     public async Task DeleteUserAsync_RemovesUserAndMumble()
     {
         // Arrange
         var user = await _repo!.Insert("cert_del", "ToDelete");
         _mumbleMock.Setup(m => m.GetRegisteredUsersAsync(""))
             .ReturnsAsync(new Dictionary<int, string> { { 50, "ToDelete" } });
         _mumbleMock.Setup(m => m.UnregisterUserAsync(50))
             .Returns(Task.CompletedTask);

         // Act
         var result = await _service!.DeleteUserAsync(user.Id);

         // Assert
         Assert.IsTrue(result);
         _mumbleMock.Verify(m => m.UnregisterUserAsync(50), Times.Once);
         var found = await _repo.GetByCertHash("cert_del");
         Assert.IsNull(found);
     }
}
