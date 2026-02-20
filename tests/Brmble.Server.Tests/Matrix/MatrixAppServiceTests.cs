using System.Net;
using System.Text.Json;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using Microsoft.VisualStudio.TestTools.UnitTesting;

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

        _svc = new MatrixAppService(factory.Object, settings);
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
}
