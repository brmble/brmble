using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ServerIntegrationTests : IDisposable
{
    private readonly BrmbleServerFactory _factory = new();
    private readonly HttpClient _client;

    public ServerIntegrationTests()
    {
        _client = _factory.CreateClient();
    }

    [TestMethod]
    public async Task Health_ReturnsOk()
    {
        var response = await _client.GetAsync("/health");
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task Health_ReturnsHealthyStatus()
    {
        var response = await _client.GetAsync("/health");
        var body = await response.Content.ReadAsStringAsync();
        StringAssert.Contains(body, "healthy");
    }

    [TestMethod]
    public void DiWiring_AppBuildsWithoutException()
    {
        // Creating a scope verifies the DI container resolved without errors at startup
        using var scope = _factory.Services.CreateScope();
        Assert.IsNotNull(scope.ServiceProvider);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }
}
