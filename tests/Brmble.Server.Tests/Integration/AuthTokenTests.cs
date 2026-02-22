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
    public async Task PostAuthToken_MissingCertHash_ReturnsBadRequest()
    {
        var response = await _client.PostAsync("/auth/token",
            new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAuthToken_ValidCertHash_ReturnsCredentialsShape()
    {
        var body = JsonSerializer.Serialize(new { certHash = "testcerthash123" });
        var response = await _client.PostAsync("/auth/token",
            new StringContent(body, Encoding.UTF8, "application/json"));
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("matrix"));
        Assert.IsTrue(json.Contains("homeserverUrl"));
        Assert.IsTrue(json.Contains("accessToken"));
        Assert.IsTrue(json.Contains("userId"));
        Assert.IsTrue(json.Contains("roomMap"));
    }
}
