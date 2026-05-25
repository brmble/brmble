using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.LiveKit;
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
    private static MumbleIceService CreateService(
        string host = "localhost",
        int port = 9999,
        IMumbleIceCommunicatorFactory? communicatorFactory = null)
    {
        var participantRemover = new Mock<ILiveKitParticipantRemover>().Object;
        var revocationScheduler = new LiveKitParticipantRevocationScheduler(
            participantRemover,
            NullLogger<LiveKitParticipantRevocationScheduler>.Instance,
            []);

        var callback = new MumbleServerCallback(
            Enumerable.Empty<IMumbleEventHandler>(),
            new Mock<ISessionMappingService>().Object,
            new Mock<IBrmbleEventBus>().Object,
            new Mock<IChannelMembershipService>().Object,
            new ScreenShareTracker(),
            revocationScheduler,
            new LiveKitParticipantTracker(),
            NullLogger<MumbleServerCallback>.Instance);

        var iceSettings = Options.Create(new IceSettings { Host = host, Port = port, Secret = "test-secret" });

        var db = new Database("Data Source=:memory:");
        db.Initialize();
        var channelRepo = new ChannelRepository(db);
        var appService = new Mock<IMatrixAppService>().Object;
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var matrixService = new MatrixService(channelRepo, appService, sessions, NullLogger<MatrixService>.Instance);

        var registrationService = new MumbleRegistrationService(NullLogger<MumbleRegistrationService>.Instance);
        var aclIceClient = new MumbleAclIceClient();

        communicatorFactory ??= CreateFailingCommunicatorFactory();

        return new MumbleIceService(
            callback,
            registrationService,
            aclIceClient,
            matrixService,
            iceSettings,
            communicatorFactory,
            NullLogger<MumbleIceService>.Instance);
    }

    private static IMumbleIceCommunicatorFactory CreateFailingCommunicatorFactory()
    {
        var communicatorFactory = new Mock<IMumbleIceCommunicatorFactory>();
        communicatorFactory.Setup(f => f.Create())
            .Throws(new InvalidOperationException("Ice unavailable in test"));
        return communicatorFactory.Object;
    }

    [TestMethod]
    public async Task StartAsync_IceStartupThrows_CompletesWithoutThrowing()
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
}
