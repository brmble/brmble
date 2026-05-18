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

    [TestMethod]
    public void ShouldRefreshCredentialsAfterHealthSuccess_FirstSuccessAfterInitialCredentials_ReturnsFalse()
    {
        var result = MumbleAdapter.ShouldRefreshCredentialsAfterHealthSuccess(
            credentialsAlreadyFetched: true,
            previousHealthWasConnected: false,
            sawHealthFailureSinceCredentials: false);

        Assert.IsFalse(result);
    }

    [TestMethod]
    public void ShouldRefreshCredentialsAfterHealthSuccess_RecoveryAfterFailure_ReturnsTrue()
    {
        var result = MumbleAdapter.ShouldRefreshCredentialsAfterHealthSuccess(
            credentialsAlreadyFetched: true,
            previousHealthWasConnected: false,
            sawHealthFailureSinceCredentials: true);

        Assert.IsTrue(result);
    }

    [TestMethod]
    public void ShouldRefreshCredentialsAfterHealthSuccess_InitialRecoveryAfterFailure_ReturnsTrue()
    {
        var result = MumbleAdapter.ShouldRefreshCredentialsAfterHealthSuccess(
            credentialsAlreadyFetched: false,
            previousHealthWasConnected: false,
            sawHealthFailureSinceCredentials: true);

        Assert.IsTrue(result);
    }

    [TestMethod]
    public void ShouldStartHealthCheckBeforeCredentialFetch_WithApiUrl_ReturnsTrue()
    {
        var result = MumbleAdapter.ShouldStartHealthCheckBeforeCredentialFetch("https://api.example.com");

        Assert.IsTrue(result);
    }

    [TestMethod]
    public void ShouldStartHealthCheckBeforeCredentialFetch_WithoutApiUrl_ReturnsFalse()
    {
        var result = MumbleAdapter.ShouldStartHealthCheckBeforeCredentialFetch(null);

        Assert.IsFalse(result);
    }

    [TestMethod]
    public void ShouldRefreshCredentialsAfterHealthSuccess_StillConnected_ReturnsFalse()
    {
        var result = MumbleAdapter.ShouldRefreshCredentialsAfterHealthSuccess(
            credentialsAlreadyFetched: true,
            previousHealthWasConnected: true,
            sawHealthFailureSinceCredentials: true);

        Assert.IsFalse(result);
    }

    [TestMethod]
    public void ShouldEmitSessionStoppedStatus_StaleCanceledGeneration_ReturnsFalse()
    {
        var result = MumbleAdapter.ShouldEmitSessionStoppedStatus(
            isCancellationRequested: true,
            currentGeneration: 2,
            taskGeneration: 1);

        Assert.IsFalse(result);
    }

    [TestMethod]
    public void CreateBrmbleServiceStatusPayload_WithReconnectContext_UsesExpectedShape()
    {
        var payload = MumbleAdapter.CreateBrmbleServiceStatusPayload(
            "session",
            "reconnecting",
            reason: "connection-lost",
            attempt: 2,
            delayMs: 4000);

        Assert.AreEqual("session", payload.Service);
        Assert.AreEqual("reconnecting", payload.State);
        Assert.AreEqual("connection-lost", payload.Reason);
        Assert.AreEqual(2, payload.Attempt);
        Assert.AreEqual(4000, payload.DelayMs);
    }

    [TestMethod]
    public void CreateBrmbleServiceStatusPayload_Connected_CanOmitReconnectContext()
    {
        var payload = MumbleAdapter.CreateBrmbleServiceStatusPayload("server", "connected");

        Assert.AreEqual("server", payload.Service);
        Assert.AreEqual("connected", payload.State);
        Assert.IsNull(payload.Reason);
        Assert.IsNull(payload.Attempt);
        Assert.IsNull(payload.DelayMs);
    }
}
