using System.Net;
using System.Text.Json;
using Brmble.Server.Matrix;
using Brmble.Server.Tests.TestSupport;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;
using Moq.Protected;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixAppServiceTests
{
    private Mock<HttpMessageHandler> _mockHandler = null!;
    private MatrixAppService _svc = null!;
    private List<HttpRequestMessage> _capturedRequests = null!;
    private CapturingLogger<MatrixAppService> _logger = null!;

    [TestInitialize]
    public void Setup()
    {
        _capturedRequests = [];
        _logger = new CapturingLogger<MatrixAppService>();
        _mockHandler = new Mock<HttpMessageHandler>(MockBehavior.Strict);

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns(new HttpClient(_mockHandler.Object));

        var settings = Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost:8008",
            AppServiceToken = "test-token",
            AdminAccessToken = "test-admin-token"
        });

        _svc = new MatrixAppService(factory.Object, settings, _logger);
    }

    private void SetupHttpResponse(HttpStatusCode status, string body = "{}")
    {
        _mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => _capturedRequests.Add(req))
            .ReturnsAsync(new HttpResponseMessage(status)
            {
                Content = new StringContent(body)
            });
    }

    private MatrixAppService CreateServiceReturning(string body, HttpStatusCode status = HttpStatusCode.OK)
    {
        SetupHttpResponse(status, body);
        return _svc;
    }

    private string LastJsonBody()
    {
        var request = _capturedRequests.Last();
        return request.Content is null
            ? string.Empty
            : request.Content.ReadAsStringAsync().GetAwaiter().GetResult();
    }

    private IReadOnlyList<HttpRequestMessage> SentRequests => _capturedRequests;

    [TestMethod]
    public async Task DeletePaintRoom_TreatsAuthoritativeMissingRoomAsRemoved()
    {
        SetupHttpResponse(HttpStatusCode.NotFound, """{"errcode":"M_NOT_FOUND","error":"Unknown room"}""");

        var result = await _svc.DeletePaintRoomAsync("!removed:server", CancellationToken.None);

        Assert.IsTrue(result.Removed);
        Assert.AreEqual("admin-delete-already-absent", result.Mode);
        Assert.IsNull(result.Error);
    }

    [TestMethod]
    public async Task SendMessage_SendsPutWithCorrectPath()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SendMessage("!room:server", "Alice", "hello");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Put, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath,
            "/_matrix/client/v3/rooms/!room:server/send/m.room.message/");
    }

    [TestMethod]
    public async Task SendMessage_SendsBearerToken()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SendMessage("!room:server", "Alice", "hello");

        var req = _capturedRequests.Single();
        Assert.AreEqual("test-token", req.Headers.Authorization!.Parameter);
        Assert.AreEqual("Bearer", req.Headers.Authorization!.Scheme);
    }

    [TestMethod]
    public async Task SendMessage_BodyContainsDisplayNameAndText()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SendMessage("!room:server", "Alice", "hello world");

        var req = _capturedRequests.Single();
        var body = await req.Content!.ReadAsStringAsync();
        StringAssert.Contains(body, "[Alice]");
        StringAssert.Contains(body, "hello world");
    }

    [TestMethod]
    public async Task CreateRoom_ReturnsRoomId()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            JsonSerializer.Serialize(new { room_id = "!newroom:server" }));

        var roomId = await _svc.CreateRoom("General");

        Assert.AreEqual("!newroom:server", roomId);
    }

    [TestMethod]
    public async Task CreateRoom_SendsPostToCreateRoomEndpoint()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            JsonSerializer.Serialize(new { room_id = "!newroom:server" }));

        await _svc.CreateRoom("General");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Post, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath, "/_matrix/client/v3/createRoom");
    }

    [TestMethod]
    public async Task SetRoomName_SendsPutToRoomNameStateEndpoint()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SetRoomName("!room:server", "New Name");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Put, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath, "m.room.name");
    }

    [TestMethod]
    public async Task SendRequest_IncludesUserIdQueryParameter()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            JsonSerializer.Serialize(new { room_id = "!newroom:server" }));

        await _svc.CreateRoom("General");

        var req = _capturedRequests.Single();
        StringAssert.Contains(req.RequestUri!.Query, "user_id=%40brmble%3Alocalhost");
    }

    [TestMethod]
    public async Task RegisterUser_PostsToRegisterEndpoint_ReturnsToken()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            """{"access_token":"syt_test","user_id":"@1:server","device_id":"DEV"}""");

        var token = await _svc.RegisterUser("1", "Alice");

        Assert.AreEqual("syt_test", token);
        var regReq = _capturedRequests.First(r => r.RequestUri!.AbsoluteUri.Contains("register"));
        Assert.AreEqual(HttpMethod.Post, regReq.Method);
        StringAssert.Contains(regReq.RequestUri!.Query, "kind=user");
    }

    [TestMethod]
    public async Task LoginUser_PostsToLoginEndpoint_ReturnsToken()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            """{"access_token":"syt_refreshed","user_id":"@1:server","device_id":"DEV2"}""");

        var token = await _svc.LoginUser("1");

        Assert.AreEqual("syt_refreshed", token);
        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Post, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsoluteUri, "login");
    }

    [TestMethod]
    public async Task RevokeAccessToken_PostsLogoutWithUserBearerToken()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.RevokeAccessToken("syt_user_token");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Post, req.Method);
        Assert.AreEqual("/_matrix/client/v3/logout", req.RequestUri!.AbsolutePath);
        Assert.AreEqual(string.Empty, req.RequestUri.Query);
        Assert.AreEqual("Bearer", req.Headers.Authorization!.Scheme);
        Assert.AreEqual("syt_user_token", req.Headers.Authorization.Parameter);
    }

    [TestMethod]
    public async Task RevokeAccessToken_Unauthorized_IsAlreadyRevoked()
    {
        SetupHttpResponse(HttpStatusCode.Unauthorized,
            """{"errcode":"M_UNKNOWN_TOKEN","error":"Unknown access token"}""");

        await _svc.RevokeAccessToken("syt_already_gone");
    }

    [TestMethod]
    public async Task RevokeAccessToken_ServerError_Throws()
    {
        SetupHttpResponse(HttpStatusCode.InternalServerError);

        await Assert.ThrowsExceptionAsync<HttpRequestException>(
            () => _svc.RevokeAccessToken("syt_still_unknown"));
    }

    [TestMethod]
    public async Task RevokeAccessToken_ServerError_DoesNotLogBearerToken()
    {
        const string PlaintextToken = "matrix-plaintext-SENTINEL-347";
        SetupHttpResponse(HttpStatusCode.InternalServerError,
            $"{{\"error\":\"synthetic failure {PlaintextToken}\"}}");

        await Assert.ThrowsExceptionAsync<HttpRequestException>(
            () => _svc.RevokeAccessToken(PlaintextToken));

        var logText = string.Join("\n", _logger.Entries);
        Assert.IsFalse(logText.Contains(PlaintextToken, StringComparison.Ordinal));
        Assert.IsFalse(logText.Contains("synthetic failure", StringComparison.Ordinal));
        StringAssert.Contains(logText, "500");
    }

    [TestMethod]
    public async Task UploadMedia_PostsToMediaEndpointWithContentType()
    {
        SetupHttpResponse(HttpStatusCode.OK,
            """{"content_uri":"mxc://server/abc123"}""");

        var result = await _svc.UploadMedia(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, "image/png", "image.png");

        Assert.AreEqual("mxc://server/abc123", result);
        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Post, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath, "/_matrix/media/v3/upload");
        Assert.AreEqual("image/png", req.Content!.Headers.ContentType!.MediaType);
    }

    [TestMethod]
    public async Task SendImageMessage_SendsImageEventToRoom()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SendImageMessage("!room:server", "Alice", "mxc://server/abc123", "image.png", "image/png", 1234);

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Put, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath, "/_matrix/client/v3/rooms/!room:server/send/m.room.message/");
        var body = await req.Content!.ReadAsStringAsync();
        StringAssert.Contains(body, "m.image");
        StringAssert.Contains(body, "mxc://server/abc123");
    }

    [TestMethod]
    public async Task SetAvatarUrl_SendsPutToAvatarUrlEndpoint()
    {
        SetupHttpResponse(HttpStatusCode.OK);

        await _svc.SetAvatarUrl("1", "mxc://server/abc123");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Put, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsolutePath,
            "/_matrix/client/v3/profile/%40" /* @1:localhost encoded */);
        StringAssert.Contains(req.RequestUri!.AbsolutePath, "avatar_url");
        var body = await req.Content!.ReadAsStringAsync();
        StringAssert.Contains(body, "mxc://server/abc123");
    }

    [TestMethod]
    public async Task CreatePaintRoom_UsesInviteOnlyStateAndDoesNotJoinUsers()
    {
        var svc = CreateServiceReturning("""{"room_id":"!paint:server"}""");

        var roomId = await svc.CreatePaintRoom("Paint in General", ["@alice:server", "@bob:server"]);

        Assert.AreEqual("!paint:server", roomId);
        var body = LastJsonBody();
        StringAssert.Contains(body, @"""preset"":""private_chat""");
        StringAssert.Contains(body, @"""invite"":[""@alice:server"",""@bob:server""]");
        StringAssert.Contains(body, @"""join_rule"":""invite""");
        StringAssert.Contains(body, @"""history_visibility"":""invited""");
        StringAssert.Contains(body, "m.room.power_levels");
        StringAssert.Contains(body, @"""invite"":50");
        Assert.IsFalse(SentRequests.Any(r => r.RequestUri!.AbsolutePath.Contains("/join/")));
    }

    [TestMethod]
    public async Task CreatePaintRoom_RetainsBotPowerForLaterReinvites()
    {
        var svc = CreateServiceReturning("""{"room_id":"!paint:server"}""");

        await svc.CreatePaintRoom("Paint in General", ["@alice:server"]);
        await svc.InvitePaintUser("!paint:server", "@alice:server");

        using var createPayload = JsonDocument.Parse(SentRequests.First().Content!.ReadAsStringAsync().GetAwaiter().GetResult());
        var powerLevels = createPayload.RootElement.GetProperty("initial_state")
            .EnumerateArray().Single(state => state.GetProperty("type").GetString() == "m.room.power_levels")
            .GetProperty("content");
        Assert.AreEqual(100, powerLevels.GetProperty("users").GetProperty("@brmble:localhost").GetInt32());
        var reinvite = SentRequests.Last();
        StringAssert.Contains(reinvite.RequestUri!.AbsolutePath, "/rooms/%21paint%3Aserver/invite");
        StringAssert.Contains(reinvite.RequestUri.Query, "user_id=%40brmble%3Alocalhost");
    }

    [TestMethod]
    public async Task DeletePaintRoom_ReportsMissingAdminTokenAsTerminal()
    {
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns(new HttpClient(_mockHandler.Object));
        var service = new MatrixAppService(factory.Object, Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost:8008",
            AppServiceToken = "test-token",
        }), NullLogger<MatrixAppService>.Instance);

        var result = await service.DeletePaintRoomAsync("!room:server", CancellationToken.None);

        Assert.IsFalse(result.Removed);
        Assert.AreEqual("admin-token-missing", result.Mode);
        Assert.AreEqual("MATRIX_ADMIN_TOKEN_MISSING", result.Error);
        Assert.IsTrue(result.Terminal);
    }

    [TestMethod]
    public async Task DownloadMedia_PreservesMxcServerAndMediaIdInDownloadPath()
    {
        SetupHttpResponse(HttpStatusCode.OK, "media");

        await _svc.DownloadMedia("mxc://media.example.org/abc123", CancellationToken.None);

        var request = _capturedRequests.Single();
        Assert.AreEqual("/_matrix/media/v3/download/media.example.org/abc123", request.RequestUri!.AbsolutePath);
    }

    [TestMethod]
    public async Task DownloadMedia_PreservesMxcServerAuthorityIncludingPortInDownloadPath()
    {
        SetupHttpResponse(HttpStatusCode.OK, "media");

        await _svc.DownloadMedia("mxc://media.example.org:8448/abc123", CancellationToken.None);

        var request = _capturedRequests.Single();
        Assert.AreEqual("/_matrix/media/v3/download/media.example.org%3A8448/abc123", request.RequestUri!.AbsolutePath);
    }

    [TestMethod]
    public async Task DownloadMedia_RejectsResponseBytesAboveTheSpecifiedLimit()
    {
        SetupHttpResponse(HttpStatusCode.OK, "media");

        await Assert.ThrowsExceptionAsync<InvalidDataException>(() =>
            _svc.DownloadMedia("mxc://media.example.org/abc123", 1, CancellationToken.None));
    }

    [TestMethod]
    public async Task CreateCustomCompanionGalleryRoom_LocksWritesAndHistory()
    {
        SetupHttpResponse(HttpStatusCode.OK, """{"room_id":"!gallery:test"}""");

        await _svc.CreateCustomCompanionGalleryRoom();

        var body = JsonDocument.Parse(LastJsonBody()).RootElement;
        Assert.AreEqual("private_chat", body.GetProperty("preset").GetString());
        var power = body.GetProperty("initial_state").EnumerateArray()
            .Single(item => item.GetProperty("type").GetString() == "m.room.power_levels")
            .GetProperty("content");
        Assert.AreEqual(100, power.GetProperty("state_default").GetInt32());
        Assert.AreEqual(100, power.GetProperty("events_default").GetInt32());
        Assert.AreEqual(100, power.GetProperty("redact").GetInt32());
        Assert.AreEqual(0, power.GetProperty("users_default").GetInt32());
    }

    [TestMethod]
    public async Task SendStateEvent_ReturnsMatrixEventId()
    {
        SetupHttpResponse(HttpStatusCode.OK, """{"event_id":"$sprite:test"}""");

        var eventId = await _svc.SendStateEvent(
            "!gallery:test", "im.brmble.sprite", "sprite-1", """{"schemaVersion":1}""");

        Assert.AreEqual("$sprite:test", eventId);
    }

    [TestMethod]
    public async Task RedactRoomEvent_SendsTheCallerSuppliedReason()
    {
        SetupHttpResponse(HttpStatusCode.OK, """{"event_id":"$redaction:test"}""");

        await _svc.RedactRoomEvent("!gallery:test", "$sprite:test", "Removed after persistence failure");

        var body = JsonDocument.Parse(LastJsonBody()).RootElement;
        Assert.AreEqual("Removed after persistence failure", body.GetProperty("reason").GetString());
    }

    [TestMethod]
    public async Task EnsureUserInRoom_ReturnsFalseWhenJoinFails()
    {
        SetupHttpResponse(
            HttpStatusCode.Forbidden,
            """{"errcode":"M_FORBIDDEN","error":"not invited"}""");

        Assert.IsFalse(await _svc.EnsureUserInRoom("alice", "!gallery:test"));
    }
}
