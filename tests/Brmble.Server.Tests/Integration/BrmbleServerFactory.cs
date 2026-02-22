using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;

namespace Brmble.Server.Tests.Integration;

internal class BrmbleServerFactory : WebApplicationFactory<Program>, IDisposable
{
    private readonly SqliteConnection _keepAlive;
    private readonly string _cs;

    public BrmbleServerFactory()
    {
        var dbName = "brmble_server_" + Guid.NewGuid().ToString("N");
        _cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(_cs);
        _keepAlive.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        // ConfigureAppConfiguration works for IOptions<T> (lazy) but not for services
        // registered eagerly in Program.cs. Use it for Matrix/YARP settings.
        builder.ConfigureAppConfiguration(config =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
                ["Matrix:HomeserverUrl"] = "http://localhost:8008",
                ["Matrix:AppServiceToken"] = "test-token",
            });
        });
        builder.ConfigureServices(services =>
        {
            // Replace the lazily-registered Database factory with a concrete in-memory instance.
            // The factory in AddDatabase captures the connection string at registration time
            // (from appsettings.json), so we must replace it here after Program.cs runs.
            var descriptor = services.FirstOrDefault(d => d.ServiceType == typeof(Database));
            if (descriptor != null) services.Remove(descriptor);
            var db = new Database(_cs);
            db.Initialize();
            services.AddSingleton(db);

            // Stub IMatrixAppService so no real HTTP calls are made
            var existing = services.FirstOrDefault(d => d.ServiceType == typeof(IMatrixAppService));
            if (existing != null) services.Remove(existing);
            var mock = new Mock<IMatrixAppService>();
            mock.Setup(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()))
                .ReturnsAsync("stub_matrix_token");
            mock.Setup(m => m.LoginUser(It.IsAny<string>()))
                .ReturnsAsync("stub_matrix_token");
            services.AddSingleton<IMatrixAppService>(mock.Object);
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            _keepAlive.Dispose();
        base.Dispose(disposing);
    }
}
