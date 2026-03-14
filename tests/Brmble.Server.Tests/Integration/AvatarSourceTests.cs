using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AvatarSourceTests : IDisposable
{
    private readonly BrmbleServerFactory _factory = new();
    private readonly HttpClient _client;

    public AvatarSourceTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private async Task EnsureUserExists()
    {
        // POST /auth/token creates the user record keyed by cert hash
        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();
    }

    [TestMethod]
    public async Task PostAvatarSource_NoClientCert_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var content = new StringContent(
            JsonSerializer.Serialize(new { source = "brmble" }),
            Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/auth/avatar-source", content);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAvatarSource_UnknownCertHash_ReturnsUnauthorized()
    {
        // Use a cert hash that has no corresponding user record
        using var factory = new BrmbleServerFactory(certHash: "unknowncerthash999");
        using var client = factory.CreateClient();

        var content = new StringContent(
            JsonSerializer.Serialize(new { source = "brmble" }),
            Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/auth/avatar-source", content);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAvatarSource_SetBrmble_ReturnsOkWithSource()
    {
        await EnsureUserExists();

        var content = new StringContent(
            JsonSerializer.Serialize(new { source = "brmble" }),
            Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/auth/avatar-source", content);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.AreEqual("brmble", doc.RootElement.GetProperty("source").GetString());
    }

    [TestMethod]
    public async Task PostAvatarSource_SetMumble_ReturnsOkWithSource()
    {
        await EnsureUserExists();

        var content = new StringContent(
            JsonSerializer.Serialize(new { source = "mumble" }),
            Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/auth/avatar-source", content);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.AreEqual("mumble", doc.RootElement.GetProperty("source").GetString());
    }

    [TestMethod]
    public async Task PostAvatarSource_ClearWithNull_ReturnsOkWithNullSource()
    {
        await EnsureUserExists();

        // First set it to brmble
        var setContent = new StringContent(
            JsonSerializer.Serialize(new { source = "brmble" }),
            Encoding.UTF8, "application/json");
        await _client.PostAsync("/auth/avatar-source", setContent);

        // Now clear it
        var clearContent = new StringContent(
            JsonSerializer.Serialize(new { source = (string?)null }),
            Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/auth/avatar-source", clearContent);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.AreEqual(JsonValueKind.Null, doc.RootElement.GetProperty("source").ValueKind);
    }

    [TestMethod]
    public async Task PostAvatarSource_InvalidSource_ReturnsBadRequest()
    {
        await EnsureUserExists();

        var content = new StringContent(
            JsonSerializer.Serialize(new { source = "invalid_source" }),
            Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/auth/avatar-source", content);
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAvatarSource_EmptyBody_ClearsSource()
    {
        await EnsureUserExists();

        // Set source first
        var setContent = new StringContent(
            JsonSerializer.Serialize(new { source = "brmble" }),
            Encoding.UTF8, "application/json");
        await _client.PostAsync("/auth/avatar-source", setContent);

        // Post with empty body — should treat as null (clear)
        var response = await _client.PostAsync("/auth/avatar-source", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.AreEqual(JsonValueKind.Null, doc.RootElement.GetProperty("source").ValueKind);
    }
}
