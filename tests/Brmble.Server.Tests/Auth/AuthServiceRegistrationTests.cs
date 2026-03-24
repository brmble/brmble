using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

#pragma warning disable CS8618

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceRegistrationTests
{
    private SqliteConnection _keepAlive = null!;
    private Mock<IMumbleRegistrationService> _mockReg = null!;
    private Mock<ISessionMappingService> _mockSession = null!;
    private AuthService _authService = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "authreg_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        var settings = Options.Create(new MatrixSettings { HomeserverUrl = "http://localhost", AppServiceToken = "test", ServerDomain = "test.local" });
        var repo = new UserRepository(db, settings);
        _mockReg = new Mock<IMumbleRegistrationService>();
        _mockSession = new Mock<ISessionMappingService>();
        var mockMatrix = new Mock<IMatrixAppService>();
        var mockEventBus = new Mock<IBrmbleEventBus>();
        mockEventBus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
        _authService = new AuthService(repo, mockMatrix.Object, NullLogger<AuthService>.Instance,
            _mockReg.Object, _mockSession.Object, mockEventBus.Object);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task ResolveMumbleNameAsync_ReturnsRegisteredName_WhenAlreadyRegistered()
    {
        int sessionId = 42;
        _mockSession.Setup(s => s.TryGetSessionId("bob", out sessionId)).Returns(true);
        _mockReg.Setup(r => r.GetRegistrationStatusAsync(42)).ReturnsAsync((true, 1));
        _mockReg.Setup(r => r.GetRegisteredNameAsync(1)).ReturnsAsync("arie");

        var result = await _authService.ResolveMumbleNameAsync("bob", "cert123");
        Assert.AreEqual("arie", result);
    }

    [TestMethod]
    public async Task ResolveMumbleNameAsync_RegistersNewName_WhenNotRegistered()
    {
        int sessionId = 42;
        _mockSession.Setup(s => s.TryGetSessionId("newuser", out sessionId)).Returns(true);
        _mockReg.Setup(r => r.GetRegistrationStatusAsync(42)).ReturnsAsync((false, -1));
        _mockReg.Setup(r => r.RegisterUserAsync("newuser", "cert456")).ReturnsAsync(5);

        var result = await _authService.ResolveMumbleNameAsync("newuser", "cert456");
        Assert.AreEqual("newuser", result);
        _mockReg.Verify(r => r.RegisterUserAsync("newuser", "cert456"), Times.Once);
    }

    [TestMethod]
    public async Task ResolveMumbleNameAsync_ThrowsNameConflict_WhenNameTaken()
    {
        int sessionId = 42;
        _mockSession.Setup(s => s.TryGetSessionId("taken", out sessionId)).Returns(true);
        _mockReg.Setup(r => r.GetRegistrationStatusAsync(42)).ReturnsAsync((false, -1));
        _mockReg.Setup(r => r.RegisterUserAsync("taken", "cert789"))
            .ThrowsAsync(new MumbleNameConflictException("taken"));

        await Assert.ThrowsExceptionAsync<MumbleNameConflictException>(
            () => _authService.ResolveMumbleNameAsync("taken", "cert789"));
    }

    [TestMethod]
    public async Task ResolveMumbleNameAsync_ThrowsWhenNoSession()
    {
        int sessionId;
        _mockSession.Setup(s => s.TryGetSessionId("ghost", out sessionId)).Returns(false);

        await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
            () => _authService.ResolveMumbleNameAsync("ghost", "cert000"));
    }


    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   ")]
    public void ValidateMumbleUsername_RejectsEmptyNames(string? name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }

    [TestMethod]
    public void ValidateMumbleUsername_RejectsNamesTooLong()
    {
        var longName = new string('a', 129);
        var (valid, error) = AuthService.ValidateMumbleUsername(longName);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }

    [TestMethod]
    [DataRow("arie")]
    [DataRow("Player_1")]
    [DataRow("a")]
    public void ValidateMumbleUsername_AcceptsValidNames(string name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsTrue(valid);
        Assert.IsNull(error);
    }

    [TestMethod]
    [DataRow("user/name")]
    [DataRow("user#name")]
    public void ValidateMumbleUsername_RejectsInvalidCharacters(string name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }
}
