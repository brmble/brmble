using System.Net;
using System.Text;
using System.Text.Json;
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
}
