using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceRemoveParticipantTests
{
    [TestMethod]
    public async Task RemoveParticipant_DoesNotThrow_WhenRoomDoesNotExist()
    {
        var settings = Options.Create(new LiveKitSettings { ApiKey = "test", ApiSecret = "secret-must-be-long-enough-for-hmac", ServerUrl = "http://localhost:7880" });
        var matrixSettings = Options.Create(new MatrixSettings { ServerDomain = "test.local" });
        var userRepo = new Mock<UserRepository>(
            new Mock<Database>("Data Source=:memory:").Object,
            matrixSettings);

        var service = new LiveKitService(settings, userRepo.Object, NullLogger<LiveKitService>.Instance);

        // Should not throw even if LiveKit server isn't running (we catch the exception)
        await service.RemoveParticipant("nonexistent-room", "nonexistent-user");
    }
}
