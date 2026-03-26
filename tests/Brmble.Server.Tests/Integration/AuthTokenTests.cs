using System.Net;
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AuthTokenTests : IDisposable
{
    private readonly BrmbleServerFactory _factory = new();
    private readonly HttpClient _client;

    public AuthTokenTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task PostAuthToken_NoClientCert_ReturnsUnauthorized()
    {
        // Factory configured with certHash: null simulates no client certificate
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var response = await client.PostAsync("/auth/token", null);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAuthToken_WithClientCert_ReturnsCredentialsShape()
    {
        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("matrix"));
        Assert.IsTrue(json.Contains("homeserverUrl"));
        Assert.IsTrue(json.Contains("accessToken"));
        Assert.IsTrue(json.Contains("userId"));
        Assert.IsTrue(json.Contains("roomMap"));
    }

    [TestMethod]
    public async Task PostAuthToken_WithClientCert_IncludesUserMappings()
    {
        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("userMappings"), "Response should contain userMappings field");
    }

    [TestMethod]
    public async Task PostAuthToken_IncludesSessionMappingsInResponse()
    {
        var response = await _client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("sessionMappings"), "Response should contain sessionMappings field");
    }

    [TestMethod]
    public async Task PostAuthToken_SessionMappings_IncludeIsBrmbleClient()
    {
        // Seed a session mapping with isBrmbleClient = true before authenticating
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        sessionMapping.SetNameForSession("OtherUser", 42);
        sessionMapping.TryAddMatrixUser(42, "@other:localhost", "OtherUser", 999);
        sessionMapping.TryUpdateBrmbleStatus(42, true);

        var response = await client.PostAsync("/auth/token", null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.IsTrue(root.TryGetProperty("sessionMappings", out var mappings),
            "Response should contain sessionMappings");

        // Find the seeded session mapping and verify isBrmbleClient round-trips as true
        Assert.IsTrue(mappings.TryGetProperty("42", out var entry),
            "sessionMappings should contain session 42");
        Assert.IsTrue(entry.TryGetProperty("isBrmbleClient", out var isBrmble),
            "Session mapping entry should contain isBrmbleClient");
        Assert.IsTrue(isBrmble.GetBoolean(),
            "isBrmbleClient should be true for the seeded Brmble client");
    }

    [TestMethod]
    public async Task PostAuthToken_SelfSession_IsBrmbleClient_True()
    {
        // Verify that the authenticating user's own session gets isBrmbleClient = true
        // even when the mapping was created with IsBrmbleClient = false (race condition fix)
        using var factory = new BrmbleServerFactory();
        using var client = factory.CreateClient();

        // Pre-seed the name→session mapping so the endpoint can find the session
        var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
        sessionMapping.SetNameForSession("TestUser", 1);

        // Authenticate with a mumbleUsername so the endpoint can resolve the session
        var body = new StringContent(
            JsonSerializer.Serialize(new { mumbleUsername = "TestUser" }),
            Encoding.UTF8, "application/json");
        var response = await client.PostAsync("/auth/token", body);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.IsTrue(root.TryGetProperty("sessionMappings", out var mappings),
            "Response should contain sessionMappings");
        Assert.IsTrue(mappings.TryGetProperty("1", out var entry),
            "sessionMappings should contain session 1 (self)");
        Assert.IsTrue(entry.TryGetProperty("isBrmbleClient", out var isBrmble),
            "Session mapping entry should contain isBrmbleClient");
        Assert.IsTrue(isBrmble.GetBoolean(),
            "Self session should have isBrmbleClient = true after auth");
    }
}
