using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Brmble.Server.Tests.Integration;

internal class BrmbleServerFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(config =>
        {
            // Use in-memory SQLite so Database.Initialize() succeeds without a real file.
            // YARP ReverseProxy with no routes is valid — proxy just has nothing configured.
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = "Data Source=:memory:",
                // YARP requires at least one valid route + cluster to start.
                // Route ID is the key name (object format), not a RouteId field.
                ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
            });
        });
    }
}
