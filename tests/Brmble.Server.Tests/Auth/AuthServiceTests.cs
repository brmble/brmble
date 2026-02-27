// tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

#pragma warning disable CS8618 // Non-nullable field uninitialized in constructor (test class uses TestInitialize)

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceTests
{
    private SqliteConnection? _keepAlive;
    private AuthService? _svc;
    private UserRepository? _repo;
    private Mock<IMatrixAppService>? _mockMatrix;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "authsvc_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        var settings = Options.Create(new MatrixSettings { HomeserverUrl = "http://localhost", AppServiceToken = "test", ServerDomain = "test.local" });
        var repo = new UserRepository(db, settings);
        _repo = repo;
        _mockMatrix = new Mock<IMatrixAppService>();
        _mockMatrix.Setup(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()))
                   .ReturnsAsync("syt_new_token");
        _mockMatrix.Setup(m => m.LoginUser(It.IsAny<string>()))
                   .ReturnsAsync("syt_refresh_token");
        _svc = new AuthService(repo, _mockMatrix.Object, NullLogger<AuthService>.Instance);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void IsBrmbleClient_UnknownHash_ReturnsFalse()
    {
        Assert.IsFalse(_svc!.IsBrmbleClient("unknown-cert-hash"));
    }

    [TestMethod]
    public void IsBrmbleClient_EmptyHash_ReturnsFalse()
    {
        Assert.IsFalse(_svc!.IsBrmbleClient(string.Empty));
    }

    [TestMethod]
    public void IsBrmbleClient_NullHash_ReturnsFalse()
    {
        Assert.IsFalse(_svc!.IsBrmbleClient(null!));
    }

    [TestMethod]
    public async Task Authenticate_NewUser_AddsToActiveSessions()
    {
        await _svc!.Authenticate("newhash");
        Assert.IsTrue(_svc.IsBrmbleClient("newhash"));
    }

    [TestMethod]
    public async Task Authenticate_ExistingUser_StillAddsToActiveSessions()
    {
        await _svc!.Authenticate("existinghash");
        _svc.Deactivate("existinghash");
        await _svc.Authenticate("existinghash");
        Assert.IsTrue(_svc.IsBrmbleClient("existinghash"));
    }

    [TestMethod]
    public async Task Deactivate_AfterAuthenticate_RemovesFromActiveSessions()
    {
        await _svc!.Authenticate("todeactivate");
        _svc.Deactivate("todeactivate");
        Assert.IsFalse(_svc.IsBrmbleClient("todeactivate"));
    }

    [TestMethod]
    public async Task HandleUserState_UnknownCert_DoesNotThrow()
    {
        // No user in DB, no auth call — should just queue silently
        await _svc!.HandleUserState("unknownhash", "Ghost");
        // No assert needed — just verifying no exception
    }

    [TestMethod]
    public async Task HandleUserState_BeforeAuth_QueuesName()
    {
        await _svc!.HandleUserState("queuedhash", "Queued");
        // Name is in the queue — verify by authenticating and checking the stored name
        await _svc.Authenticate("queuedhash");
        var user = await _repo!.GetByCertHash("queuedhash");
        Assert.AreEqual("Queued", user!.DisplayName);
    }

    [TestMethod]
    public async Task HandleUserState_AfterAuth_UpdatesDisplayName()
    {
        await _svc!.Authenticate("updatehash");
        // User exists with placeholder — now UserState arrives
        await _svc.HandleUserState("updatehash", "RealName");
        var user = await _repo!.GetByCertHash("updatehash");
        Assert.AreEqual("RealName", user!.DisplayName);
    }

    [TestMethod]
    public async Task HandleUserState_QueueConsumedAfterAuthenticate()
    {
        await _svc!.HandleUserState("consumedhash", "ConsumedName");
        await _svc.Authenticate("consumedhash");
        // Authenticate a second time — queue entry should be gone, no double-update
        await _svc.Authenticate("consumedhash");
        var user = await _repo!.GetByCertHash("consumedhash");
        Assert.AreEqual("ConsumedName", user!.DisplayName);
    }

    [TestMethod]
    public async Task Authenticate_NoPendingName_UsesPlaceholder()
    {
        await _svc!.Authenticate("placeholderhash");
        var user = await _repo!.GetByCertHash("placeholderhash");
        Assert.IsNotNull(user);
        Assert.AreEqual($"user_{user.Id}", user.DisplayName);
    }

    [TestMethod]
    public async Task Authenticate_NewUser_CallsRegisterAndStoresToken()
    {
        var result = await _svc!.Authenticate("newhash_matrix");
        Assert.AreEqual("syt_new_token", result.MatrixAccessToken);
        _mockMatrix!.Verify(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()), Times.Once);
    }

    [TestMethod]
    public async Task Authenticate_ExistingUserWithToken_ReturnsStoredToken()
    {
        // First call provisions and stores token
        await _svc!.Authenticate("existing_hash");

        // Second call should return stored token, not call RegisterUser again
        var result = await _svc.Authenticate("existing_hash");
        Assert.AreEqual("syt_new_token", result.MatrixAccessToken);
        _mockMatrix!.Verify(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()), Times.Once);
    }

    [TestMethod]
    public async Task Authenticate_ExistingUserWithoutToken_CallsLoginUser()
    {
        // Insert user directly without a token
        await _repo!.Insert("notokhash", "TestUser");

        var result = await _svc!.Authenticate("notokhash");
        Assert.AreEqual("syt_refresh_token", result.MatrixAccessToken);
        _mockMatrix!.Verify(m => m.LoginUser(It.IsAny<string>()), Times.Once);
    }
}
