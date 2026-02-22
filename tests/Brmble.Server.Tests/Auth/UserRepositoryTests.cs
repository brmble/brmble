// tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;
    private UserRepository? _repo;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "userrepo_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        var settings = Options.Create(new AuthSettings { ServerDomain = "test.local" });
        _repo = new UserRepository(_db, settings);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void Constructor_WithValidDatabase_DoesNotThrow()
    {
        Assert.IsNotNull(_repo);
    }

    [TestMethod]
    public async Task GetByCertHash_UnknownHash_ReturnsNull()
    {
        var result = await _repo!.GetByCertHash("nonexistent");
        Assert.IsNull(result);
    }

    [TestMethod]
    public async Task GetByCertHash_ExistingUser_ReturnsUser()
    {
        var inserted = await _repo!.Insert("abc123", "TestUser");
        var found = await _repo.GetByCertHash("abc123");
        Assert.IsNotNull(found);
        Assert.AreEqual(inserted.Id, found.Id);
        Assert.AreEqual("abc123", found.CertHash);
        Assert.AreEqual("TestUser", found.DisplayName);
    }

    [TestMethod]
    public async Task UpdateDisplayName_ExistingUser_UpdatesRecord()
    {
        var user = await _repo!.Insert("cafebabe", "OldName");
        await _repo.UpdateDisplayName(user.Id, "NewName");
        var updated = await _repo.GetByCertHash("cafebabe");
        Assert.AreEqual("NewName", updated!.DisplayName);
    }

    [TestMethod]
    public async Task Insert_NewUser_PersistsToDatabase()
    {
        var user = await _repo!.Insert("deadbeef", "Alice");
        Assert.IsTrue(user.Id > 0);
        Assert.AreEqual("deadbeef", user.CertHash);
        Assert.AreEqual("Alice", user.DisplayName);
        Assert.AreEqual($"@{user.Id}:test.local", user.MatrixUserId);
    }

    [TestMethod]
    public async Task Insert_WithNullDisplayName_UsesPlaceholder()
    {
        var user = await _repo!.Insert("hash2", null);
        Assert.AreEqual($"user_{user.Id}", user.DisplayName);
    }

    [TestMethod]
    public async Task UpdateMatrixToken_StoresToken()
    {
        var user = await _repo!.Insert("hash_token_test", "Alice");
        await _repo.UpdateMatrixToken(user.Id, "syt_abc123");
        var updated = await _repo.GetByCertHash("hash_token_test");
        Assert.AreEqual("syt_abc123", updated!.MatrixAccessToken);
    }

    [TestMethod]
    public async Task Insert_NewUser_MatrixAccessTokenIsNull()
    {
        var user = await _repo!.Insert("hash_null_token", "Bob");
        Assert.IsNull(user.MatrixAccessToken);
    }
}
