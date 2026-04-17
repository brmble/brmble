using Brmble.Server.Events;
using Brmble.Server.LiveKit;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class ScreenShareReconciliationTests
{
    [TestMethod]
    public async Task Reconcile_RemovesStaleShares()
    {
        var tracker = new ScreenShareTracker();
        tracker.Start("channel-1", "alice", 10L);
        tracker.Start("channel-1", "bob", 20L);

        var roomQuery = new Mock<ILiveKitRoomQuery>();
        roomQuery.Setup(s => s.ListParticipantIdentities("channel-1"))
            .ReturnsAsync(new List<string> { "@bob:matrix.org" });

        var userIdMapper = new Mock<IUserIdMapper>();
        userIdMapper.Setup(m => m.GetMatrixUserId(10L)).Returns("@alice:matrix.org");
        userIdMapper.Setup(m => m.GetMatrixUserId(20L)).Returns("@bob:matrix.org");

        var eventBus = new Mock<IBrmbleEventBus>();
        var logger = NullLogger<ScreenShareReconciliationService>.Instance;

        var service = new ScreenShareReconciliationService(tracker, roomQuery.Object, userIdMapper.Object, eventBus.Object, logger);

        await service.ReconcileAsync();

        var shares = tracker.GetActiveShares("channel-1");
        Assert.AreEqual(1, shares.Count);
        Assert.AreEqual("bob", shares[0].UserName);

        eventBus.Verify(e => e.BroadcastAsync(It.IsAny<object>()), Times.Once);
    }

    [TestMethod]
    public async Task Reconcile_NoStaleShares_NoChanges()
    {
        var tracker = new ScreenShareTracker();
        tracker.Start("channel-1", "alice", 10L);

        var roomQuery = new Mock<ILiveKitRoomQuery>();
        roomQuery.Setup(s => s.ListParticipantIdentities("channel-1"))
            .ReturnsAsync(new List<string> { "@alice:matrix.org" });

        var userIdMapper = new Mock<IUserIdMapper>();
        userIdMapper.Setup(m => m.GetMatrixUserId(10L)).Returns("@alice:matrix.org");

        var eventBus = new Mock<IBrmbleEventBus>();
        var logger = NullLogger<ScreenShareReconciliationService>.Instance;

        var service = new ScreenShareReconciliationService(tracker, roomQuery.Object, userIdMapper.Object, eventBus.Object, logger);

        await service.ReconcileAsync();

        Assert.AreEqual(1, tracker.GetActiveShares("channel-1").Count);
        eventBus.Verify(e => e.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }
}
