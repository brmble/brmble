using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Services.Games;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class GameServiceTests
{
    [DataTestMethod]
    [DataRow("game.invite", "games/invite", "{\"targetSessionId\":77,\"gameType\":\"rps\",\"options\":{\"bestOf\":5}}")]
    [DataRow("game.respond", "games/respond", "{\"offerId\":9,\"accept\":true}")]
    [DataRow("game.cancelOffer", "games/offers/cancel", "{\"offerId\":9}")]
    [DataRow("game.ready", "games/ready", "{\"reservationId\":12,\"ready\":true}")]
    [DataRow("game.ready", "games/ready", "{\"reservationId\":12,\"ready\":false}")]
    [DataRow("game.rematch", "games/rematch", "{\"sourceMatchId\":15}")]
    [DataRow("game.action", "games/action", "{\"matchId\":15,\"action\":{\"move\":\"rock\"}}")]
    [DataRow("game.forfeit", "games/forfeit", "{\"matchId\":15}")]
    public async Task Command_ForwardsExactPathAndBody(string command, string expectedPath, string json)
    {
        Uri? uri = null;
        string? body = null;
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = CreateService(bridge, cert, (calledUri, calledBody) =>
        {
            uri = calledUri;
            body = calledBody;
            return new(true, "{}", 200, null);
        });
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, command, JsonSerializer.Deserialize<JsonElement>(json));

        Assert.AreEqual(new Uri($"https://api.example/{expectedPath}"), uri);
        AssertJsonEqual(json, body!);
    }

    [TestMethod]
    public async Task QueueRequest_GetsQueueAndReturnsCorrelatedResult()
    {
        Uri? uri = null;
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = new GameService(bridge, null, () => "https://api.example/",
            (_, _, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, "{}", 200, null)),
            (_, calledUri) =>
            {
                uri = calledUri;
                return Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(false, "queue-body", 409, "queue-error"));
            },
            () => cert);
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "games.request",
            JsonSerializer.SerializeToElement(new { requestId = 42, action = "queue" }));

        Assert.AreEqual(new Uri("https://api.example/games/queue"), uri);
        var response = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "games.response");
        using var document = JsonDocument.Parse(response.DataJson);
        Assert.AreEqual(42, document.RootElement.GetProperty("requestId").GetInt32());
        Assert.IsFalse(document.RootElement.GetProperty("success").GetBoolean());
        Assert.AreEqual("queue-body", document.RootElement.GetProperty("body").GetString());
        Assert.AreEqual(409, document.RootElement.GetProperty("statusCode").GetInt32());
        Assert.AreEqual("queue-error", document.RootElement.GetProperty("error").GetString());
    }

    [TestMethod]
    public async Task Command_ServerErrorBody_PreservesStructuredReason()
    {
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = CreateService(bridge, cert, (_, _) =>
            new(false, "{\"error\":\"Not your offer\",\"reason\":\"notParticipant\"}", 400, "Bad Request"));
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "game.cancelOffer",
            JsonSerializer.SerializeToElement(new { offerId = 9 }));

        var error = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "game.error");
        using var document = JsonDocument.Parse(error.DataJson);
        Assert.AreEqual("Not your offer", document.RootElement.GetProperty("error").GetString());
        Assert.AreEqual("notParticipant", document.RootElement.GetProperty("reason").GetString());
        Assert.AreEqual(400, document.RootElement.GetProperty("statusCode").GetInt32());
    }

    [DataTestMethod]
    [DataRow("game.ready", "{\"reservationId\":12,\"ready\":true}", "games/ready", "reservationId", 12L)]
    [DataRow("game.respond", "{\"offerId\":9,\"accept\":true}", "games/respond", "offerId", 9L)]
    [DataRow("game.rematch", "{\"sourceMatchId\":15}", "games/rematch", "sourceMatchId", 15L)]
    public async Task Command_ErrorCorrelatesCommandPathAndIdentifier(
        string command, string json, string path, string idProperty, long id)
    {
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = CreateService(bridge, cert, (_, _) =>
            new(false, "{\"error\":\"Rejected\",\"reason\":\"stale\"}", 409, "Conflict"));
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, command, JsonSerializer.Deserialize<JsonElement>(json));

        var error = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "game.error");
        using var document = JsonDocument.Parse(error.DataJson);
        Assert.AreEqual(command, document.RootElement.GetProperty("command").GetString());
        Assert.AreEqual(path, document.RootElement.GetProperty("path").GetString());
        Assert.AreEqual(id, document.RootElement.GetProperty(idProperty).GetInt64());
        Assert.AreEqual("stale", document.RootElement.GetProperty("reason").GetString());
    }

    [TestMethod]
    public async Task Command_ChunkedServerErrorThroughAdapter_PreservesStructuredReason()
    {
        const string firstChunk = "{\"error\":\"Not your ";
        const string secondChunk = "offer\",\"reason\":\"notParticipant\"}";
        var rawResponse = "HTTP/1.1 400 Bad Request\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n"
            + $"{firstChunk.Length:X};source=Kestrel\r\n{firstChunk}\r\n"
            + $"{secondChunk.Length:X}\r\n{secondChunk}\r\n"
            + "0\r\nRequest-Id: abc\r\n\r\n";
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = CreateService(bridge, cert, (_, _) => MumbleAdapter.ParseHttpResponse(rawResponse));
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "game.cancelOffer",
            JsonSerializer.SerializeToElement(new { offerId = 9 }));

        var error = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "game.error");
        using var document = JsonDocument.Parse(error.DataJson);
        Assert.AreEqual("Not your offer", document.RootElement.GetProperty("error").GetString());
        Assert.AreEqual("notParticipant", document.RootElement.GetProperty("reason").GetString());
    }

    [TestMethod]
    public async Task QueueRequest_MalformedApiUrl_ReturnsCorrelatedError()
    {
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = new GameService(bridge, null, () => "not an absolute URI",
            (_, _, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, "{}", 200, null)),
            (_, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, "{}", 200, null)),
            () => cert);
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "games.request",
            JsonSerializer.SerializeToElement(new { requestId = 73, action = "queue" }));

        var response = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "games.response");
        using var document = JsonDocument.Parse(response.DataJson);
        Assert.AreEqual(73, document.RootElement.GetProperty("requestId").GetInt32());
        Assert.IsFalse(document.RootElement.GetProperty("success").GetBoolean());
        Assert.IsFalse(string.IsNullOrWhiteSpace(document.RootElement.GetProperty("error").GetString()));
    }

    [TestMethod]
    public async Task Command_MalformedApiUrl_ReportsGameError()
    {
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = new GameService(bridge, null, () => "not an absolute URI",
            (_, _, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, "{}", 200, null)),
            (_, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, "{}", 200, null)),
            () => cert);
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "game.cancelOffer",
            JsonSerializer.SerializeToElement(new { offerId = 9 }));

        var error = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "game.error");
        using var document = JsonDocument.Parse(error.DataJson);
        Assert.IsFalse(string.IsNullOrWhiteSpace(document.RootElement.GetProperty("error").GetString()));
    }

    private static GameService CreateService(
        Brmble.Client.Bridge.NativeBridge bridge,
        X509Certificate2 certificate,
        Func<Uri, string, ChannelRequestBridgeHandler.TlsCallResult> post) =>
        new(bridge, null, () => "https://api.example/",
            (_, uri, body) => Task.FromResult(post(uri, body)),
            (_, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, "{}", 200, null)),
            () => certificate);

    private static X509Certificate2 CreateCertificate()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=GameServiceTests", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(5));
    }

    private static void AssertJsonEqual(string expected, string actual)
    {
        using var expectedDocument = JsonDocument.Parse(expected);
        using var actualDocument = JsonDocument.Parse(actual);
        Assert.IsTrue(JsonElement.DeepEquals(expectedDocument.RootElement, actualDocument.RootElement));
    }
}
