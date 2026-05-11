using Brmble.Server.LiveKit;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitParticipantRevocationSchedulerTests
{
    [TestMethod]
    public async Task RevokeParticipants_RetriesParticipantRemoval_WhenImmediateRemovalFails()
    {
        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.SetupSequence(r => r.RemoveParticipant("channel-5", "@alice:test"))
            .ReturnsAsync(false)
            .ReturnsAsync(true);
        var scheduler = new LiveKitParticipantRevocationScheduler(
            remover.Object,
            NullLogger<LiveKitParticipantRevocationScheduler>.Instance,
            [TimeSpan.Zero]);

        await scheduler.RevokeParticipants([
            new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5))
        ]);

        remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Exactly(2));
    }

    [TestMethod]
    public async Task RevokeParticipants_DoesNotThrow_WhenParticipantRemovalReturnsFalse()
    {
        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.Setup(r => r.RemoveParticipant("channel-5", "@alice:test")).ReturnsAsync(false);
        var scheduler = new LiveKitParticipantRevocationScheduler(
            remover.Object,
            NullLogger<LiveKitParticipantRevocationScheduler>.Instance,
            []);

        await scheduler.RevokeParticipants([
            new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5))
        ]);
    }
}
