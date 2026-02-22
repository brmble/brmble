// tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
using System.Net;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
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
            });
        });

        _client = _factory.CreateClient();
    }

    [TestMethod]
    public async Task PostToken_ValidCertHash_ReturnsOk()
    {
        var body = System.Text.Json.JsonSerializer.Serialize(new { certHash = "aabbccddeeff001122334455" });
        var response = await _client.PostAsync("/auth/token",
            new System.Net.Http.StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task PostToken_ValidCertHash_ReturnsCredentialsShape()
    {
        var body = System.Text.Json.JsonSerializer.Serialize(new { certHash = "aabbccddeeff001122334455" });
        var response = await _client.PostAsync("/auth/token",
            new System.Net.Http.StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("matrix"));
        Assert.IsTrue(json.Contains("accessToken"));
        Assert.IsTrue(json.Contains("stub_matrix_token"));
    }

    [TestMethod]
    public async Task PostToken_MissingCertHash_ReturnsBadRequest()
    {
        var response = await _client.PostAsync("/auth/token",
            new System.Net.Http.StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        _keepAlive.Dispose();
    }
}
