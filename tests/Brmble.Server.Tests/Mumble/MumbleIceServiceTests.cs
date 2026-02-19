using Brmble.Server.Mumble;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleIceServiceTests
{
    private static MumbleIceService CreateService()
    {
        var callback = new MumbleServerCallback(Enumerable.Empty<IMumbleEventHandler>());
        return new MumbleIceService(callback);
    }

    [TestMethod]
    public async Task StartAsync_CompletesWithoutThrowing()
    {
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

    // TODO: Add tests as Ice integration is implemented:
    // - StartAsync_ConnectsToMumbleServer
    // - StopAsync_DisconnectsGracefully
}
