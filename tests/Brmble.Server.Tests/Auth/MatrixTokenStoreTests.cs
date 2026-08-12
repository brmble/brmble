using Brmble.Server.Auth;
using Brmble.Server.Data;
using Dapper;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public sealed class MatrixTokenStoreTests
{
    private SqliteConnection _keepAlive = null!;
    private Database _db = null!;
    private MatrixTokenStore _store = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "matrix_tokens_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();

        _db = new Database(cs);
        _db.Initialize();
        _store = new MatrixTokenStore(_db, new EphemeralDataProtectionProvider());

        using var conn = _db.CreateConnection();
        conn.Execute("""
            INSERT INTO users (cert_hash, display_name, matrix_user_id)
            VALUES ('cert-1', 'Alice', '@1:test.local')
            """);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive.Dispose();

    [TestMethod]
    public async Task SaveAsync_StoresCiphertextButGetAsyncReturnsPlaintext()
    {
        var expiry = DateTimeOffset.Parse("2026-08-12T10:00:00Z").ToUnixTimeMilliseconds();

        await _store.SaveAsync(1, "syt_secret", expiry);

        using var conn = _db.CreateConnection();
        var stored = await conn.QuerySingleAsync<string>(
            "SELECT matrix_access_token FROM users WHERE id = 1");

        Assert.AreNotEqual("syt_secret", stored);
        StringAssert.StartsWith(stored, "dp:v1:");

        var lease = await _store.GetAsync(1);
        Assert.IsNotNull(lease);
        Assert.AreEqual("syt_secret", lease.AccessToken);
        Assert.AreEqual(expiry, lease.ExpiresAtUnixMs);
        Assert.AreEqual(stored, lease.StoredValue);
    }

    [TestMethod]
    public async Task ClearIfCurrentAsync_DoesNotDeleteNewerLease()
    {
        var first = await _store.SaveAsync(1, "syt_first", 1000);
        await _store.SaveAsync(1, "syt_second", 2000);

        var cleared = await _store.ClearIfCurrentAsync(1, first.StoredValue);

        Assert.IsFalse(cleared);
        Assert.AreEqual("syt_second", (await _store.GetAsync(1))!.AccessToken);
    }

    [TestMethod]
    public async Task ExpireIfCurrentAsync_DoesNotExpireNewerLease()
    {
        var first = await _store.SaveAsync(1, "syt_first", 1000);
        await _store.SaveAsync(1, "syt_second", 2000);

        var expired = await _store.ExpireIfCurrentAsync(1, first.StoredValue, 3000);

        Assert.IsFalse(expired);
        Assert.AreEqual(2000, (await _store.GetAsync(1))!.ExpiresAtUnixMs);
    }

    [TestMethod]
    public async Task ProtectLegacyTokensAsync_EncryptsPlaintextAndExpiresMissingLease()
    {
        using (var conn = _db.CreateConnection())
        {
            await conn.ExecuteAsync("""
                UPDATE users
                SET matrix_access_token = 'legacy_plaintext',
                    token_expires_at = NULL
                WHERE id = 1
                """);
        }

        var now = DateTimeOffset.Parse("2026-08-12T09:00:00Z").ToUnixTimeMilliseconds();
        var migrated = await _store.ProtectLegacyTokensAsync(now);

        Assert.AreEqual(1, migrated);

        using var verify = _db.CreateConnection();
        var row = await verify.QuerySingleAsync<(string Token, long ExpiresAt)>("""
            SELECT matrix_access_token AS Token,
                   token_expires_at AS ExpiresAt
            FROM users
            WHERE id = 1
            """);

        Assert.AreNotEqual("legacy_plaintext", row.Token);
        StringAssert.StartsWith(row.Token, "dp:v1:");
        Assert.AreEqual(now, row.ExpiresAt);
        Assert.AreEqual("legacy_plaintext", (await _store.GetAsync(1))!.AccessToken);
    }

    [TestMethod]
    public async Task GetExpiredAsync_ReturnsOnlyExpiredLeases()
    {
        await _store.SaveAsync(1, "syt_expired", 1000);

        using (var conn = _db.CreateConnection())
        {
            await conn.ExecuteAsync("""
                INSERT INTO users (cert_hash, display_name, matrix_user_id)
                VALUES ('cert-2', 'Bob', '@2:test.local')
                """);
        }
        await _store.SaveAsync(2, "syt_fresh", 5000);

        var expired = await _store.GetExpiredAsync(2000);

        Assert.AreEqual(1, expired.Count);
        Assert.AreEqual(1L, expired[0].UserId);
        Assert.AreEqual("syt_expired", expired[0].AccessToken);
    }
}
