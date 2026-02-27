using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleIceServiceTests
{
    private static MumbleIceService CreateService(string host = "localhost", int port = 9999)
    {
        var callback = new MumbleServerCallback(Enumerable.Empty<IMumbleEventHandler>(), NullLogger<MumbleServerCallback>.Instance);

        var iceSettings = Options.Create(new IceSettings { Host = host, Port = port, Secret = "test-secret" });

        var db = new Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        var appService = new Mock<IMatrixAppService>().Object;
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var matrixService = new MatrixService(channelRepo, appService, sessions, NullLogger<MatrixService>.Instance);

        return new MumbleIceService(
            callback,
            matrixService,
            iceSettings,
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
