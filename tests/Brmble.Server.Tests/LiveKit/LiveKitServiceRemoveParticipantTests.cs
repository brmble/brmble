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
public class LiveKitServiceRemoveParticipantTests
{
    [TestMethod]
    public async Task RemoveParticipant_ReturnsFalseAndDoesNotThrow_WhenRoomClientThrows()
    {
        var roomClient = new Mock<ILiveKitRoomClient>();
        roomClient.Setup(c => c.RemoveParticipant("nonexistent-room", "nonexistent-user"))
            .ThrowsAsync(new InvalidOperationException("LiveKit unavailable in test"));
        var service = CreateService(roomClient.Object);

        var removed = await service.RemoveParticipant("nonexistent-room", "nonexistent-user");

        Assert.IsFalse(removed);
    }

    [TestMethod]
    public async Task RemoveParticipant_ReturnsTrue_WhenRoomClientSucceeds()
    {
        var roomClient = new Mock<ILiveKitRoomClient>();
        roomClient.Setup(c => c.RemoveParticipant("channel-1", "@alice:test"))
            .Returns(Task.CompletedTask);
        var service = CreateService(roomClient.Object);

        var removed = await service.RemoveParticipant("channel-1", "@alice:test");

        Assert.IsTrue(removed);
        roomClient.Verify(c => c.RemoveParticipant("channel-1", "@alice:test"), Times.Once);
    }

    private static LiveKitService CreateService(ILiveKitRoomClient roomClient)
    {
        var settings = Options.Create(new LiveKitSettings
        {
            ApiKey = "test",
            ApiSecret = "secret-must-be-long-enough-for-hmac",
            ServerUrl = "http://localhost:7880"
        });
        var matrixSettings = Options.Create(new MatrixSettings { ServerDomain = "test.local" });
        var userRepo = new Mock<UserRepository>(
            new Mock<Database>("Data Source=:memory:").Object,
            matrixSettings);

        return new LiveKitService(
            settings,
            userRepo.Object,
            roomClient,
            NullLogger<LiveKitService>.Instance);
    }
}
