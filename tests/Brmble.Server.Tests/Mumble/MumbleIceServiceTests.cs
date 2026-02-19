using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleIceServiceTests
{
    private static MumbleIceService CreateService(string host = "localhost", int port = 9999)
    {
        var callback = new MumbleServerCallback(Enumerable.Empty<IMumbleEventHandler>());

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ice:Host"] = host,
                ["Ice:Port"] = port.ToString(),
                ["Ice:Secret"] = "test-secret",
                ["Ice:ConnectTimeoutMs"] = "200"
            })
            .Build();

        var db = new Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        var appService = new Mock<IMatrixAppService>().Object;
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var matrixService = new MatrixService(channelRepo, appService, sessions);

        return new MumbleIceService(
            callback,
            matrixService,
            config,
            NullLogger<MumbleIceService>.Instance);
    }

    [TestMethod]
    public async Task StartAsync_IceUnavailable_CompletesWithoutThrowing()
    {
        // Port 9999 on localhost — nothing listening, Ice connection will fail.
        // Per spec: if Ice fails at startup, log warning and continue.
        var svc = CreateService();
        await svc.StartAsync(CancellationToken.None);
    }

    [TestMethod]
    public async Task StopAsync_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StopAsync(CancellationToken.None);
    }

    [TestMethod]
    public async Task StartThenStop_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StartAsync(CancellationToken.None);
        await svc.StopAsync(CancellationToken.None);
    }
}
