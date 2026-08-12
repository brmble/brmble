using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Tests.TestSupport;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;
using Dapper;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public sealed class MatrixTokenRevocationServiceTests
{
    private SqliteConnection _keepAlive = null!;
    private Database _db = null!;
    private MatrixTokenStore _store = null!;
    private TestTimeProvider _clock = null!;

    private sealed class TestTimeProvider : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.Parse("2026-08-12T09:00:00Z");
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }

    [TestInitialize]
    public void Setup()
    {
        var dbName = "matrix_revocation_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        _store = new MatrixTokenStore(_db, new EphemeralDataProtectionProvider());
        _clock = new TestTimeProvider();

        using var conn = _db.CreateConnection();
        conn.Execute("INSERT INTO users (cert_hash, display_name, matrix_user_id) VALUES ('cert-1', 'Alice', '@1:test.local')");
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive.Dispose();

    [TestMethod]
    public async Task RevokeExpiredOnce_Failure_DoesNotLogBearerOrExceptionMessage()
    {
        const string PlaintextToken = "matrix-plaintext-SENTINEL-347";
        var lease = await _store.SaveAsync(1, PlaintextToken, _clock.GetUtcNow().AddMinutes(-1).ToUnixTimeMilliseconds());
        var matrix = new Mock<IMatrixAppService>();
        matrix.Setup(m => m.RevokeAccessToken(PlaintextToken, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException($"synthetic failure {PlaintextToken} {lease.StoredValue}"));
        var logger = new CapturingLogger<MatrixTokenRevocationService>();
        var service = new MatrixTokenRevocationService(_store, matrix.Object,
            Options.Create(new MatrixSettings
            {
                AccessTokenRevocationRetryBaseSeconds = 60,
                AccessTokenRevocationRetryMaxSeconds = 900
            }), _clock, logger);

        await service.RevokeExpiredOnceAsync(CancellationToken.None);

        var logText = string.Join("\n", logger.Entries);
        Assert.IsFalse(logText.Contains(PlaintextToken, StringComparison.Ordinal));
        Assert.IsFalse(logText.Contains(lease.StoredValue, StringComparison.Ordinal));
        Assert.IsFalse(logText.Contains("synthetic failure", StringComparison.Ordinal));
        StringAssert.Contains(logText, nameof(HttpRequestException));
    }
}
