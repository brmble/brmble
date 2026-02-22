// tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
using System.Net;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Tests.Auth;
using Microsoft.AspNetCore.Hosting;
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
    public async Task PostToken_ValidRequest_ReturnsMatrixToken()
    {
        var response = await _client.PostAsync("/auth/token", null);
        var body = await response.Content.ReadAsStringAsync();
        StringAssert.Contains(body, "matrixAccessToken");
        StringAssert.Contains(body, "stub_matrix_token");
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
                var dbDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(Database));
                if (dbDescriptor != null) services.Remove(dbDescriptor);
                var db2 = new Database($"Data Source={dbName2};Mode=Memory;Cache=Shared");
                db2.Initialize();
                services.AddSingleton(db2);

                var matrixDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(IMatrixAppService));
                if (matrixDescriptor != null) services.Remove(matrixDescriptor);
                services.AddSingleton<IMatrixAppService>(new Mock<IMatrixAppService>().Object);

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
