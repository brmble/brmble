using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class LiveKitTokenTests : IDisposable
{
    private readonly BrmbleServerFactory _factory;
    private readonly HttpClient _client;

    public LiveKitTokenTests()
    {
        _factory = new BrmbleServerFactory(certHash: "testcerthash123");
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task PostLiveKitToken_NoCert_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var body = new StringContent(
            JsonSerializer.Serialize(new { roomName = "channel-1", accessMode = "subscribe" }),
            Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/livekit/token", body);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task PostLiveKitToken_ValidCert_ReturnsTokenAndUrl()
    {
        // First authenticate to create the user record
        await _client.PostAsync("/auth/token", null);

        var body = new StringContent(
            JsonSerializer.Serialize(new { roomName = "channel-1", accessMode = "subscribe" }),
            Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/livekit/token", body);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.IsTrue(doc.RootElement.TryGetProperty("token", out var tokenProp));
        Assert.IsTrue(tokenProp.GetString()!.Split('.').Length == 3, "Should be a JWT");
        Assert.IsTrue(doc.RootElement.TryGetProperty("url", out _));
    }

    [TestMethod]
    public async Task PostLiveKitToken_CurrentEndpoint_IssuesSubscribeOnlyToken()
    {
        await _client.PostAsync("/auth/token", null);

        var body = new StringContent(
            JsonSerializer.Serialize(new { roomName = "channel-1", accessMode = "subscribe" }),
            Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/livekit/token", body);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var token = tokenFrom(doc.RootElement);

        using var tokenDoc = JsonDocument.Parse(DecodeJwtPayload(token));
        var video = tokenDoc.RootElement.GetProperty("video");

        Assert.IsTrue(video.GetProperty("canSubscribe").GetBoolean());
        Assert.IsFalse(video.GetProperty("canPublish").GetBoolean());
    }

    [TestMethod]
    public async Task PostLiveKitToken_NoRoomName_ReturnsBadRequest()
    {
        await _client.PostAsync("/auth/token", null);

        var body = new StringContent("{}", Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/livekit/token", body);
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task PostLiveKitToken_InvalidJson_ReturnsBadRequest()
    {
        await _client.PostAsync("/auth/token", null);

        var body = new StringContent("not json at all", Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/livekit/token", body);
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static string tokenFrom(JsonElement root)
    {
        Assert.IsTrue(root.TryGetProperty("token", out var tokenProp));
        return tokenProp.GetString()!;
    }

    private static string DecodeJwtPayload(string token)
    {
        var payload = token.Split('.')[1].Replace('-', '+').Replace('_', '/');
        switch (payload.Length % 4)
        {
            case 2:
                payload += "==";
                break;
            case 3:
                payload += "=";
                break;
        }

        return Encoding.UTF8.GetString(Convert.FromBase64String(payload));
    }
}
