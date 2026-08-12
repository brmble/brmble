// tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Companions;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Dapper;
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
        var settings = Options.Create(new MatrixSettings { HomeserverUrl = "http://localhost", AppServiceToken = "test", ServerDomain = "test.local" });
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
    public async Task GetByCertHash_ReturnsIdentityWhenTokenColumnsArePopulated()
    {
        var user = await _repo!.Insert("hash_identity_only", "Alice");
        using (var conn = _db!.CreateConnection())
        {
            await conn.ExecuteAsync("""
                UPDATE users
                SET matrix_access_token = 'opaque-storage-value',
                    token_expires_at = 1234
                WHERE id = @Id
                """, new { user.Id });
        }

        var found = await _repo.GetByCertHash("hash_identity_only");

        Assert.IsNotNull(found);
        Assert.AreEqual(user.Id, found.Id);
        Assert.AreEqual(user.MatrixUserId, found.MatrixUserId);
    }

    [TestMethod]
    public async Task GetAllAsync_ReturnsAllInsertedUsers()
    {
        await _repo!.Insert("hash1", "Alice");
        await _repo!.Insert("hash2", "Bob");

        var users = await _repo.GetAllAsync();

        Assert.AreEqual(2, users.Count);
        Assert.IsTrue(users.Any(u => u.DisplayName == "Alice"));
        Assert.IsTrue(users.Any(u => u.DisplayName == "Bob"));
    }

    [TestMethod]
    public async Task GetAllAsync_EmptyDatabase_ReturnsEmptyList()
    {
        var users = await _repo!.GetAllAsync();
        Assert.AreEqual(0, users.Count);
    }

    [TestMethod]
    public async Task GetAvatarSource_ReturnsNull_WhenNotSet()
    {
        var user = await _repo!.Insert("cert1", "Alice");
        var source = await _repo.GetAvatarSource(user.Id);
        Assert.IsNull(source);
    }

    [TestMethod]
    public async Task SetAvatarSource_StoresAndRetrieves()
    {
        var user = await _repo!.Insert("cert2", "Bob");
        await _repo.SetAvatarSource(user.Id, "brmble");
        var source = await _repo.GetAvatarSource(user.Id);
        Assert.AreEqual("brmble", source);
    }

    [TestMethod]
    public async Task SetAvatarSource_NullClearsValue()
    {
        var user = await _repo!.Insert("cert3", "Carol");
        await _repo.SetAvatarSource(user.Id, "mumble");
        await _repo.SetAvatarSource(user.Id, null);
        var source = await _repo.GetAvatarSource(user.Id);
        Assert.IsNull(source);
    }

    [TestMethod]
    public async Task GetCompanionId_ReturnsBee_WhenColumnValueIsNullOrUnknown()
    {
        var user = await _repo!.Insert("cert-1", "alice");

        using var conn = _db!.CreateConnection();
        await conn.ExecuteAsync("UPDATE users SET companion_id = 'UNKNOWN' WHERE id = @Id", new { user.Id });

        var companionId = await _repo.GetCompanionId(user.Id);

        Assert.AreEqual("floppy", companionId);
    }

    [TestMethod]
    public async Task SetCompanionId_PersistsLowercaseValue()
    {
        var user = await _repo!.Insert("cert-2", "bob");

        await _repo.SetCompanionId(user.Id, "floppy");

        var companionId = await _repo.GetCompanionId(user.Id);

        Assert.AreEqual("floppy", companionId);
    }

    [TestMethod]
    public async Task NormalizeCompanionIdAsync_AcceptsOnlyActiveCustomEvent()
    {
        var user = await _repo!.Insert("cert-custom", "alice");
        var gallery = new CustomCompanionRepository(_db!);
        await gallery.InsertAsync(new CustomCompanionRecord(
            "$local:test", "local", "!gallery:test", user.Id, "@alice:test", "Alice",
            "Orbit", "mxc://test/media", "image/png", 1536, 1872, 1, 1024,
            DateTimeOffset.Parse("2026-07-29T10:00:00Z"), null, null));

        Assert.AreEqual("custom:$local:test",
            await _repo.NormalizeCompanionIdAsync(user.Id, "custom:$local:test", gallery));
        Assert.AreEqual("floppy",
            await _repo.NormalizeCompanionIdAsync(user.Id, "custom:$other:test", gallery));
    }

    [TestMethod]
    public async Task GetCompanionId_RepairsStaleCustomSelectionToFloppy()
    {
        var user = await _repo!.Insert("cert-stale-custom", "alice");
        using var conn = _db!.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET companion_id = 'custom:$deleted:test' WHERE id = @Id", new { user.Id });

        Assert.AreEqual("floppy", await _repo.GetCompanionId(user.Id));
        Assert.AreEqual("floppy", await conn.QuerySingleAsync<string>(
            "SELECT companion_id FROM users WHERE id = @Id", new { user.Id }));
    }
}
