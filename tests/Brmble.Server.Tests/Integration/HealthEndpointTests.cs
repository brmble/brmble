using System.Net;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class HealthEndpointTests
{
    [TestMethod]
    public async Task Health_ReturnsOk_WithStatusAndVersion()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/health");
        Assert.AreEqual(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);

        Assert.IsTrue(doc.RootElement.TryGetProperty("status", out var status));
        Assert.AreEqual("healthy", status.GetString());

        Assert.IsTrue(doc.RootElement.TryGetProperty("version", out var version),
            "Health response should include a 'version' field.");
        var v = version.GetString();
        Assert.IsFalse(string.IsNullOrWhiteSpace(v),
            "'version' should be a non-empty string.");
    }
}
