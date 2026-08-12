// tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Brmble.Server.Tests.TestSupport;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.DataProtection;
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
    private Mock<IMumbleRegistrationService>? _mockMumbleReg;
    private Mock<ISessionMappingService>? _mockSessionMapping;
    private MatrixTokenStore? _matrixTokenStore;
    private TestTimeProvider? _clock;
    private CapturingLogger<AuthService>? _logger;

    private sealed class TestTimeProvider : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = DateTimeOffset.Parse("2026-08-12T09:00:00Z");
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }

    [TestInitialize]
    public void Setup()
    {
        var dbName = "authsvc_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        var settings = Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost",
            AppServiceToken = "test",
            ServerDomain = "test.local",
            AccessTokenLifetimeMinutes = 60,
            AccessTokenRefreshSkewMinutes = 5,
            AccessTokenRevocationSweepSeconds = 30,
            AccessTokenRevocationRetryBaseSeconds = 60,
            AccessTokenRevocationRetryMaxSeconds = 900,
        });
        var repo = new UserRepository(db, settings);
        _repo = repo;
        _clock = new TestTimeProvider();
        _matrixTokenStore = new MatrixTokenStore(db, new EphemeralDataProtectionProvider());
        _mockMatrix = new Mock<IMatrixAppService>();
        _mockMatrix.Setup(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()))
                   .ReturnsAsync("syt_new_token");
        _mockMatrix.Setup(m => m.LoginUser(It.IsAny<string>()))
                   .ReturnsAsync("syt_refresh_token");
        _mockMatrix.Setup(m => m.RevokeAccessToken(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                   .Returns(Task.CompletedTask);
        _mockMumbleReg = new Mock<IMumbleRegistrationService>();
        _mockSessionMapping = new Mock<ISessionMappingService>();
        _logger = new CapturingLogger<AuthService>();
        var mockEventBus = new Mock<IBrmbleEventBus>();
        mockEventBus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
        _svc = new AuthService(repo, _mockMatrix.Object, _logger,
            _mockMumbleReg.Object, _mockSessionMapping.Object,
            new MappingEventPublisher(_mockSessionMapping.Object, mockEventBus.Object),
            _matrixTokenStore, settings, _clock);
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
        await _svc.DeactivateAsync("existinghash");
        await _svc.Authenticate("existinghash");
        Assert.IsTrue(_svc.IsBrmbleClient("existinghash"));
    }

    [TestMethod]
    public async Task Deactivate_AfterAuthenticate_RemovesFromActiveSessions()
    {
        await _svc!.Authenticate("todeactivate");
        await _svc.DeactivateAsync("todeactivate");
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

    [TestMethod]
    public async Task TrackMumbleName_AfterAuthenticate_IsBrmbleClientByName()
    {
        await _svc!.Authenticate("tracktest");
        _svc.TrackMumbleName("TrackedUser", active: true);
        Assert.IsTrue(_svc.IsBrmbleClientByName("TrackedUser"));
    }

    [TestMethod]
    public void TrackMumbleName_WithCertHashAndActive_RestoresBrmbleSession()
    {
        _svc!.TrackMumbleName("TrackedUser", "tracktest", active: true);

        Assert.IsTrue(_svc.IsBrmbleClient("tracktest"));
        Assert.IsTrue(_svc.IsBrmbleClientByName("TrackedUser"));
    }

    [TestMethod]
    public void TrackMumbleName_WithCertHash_DoesNotActivateBrmbleSession()
    {
        _svc!.TrackMumbleName("TrackedUser", "tracktest");

        Assert.IsFalse(_svc.IsBrmbleClient("tracktest"));
        Assert.IsFalse(_svc.IsBrmbleClientByName("TrackedUser"));
    }

    [TestMethod]
    public async Task TrackMumbleName_WrongName_IsNotBrmbleClientByCorrectName()
    {
        // Simulates the bug scenario: tracking "WrongName" means
        // IsBrmbleClientByName("RealName") returns false
        await _svc!.Authenticate("mismatchtest");
        _svc.TrackMumbleName("WrongName", active: true);
        Assert.IsTrue(_svc.IsBrmbleClientByName("WrongName"));
        Assert.IsFalse(_svc.IsBrmbleClientByName("RealName"));
    }

    [TestMethod]
    public async Task Deactivate_RemovesTrackedName()
    {
        await _svc!.Authenticate("deactivatetrack");
        _svc.TrackMumbleName("TrackedDeactivate", "deactivatetrack", active: true);
        Assert.IsTrue(_svc.IsBrmbleClientByName("TrackedDeactivate"));
        await _svc.DeactivateAsync("deactivatetrack");
        Assert.IsFalse(_svc.IsBrmbleClientByName("TrackedDeactivate"));
    }

    [TestMethod]
    public async Task TrackMumbleName_RetrackWithCertHash_RemovesStaleName()
    {
        // Simulates: user first tracked under raw name, then re-tracked
        // under the resolved registered name with the same certHash.
        // The old name must be removed from _activeNames.
        await _svc!.Authenticate("retrackhash");
        _svc.TrackMumbleName("RawName", "retrackhash", active: true);
        Assert.IsTrue(_svc.IsBrmbleClientByName("RawName"));

        _svc.TrackMumbleName("RegisteredName", "retrackhash", active: true);
        Assert.IsTrue(_svc.IsBrmbleClientByName("RegisteredName"));
        Assert.IsFalse(_svc.IsBrmbleClientByName("RawName"),
            "Stale name should be removed when re-tracked under same certHash");
    }

    [TestMethod]
    public async Task Authenticate_ExistingUnexpiredLease_ReturnsStoredTokenWithoutLogin()
    {
        var first = await _svc!.Authenticate("lease-valid");
        _mockMatrix!.Invocations.Clear();

        var second = await _svc.Authenticate("lease-valid");

        Assert.AreEqual(first.MatrixAccessToken, second.MatrixAccessToken);
        _mockMatrix.Verify(m => m.LoginUser(It.IsAny<string>()), Times.Never);
        _mockMatrix.Verify(m => m.RevokeAccessToken(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task Authenticate_LeaseInsideRefreshWindow_RevokesThenRotates()
    {
        var first = await _svc!.Authenticate("lease-refresh");
        _clock!.UtcNow = first.MatrixAccessTokenRefreshAt.AddSeconds(1);
        _mockMatrix!.Setup(m => m.LoginUser(It.IsAny<string>())).ReturnsAsync("syt_rotated");

        var second = await _svc.Authenticate("lease-refresh");

        Assert.AreEqual("syt_rotated", second.MatrixAccessToken);
        _mockMatrix.Verify(m => m.RevokeAccessToken(first.MatrixAccessToken, It.IsAny<CancellationToken>()), Times.Once);
        _mockMatrix.Verify(m => m.LoginUser(It.IsAny<string>()), Times.Once);
        Assert.IsTrue(second.MatrixAccessTokenExpiresAt > first.MatrixAccessTokenExpiresAt);
    }

    [TestMethod]
    public async Task Authenticate_ConcurrentRefresh_RotatesOnlyOnce()
    {
        var first = await _svc!.Authenticate("lease-concurrent");
        _clock!.UtcNow = first.MatrixAccessTokenRefreshAt.AddSeconds(1);
        _mockMatrix!.Invocations.Clear();
        _mockMatrix.Setup(m => m.LoginUser(It.IsAny<string>())).ReturnsAsync("syt_concurrent_rotated");

        var results = await Task.WhenAll(_svc.Authenticate("lease-concurrent"), _svc.Authenticate("lease-concurrent"));

        Assert.AreEqual(results[0].MatrixAccessToken, results[1].MatrixAccessToken);
        _mockMatrix.Verify(m => m.LoginUser(It.IsAny<string>()), Times.Once);
        _mockMatrix.Verify(m => m.RevokeAccessToken(first.MatrixAccessToken, It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task Authenticate_RevokeFailure_DoesNotIssueReplacement()
    {
        var first = await _svc!.Authenticate("lease-revoke-fail");
        var user = await _repo!.GetByCertHash("lease-revoke-fail");
        var lease = await _matrixTokenStore!.GetAsync(user!.Id);
        _clock!.UtcNow = first.MatrixAccessTokenRefreshAt.AddSeconds(1);
        _mockMatrix!.Invocations.Clear();
        _mockMatrix.Setup(m => m.RevokeAccessToken(first.MatrixAccessToken, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException($"synthetic failure {first.MatrixAccessToken} {lease!.StoredValue}"));

        await Assert.ThrowsExceptionAsync<HttpRequestException>(() => _svc.Authenticate("lease-revoke-fail"));

        _mockMatrix.Verify(m => m.LoginUser(It.IsAny<string>()), Times.Never);
        var logText = string.Join("\n", _logger!.Entries);
        Assert.IsFalse(logText.Contains(first.MatrixAccessToken, StringComparison.Ordinal));
        Assert.IsFalse(logText.Contains(lease!.StoredValue, StringComparison.Ordinal));
        Assert.IsFalse(logText.Contains("synthetic failure", StringComparison.Ordinal));
        StringAssert.Contains(logText, nameof(HttpRequestException));
    }

    [TestMethod]
    public async Task Authenticate_MigratedLegacyExpiredLease_RevokesBeforeReturningReplacement()
    {
        var user = await _repo!.Insert("legacy-cert", "Legacy");
        using (var conn = _keepAlive!.CreateCommand())
        {
            conn.CommandText = "UPDATE users SET matrix_access_token = 'syt_legacy_plaintext', token_expires_at = NULL WHERE id = $id";
            conn.Parameters.AddWithValue("$id", user.Id);
            conn.ExecuteNonQuery();
        }

        await _matrixTokenStore!.ProtectLegacyTokensAsync(_clock!.GetUtcNow().ToUnixTimeMilliseconds());
        _mockMatrix!.Setup(m => m.LoginUser(user.Id.ToString())).ReturnsAsync("syt_after_migration");

        var result = await _svc!.Authenticate("legacy-cert");

        Assert.AreEqual("syt_after_migration", result.MatrixAccessToken);
        _mockMatrix.Verify(m => m.RevokeAccessToken("syt_legacy_plaintext", It.IsAny<CancellationToken>()), Times.Once);
        Assert.IsFalse(result.MatrixAccessToken.Contains("dp:v1:", StringComparison.Ordinal));
    }
}
