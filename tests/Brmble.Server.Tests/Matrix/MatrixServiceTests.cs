using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Moq;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixServiceTests
{
    // TODO: Add tests as RelayMessage is implemented:
    // - RelayMessage_BrmbleClient_SkipsRelay
    // - RelayMessage_UnmappedChannel_SkipsRelay
    // - RelayMessage_MappedChannel_PostsAsBot

    [TestMethod]
    public void Constructor_WithValidDependencies_DoesNotThrow()
    {
        var db = new Database("Data Source=:memory:");
        var channelRepo = new ChannelRepository(db);
        var httpClientFactory = new Mock<IHttpClientFactory>().Object;
        var appService = new MatrixAppService(httpClientFactory);
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var svc = new MatrixService(channelRepo, appService, sessions);
        Assert.IsNotNull(svc);
    }
}
