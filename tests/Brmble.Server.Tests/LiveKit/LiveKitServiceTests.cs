using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceTests
{
    private LiveKitService _svc = null!;
    private Mock<UserRepository> _mockUserRepo = null!;

    [TestInitialize]
    public void Setup()
    {
        var settings = Options.Create(new LiveKitSettings
        {
            ApiKey = "test-api-key",
            ApiSecret = "testsecret0123456789abcdef01234567890abcdef01234567890abcdef0123"
        });
        var matrixSettings = Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost:8008",
            AppServiceToken = "test-token"
        });
        _mockUserRepo = new Mock<UserRepository>(
            new Mock<Database>("Data Source=:memory:").Object,
            matrixSettings);
        _svc = new LiveKitService(settings, _mockUserRepo.Object,
            NullLogger<LiveKitService>.Instance);
    }

    [TestMethod]
    public async Task GenerateToken_KnownUser_ReturnsNonEmptyJwt()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
            .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

        var token = await _svc.GenerateToken("cert123", "room-1");

        Assert.IsNotNull(token);
        Assert.IsTrue(token.Length > 0);
        // JWT has 3 dot-separated parts
        Assert.AreEqual(3, token.Split('.').Length);
    }

    [TestMethod]
    public async Task GenerateToken_UnknownUser_ReturnsNull()
    {
        _mockUserRepo.Setup(r => r.GetByCertHash("unknown"))
            .ReturnsAsync((User?)null);

        var token = await _svc.GenerateToken("unknown", "room-1");

        Assert.IsNull(token);
    }
}
