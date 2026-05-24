using System.Net;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;
using Moq.Protected;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public sealed class MatrixAppServiceRedactionTests
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
            AppServiceToken = "appservice-token"
        });

        _svc = new MatrixAppService(factory.Object, settings, NullLogger<MatrixAppService>.Instance);
    }

    [TestMethod]
    public async Task GetRoomEventAsync_UsesRequesterBearerToken()
    {
        SetupHttpResponse(HttpStatusCode.OK, """{"sender":"@alice:example.com","origin_server_ts":1716451200000,"type":"m.room.message"}""");

        await _svc.GetRoomEventAsync("!room:example.com", "$event:example.com", "user-token");

        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Get, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsoluteUri, "/_matrix/client/v3/rooms/!room:example.com/event/$event:example.com");
        Assert.AreEqual("Bearer", req.Headers.Authorization?.Scheme);
        Assert.AreEqual("user-token", req.Headers.Authorization?.Parameter);
    }

    [TestMethod]
    public async Task RedactEventAsync_UsesActingUserAndReturnsEventId()
    {
        SetupHttpResponse(HttpStatusCode.OK, """{"event_id":"$redaction:example.com"}""");

        var redactionEventId = await _svc.RedactEventAsync("!room:example.com", "$event:example.com", "txn-1", "brmble:self-delete", "@alice:example.com");

        Assert.AreEqual("$redaction:example.com", redactionEventId);
        var req = _capturedRequests.Single();
        Assert.AreEqual(HttpMethod.Put, req.Method);
        StringAssert.Contains(req.RequestUri!.AbsoluteUri, "/_matrix/client/v3/rooms/!room:example.com/redact/$event:example.com/txn-1");
        StringAssert.Contains(req.RequestUri!.Query, "user_id=%40alice%3Aexample.com");
        var body = await req.Content!.ReadAsStringAsync();
        StringAssert.Contains(body, "brmble:self-delete");
    }

    private void SetupHttpResponse(HttpStatusCode status, string body)
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
}
