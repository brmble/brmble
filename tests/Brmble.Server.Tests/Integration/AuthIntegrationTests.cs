// tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
using System.Net;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AuthIntegrationTests : IDisposable
{
    private readonly SqliteConnection _keepAlive;
    private readonly string _cs;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public AuthIntegrationTests()
    {
        var dbName = "auth_int_" + Guid.NewGuid().ToString("N");
        _cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";

        _keepAlive = new SqliteConnection(_cs);
        _keepAlive.Open();

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration(config =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Auth:ServerDomain"] = "test.local",
                    ["Matrix:ServerDomain"] = "test.local",
                    ["Matrix:HomeserverUrl"] = "http://localhost:1",
                    ["Matrix:AppServiceToken"] = "test-token",
                    ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                    ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                    ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
                });
            });
            builder.ConfigureServices(services =>
            {
                // Replace eagerly-initialized Database with in-memory stub
                var dbDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(Database));
                if (dbDescriptor != null) services.Remove(dbDescriptor);
                var db = new Database(_cs);
                db.Initialize();
                services.AddSingleton(db);

                // Stub IMatrixAppService so no real HTTP calls are made
                var matrixDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(IMatrixAppService));
                if (matrixDescriptor != null) services.Remove(matrixDescriptor);
                var mockMatrix = new Mock<IMatrixAppService>();
                mockMatrix.Setup(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()))
                          .ReturnsAsync("stub_matrix_token");
                mockMatrix.Setup(m => m.LoginUser(It.IsAny<string>()))
                          .ReturnsAsync("stub_matrix_token");
                services.AddSingleton<IMatrixAppService>(mockMatrix.Object);

                // Stub ICertificateHashExtractor — WebApplicationFactory bypasses TLS
                var extDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(ICertificateHashExtractor));
                if (extDescriptor != null) services.Remove(extDescriptor);
                var mockExt = new Mock<ICertificateHashExtractor>();
                mockExt.Setup(e => e.GetCertHash(It.IsAny<HttpContext>()))
                       .Returns("aabbccddeeff001122334455");
                services.AddSingleton<ICertificateHashExtractor>(mockExt.Object);
            });
        });

        _client = _factory.CreateClient();
    }

    [TestMethod]
    public async Task PostToken_WithClientCert_ReturnsOk()
    {
        var response = await _client.PostAsync("/auth/token", null);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task PostToken_WithClientCert_ReturnsCredentialsShape()
    {
        var response = await _client.PostAsync("/auth/token", null);
        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("matrix"));
        Assert.IsTrue(json.Contains("accessToken"));
        Assert.IsTrue(json.Contains("stub_matrix_token"));
    }

    [TestMethod]
    public async Task PostToken_NoClientCert_ReturnsUnauthorized()
    {
        // Re-register extractor to return null (simulates missing client certificate)
        var factory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                var desc = services.FirstOrDefault(d => d.ServiceType == typeof(ICertificateHashExtractor));
                if (desc != null) services.Remove(desc);
                var mockExt = new Mock<ICertificateHashExtractor>();
                mockExt.Setup(e => e.GetCertHash(It.IsAny<HttpContext>())).Returns((string?)null);
                services.AddSingleton<ICertificateHashExtractor>(mockExt.Object);
            });
        });
        using var client = factory.CreateClient();
        var response = await client.PostAsync("/auth/token", null);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        _keepAlive.Dispose();
    }
}
