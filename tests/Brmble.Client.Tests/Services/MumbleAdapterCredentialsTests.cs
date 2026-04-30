using System.Net;
using System.Text;
using System.Text.Json;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

internal sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly HttpResponseMessage _response;
    private readonly Action<HttpRequestMessage>? _onSend;

    public FakeHttpMessageHandler(HttpResponseMessage response, Action<HttpRequestMessage>? onSend = null)
    {
        _response = response;
        _onSend = onSend;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        _onSend?.Invoke(request);
        return Task.FromResult(_response);
    }
}

[TestClass]
public class MumbleAdapterCredentialsTests
{
    private static readonly string ValidJson = """
        {"matrix":{"homeserverUrl":"https://matrix.example.com","accessToken":"tok_abc","userId":"@1:example.com","roomMap":{"42":"!room:example.com"}},"livekit":null}
        """;

    [TestMethod]
    public async Task FetchCredentials_Success_ReturnsCredentialsElement()
    {
        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(ValidJson, Encoding.UTF8, "application/json")
        });
        using var http = new HttpClient(handler);

        var result = await MumbleAdapter.FetchCredentials("https://api.example.com", http);

        Assert.IsNotNull(result);
        Assert.IsTrue(result.Value.TryGetProperty("matrix", out _));
    }

    [TestMethod]
    public async Task FetchCredentials_Unauthorized_ReturnsNull()
    {
        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.Unauthorized));
        using var http = new HttpClient(handler);

        var result = await MumbleAdapter.FetchCredentials("https://api.example.com", http);

        Assert.IsNull(result);
    }

    [TestMethod]
    public async Task FetchCredentials_SendsPostToAuthToken()
    {
        HttpRequestMessage? captured = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(ValidJson, Encoding.UTF8, "application/json")
            },
            req => captured = req);
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.example.com") };

        await MumbleAdapter.FetchCredentials("https://api.example.com", http);

        Assert.IsNotNull(captured);
        Assert.AreEqual(HttpMethod.Post, captured!.Method);
        Assert.IsNull(captured.Content); // empty body — identity comes from TLS handshake
    }

    [TestMethod]
    public void CreateLiveKitTokenRequestBody_Publish_UsesNamedAccessMode()
    {
        var json = MumbleAdapter.CreateLiveKitTokenRequestBody("channel-1", "publish");

        Assert.AreEqual("{\"roomName\":\"channel-1\",\"accessMode\":\"publish\"}", json);
    }

    [TestMethod]
    public void CreateLiveKitTokenRequestBody_Subscribe_UsesNamedAccessMode()
    {
        var json = MumbleAdapter.CreateLiveKitTokenRequestBody("channel-1", "subscribe");

        Assert.AreEqual("{\"roomName\":\"channel-1\",\"accessMode\":\"subscribe\"}", json);
    }

    [TestMethod]
    public void TryGetLiveKitAccessMode_NonStringValue_ReturnsFalse()
    {
        using var doc = JsonDocument.Parse("""
        {
            "accessMode": 1
        }
        """);

        var result = MumbleAdapter.TryGetLiveKitAccessMode(doc.RootElement, out var accessMode);

        Assert.IsFalse(result);
        Assert.IsNull(accessMode);
    }
}
