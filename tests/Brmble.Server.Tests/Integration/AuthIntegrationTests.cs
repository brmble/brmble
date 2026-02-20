// tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Tests.Auth;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AuthIntegrationTests : IDisposable
{
    private readonly SqliteConnection _keepAlive;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public AuthIntegrationTests()
    {
        var dbName = "auth_int_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";

        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration(config =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = cs,
                    ["Matrix:ServerDomain"] = "test.local",
                    ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                    ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                    ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
                });
            });
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<ICertificateHashExtractor>(
                    new FakeCertificateHashExtractor("aabbccddeeff001122334455"));
            });
        });

        _client = _factory.CreateClient();
    }

    [TestMethod]
    public async Task PostToken_ValidRequest_ReturnsOk()
    {
        var response = await _client.PostAsync("/auth/token", null);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task PostToken_ValidRequest_ReturnsStubToken()
    {
        var response = await _client.PostAsync("/auth/token", null);
        var body = await response.Content.ReadAsStringAsync();
        StringAssert.Contains(body, "matrixAccessToken");
        StringAssert.Contains(body, "stub_token_");
    }

    [TestMethod]
    public async Task PostToken_NoCertificate_ReturnsBadRequest()
    {
        var dbName2 = "auth_nocert_" + Guid.NewGuid().ToString("N");
        using var keepAlive2 = new SqliteConnection($"Data Source={dbName2};Mode=Memory;Cache=Shared");
        keepAlive2.Open();

        using var noCertFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration(config =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = $"Data Source={dbName2};Mode=Memory;Cache=Shared",
                    ["Matrix:ServerDomain"] = "test.local",
                    ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                    ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                    ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
                });
            });
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<ICertificateHashExtractor>(
                    new FakeCertificateHashExtractor(null));
            });
        });

        using var noCertClient = noCertFactory.CreateClient();
        var response = await noCertClient.PostAsync("/auth/token", null);
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        _keepAlive.Dispose();
    }
}
