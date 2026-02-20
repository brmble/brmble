// tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceTests
{
    private SqliteConnection? _keepAlive;
    private AuthService? _svc;
    private UserRepository? _repo;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "authsvc_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Matrix:ServerDomain"] = "test.local"
            })
            .Build();
        var repo = new UserRepository(db, config);
        _repo = repo;
        _svc = new AuthService(repo);
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
        await _svc!.Authenticate("newhash", "Alice");
        Assert.IsTrue(_svc.IsBrmbleClient("newhash"));
    }

    [TestMethod]
    public async Task Authenticate_NewUser_ReturnsStubToken()
    {
        var result = await _svc!.Authenticate("somehash", "Bob");
        StringAssert.StartsWith(result.MatrixAccessToken, "stub_token_");
    }

    [TestMethod]
    public async Task Authenticate_ExistingUser_StillAddsToActiveSessions()
    {
        await _svc!.Authenticate("existinghash", "Charlie");
        _svc.Deactivate("existinghash");
        await _svc.Authenticate("existinghash", "Charlie");
        Assert.IsTrue(_svc.IsBrmbleClient("existinghash"));
    }

    [TestMethod]
    public async Task Deactivate_AfterAuthenticate_RemovesFromActiveSessions()
    {
        await _svc!.Authenticate("todeactivate", "Dave");
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
        await _svc!.Authenticate("updatehash", "Placeholder");
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
}
