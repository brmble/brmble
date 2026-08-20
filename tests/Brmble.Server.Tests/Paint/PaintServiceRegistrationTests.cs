using Brmble.Server.Paint;
using Brmble.Server.Tests.Integration;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintServiceRegistrationTests
{
    private readonly List<string> _pathsToDelete = [];

    [TestCleanup]
    public void Cleanup()
    {
        foreach (var path in _pathsToDelete)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, recursive: true);
                }
            }
            catch
            {
                // Best-effort temp cleanup for tests.
            }
        }
    }

    [TestMethod]
    public void Program_BindsPaintStorageOptionsAndRegistersFileTemporarySourceStore()
    {
        var root = TrackDirectory(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        using WebApplicationFactory<Program> factory = new BrmbleServerFactory().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["PaintStorage:RootPath"] = root,
                });
            });
        });

        var options = factory.Services.GetRequiredService<IOptions<PaintStorageOptions>>().Value;
        var store = factory.Services.GetRequiredService<IPaintTemporarySourceStore>();
        var manager = factory.Services.GetRequiredService<PaintSessionManager>();
        var lifetime = factory.Services.GetRequiredService<IPaintTemporaryDataLifetime>();
        var participation = factory.Services.GetRequiredService<IPaintParticipationLifecycle>();
        var hostedServices = factory.Services.GetServices<IHostedService>().ToArray();

        Assert.AreEqual(root, options.RootPath);
        Assert.IsInstanceOfType<FilePaintTemporarySourceStore>(store);
        Assert.AreSame(manager, lifetime);
        Assert.AreSame(manager, participation);
        CollectionAssert.AreEquivalent(
            new[] { typeof(PaintSessionExpirationService), typeof(PaintTemporaryCleanupService) },
            hostedServices
                .Where(service => service is PaintSessionExpirationService or PaintTemporaryCleanupService)
                .Select(service => service.GetType())
                .ToArray());
    }

    private string TrackDirectory(string path)
    {
        _pathsToDelete.Add(path);
        return path;
    }
}
