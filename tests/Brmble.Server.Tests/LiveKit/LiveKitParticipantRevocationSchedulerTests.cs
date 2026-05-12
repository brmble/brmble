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

    [TestMethod]
    public async Task RevokeParticipants_DoesNotScheduleDelayedRetry_WhenImmediateRemovalSucceeds()
    {
        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.Setup(r => r.RemoveParticipant("channel-5", "@alice:test")).ReturnsAsync(true);
        var delayCalls = 0;
        var scheduler = new LiveKitParticipantRevocationScheduler(
            remover.Object,
            NullLogger<LiveKitParticipantRevocationScheduler>.Instance,
            [TimeSpan.FromSeconds(2)],
            _ =>
            {
                delayCalls++;
                return Task.CompletedTask;
            });

        await scheduler.RevokeParticipants([
            new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5))
        ]);

        Assert.AreEqual(0, delayCalls);
        remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Once);
    }

    [TestMethod]
    public async Task RevokeParticipants_SchedulesDelayedRetry_WhenImmediateRemovalFails()
    {
        var remover = new Mock<ILiveKitParticipantRemover>();
        remover.SetupSequence(r => r.RemoveParticipant("channel-5", "@alice:test"))
            .ReturnsAsync(false)
            .ReturnsAsync(true);
        var retryStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var scheduler = new LiveKitParticipantRevocationScheduler(
            remover.Object,
            NullLogger<LiveKitParticipantRevocationScheduler>.Instance,
            [TimeSpan.FromSeconds(2)],
            _ =>
            {
                retryStarted.SetResult();
                return Task.CompletedTask;
            });

        await scheduler.RevokeParticipants([
            new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5))
        ]);
        await retryStarted.Task.WaitAsync(TimeSpan.FromSeconds(1));

        remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Exactly(2));
    }
}
