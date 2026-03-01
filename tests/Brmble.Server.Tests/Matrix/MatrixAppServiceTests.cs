using System.Net;
using System.Text.Json;
using Brmble.Server.Matrix;
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

    [TestInitialize]
    public void Setup()
    {
        _capturedRequests = [];
        _mockHandler = new Mock<HttpMessageHandler>(MockBehavior.Strict);

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns(new HttpClient(_mockHandler.Object));

        var settings = Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost:8008",
            AppServiceToken = "test-token"
        });

        _svc = new MatrixAppService(factory.Object, settings, NullLogger<MatrixAppService>.Instance);
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
    public async Task UploadMedia_PutsToMediaEndpointWithContentType()
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
    public async Task SendImageMessage_PutsImageEventToRoom()
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
}
