using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using System.Linq;
using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceTests
{
    private LiveKitService _svc = null!;
    private Mock<UserRepository> _mockUserRepo = null!;

    [TestInitialize]
    public void Setup()
    {
        var settings = Options.Create(new LiveKitSettings
        {
            ApiKey = "test-api-key",
            ApiSecret = "testsecret0123456789abcdef01234567890abcdef01234567890abcdef0123"
        });
        var matrixSettings = Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost:8008",
            AppServiceToken = "test-token"
        });
        _mockUserRepo = new Mock<UserRepository>(
            new Mock<Database>("Data Source=:memory:").Object,
            matrixSettings);
        var roomClient = new Mock<ILiveKitRoomClient>();
        _svc = new LiveKitService(settings, _mockUserRepo.Object, roomClient.Object,
            NullLogger<LiveKitService>.Instance);
    }

    [TestMethod]
    public async Task GenerateToken_KnownUser_ReturnsNonEmptyJwt()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
            .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

        var token = await _svc.GenerateToken("cert123", "room-1", LiveKitAccessMode.Publish);

        Assert.IsNotNull(token);
        Assert.IsTrue(token.Length > 0);
        // JWT has 3 dot-separated parts
        Assert.AreEqual(3, token.Split('.').Length);
    }

    [TestMethod]
    public async Task GenerateToken_GrantsIncludeSubscribe()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
            .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

        var token = await _svc.GenerateToken("cert123", "room-1", LiveKitAccessMode.Publish);
        Assert.IsNotNull(token);

        // Decode JWT payload (base64url)
        var parts = token.Split('.');
        var payload = parts[1];
        payload = payload.Replace('-', '+').Replace('_', '/');
        switch (payload.Length % 4)
        {
            case 2: payload += "=="; break;
            case 3: payload += "="; break;
        }
        var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var video = doc.RootElement.GetProperty("video");
        Assert.IsTrue(video.GetProperty("canSubscribe").GetBoolean());
        Assert.IsTrue(video.GetProperty("canPublish").GetBoolean());
    }

    [TestMethod]
    public async Task GenerateToken_SubscribeMode_GrantsSubscribeButNotPublish()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
            .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

        var token = await _svc.GenerateToken("cert123", "channel-1", LiveKitAccessMode.Subscribe);
        Assert.IsNotNull(token);

        var parts = token.Split('.');
        var payload = parts[1].Replace('-', '+').Replace('_', '/');
        switch (payload.Length % 4)
        {
            case 2: payload += "=="; break;
            case 3: payload += "="; break;
        }

        var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var video = doc.RootElement.GetProperty("video");

        Assert.IsTrue(video.GetProperty("canSubscribe").GetBoolean());
        Assert.IsFalse(video.GetProperty("canPublish").GetBoolean());
    }

    [TestMethod]
    public async Task GenerateToken_PublishMode_GrantsPublishAndSubscribe()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
            .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

        var token = await _svc.GenerateToken("cert123", "channel-1", LiveKitAccessMode.Publish);
        Assert.IsNotNull(token);

        var parts = token.Split('.');
        var payload = parts[1].Replace('-', '+').Replace('_', '/');
        switch (payload.Length % 4)
        {
            case 2: payload += "=="; break;
            case 3: payload += "="; break;
        }

        var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var video = doc.RootElement.GetProperty("video");

        Assert.IsTrue(video.GetProperty("canSubscribe").GetBoolean());
        Assert.IsTrue(video.GetProperty("canPublish").GetBoolean());
    }

    [TestMethod]
    public async Task GenerateTokenMetadata_UsesShortLivedExpiry()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
            .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

        var issuedAt = DateTimeOffset.UtcNow;
        var metadata = await _svc.GenerateTokenMetadata("cert123", "channel-1", LiveKitAccessMode.Subscribe, issuedAt);

        Assert.IsNotNull(metadata);
        Assert.IsTrue(metadata.ExpiresAt > issuedAt);
        Assert.IsTrue(metadata.ExpiresAt <= issuedAt.AddHours(1).AddMinutes(1));
    }

    [TestMethod]
    public async Task AuthorizeTokenRequest_PublishDenied_ReturnsForbidden()
    {
        var result = await _svc.AuthorizeTokenRequest(
            "cert123",
            "channel-1",
            LiveKitAccessMode.Publish,
            canPublish: false,
            canSubscribe: true);

        Assert.IsFalse(result.Allowed);
        Assert.AreEqual(LiveKitAuthorizationFailure.Forbidden, result.Failure);
    }

    [TestMethod]
    public async Task AuthorizeTokenRequest_SubscribeAllowed_ReturnsSuccess()
    {
        var result = await _svc.AuthorizeTokenRequest(
            "cert123",
            "channel-1",
            LiveKitAccessMode.Subscribe,
            canPublish: false,
            canSubscribe: true);

        Assert.IsTrue(result.Allowed);
        Assert.AreEqual(LiveKitAccessMode.Subscribe, result.AccessMode);
    }

    [TestMethod]
    public async Task AuthorizeTokenRequest_SubscribeDenied_ReturnsForbidden()
    {
        var result = await _svc.AuthorizeTokenRequest(
            "cert123",
            "channel-1",
            LiveKitAccessMode.Subscribe,
            canPublish: false,
            canSubscribe: false);

        Assert.IsFalse(result.Allowed);
        Assert.AreEqual(LiveKitAuthorizationFailure.Forbidden, result.Failure);
    }

    [TestMethod]
    public async Task GenerateToken_UnknownUser_ReturnsNull()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("unknown"))
            .ReturnsAsync((User?)null);

        var token = await _svc.GenerateToken("unknown", "room-1", LiveKitAccessMode.Publish);

        Assert.IsNull(token);
    }

    [TestMethod]
    public void LiveKitAuthorizationResult_HasNoPublicConstructors()
    {
        var publicConstructors = typeof(LiveKitAuthorizationResult)
            .GetConstructors(BindingFlags.Instance | BindingFlags.Public);

        Assert.AreEqual(0, publicConstructors.Length);
    }

    [TestMethod]
    public void LiveKitAuthorizationResult_HasNoPublicPropertySetters()
    {
        var writableProperties = typeof(LiveKitAuthorizationResult)
            .GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(p => p.SetMethod?.IsPublic == true)
            .Select(p => p.Name)
            .ToArray();

        CollectionAssert.AreEqual(Array.Empty<string>(), writableProperties);
    }

    [TestMethod]
    public void GenerateToken_LegacyOverload_IsObsolete()
    {
        var legacyOverload = typeof(LiveKitService)
            .GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .Single(m => m.Name == nameof(LiveKitService.GenerateToken)
                && m.GetParameters().Length == 2);

        var obsolete = legacyOverload.GetCustomAttribute<ObsoleteAttribute>();

        Assert.IsNotNull(obsolete);
        StringAssert.Contains(obsolete.Message ?? string.Empty, "access mode");
    }
}
