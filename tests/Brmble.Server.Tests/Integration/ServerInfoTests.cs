using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ServerInfoTests : IDisposable
{
    private readonly BrmbleServerFactory _factory = new();
    private readonly HttpClient _client;

    public ServerInfoTests()
    {
        _client = _factory.CreateClient();
    }

    [TestCleanup]
    public void Cleanup() => Dispose();

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task GetServerInfo_ReturnsExpectedShape()
    {
        var response = await _client.GetAsync("/server-info");
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("mumbleHost"));
        Assert.IsTrue(json.Contains("mumblePort"));
        Assert.IsTrue(json.Contains("matrixHomeserverUrl"));
    }
}
