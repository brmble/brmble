using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclSyncCoordinatorTests
{
    [TestMethod]
    public async Task RefreshAsync_FetchesPersistsAndReturnsCanonicalSnapshot()
    {
        var service = new Mock<IMumbleAclService>();
        var repo = new Mock<IAclSnapshotRepository>();
        var dispatcher = new Mock<IAclEventDispatcher>();
        var snapshot = new AclChannelSnapshotDto(2, true, [], [], DateTimeOffset.UtcNow, false, null);
        service.Setup(s => s.GetChannelAclAsync(2)).ReturnsAsync(snapshot);
        repo.Setup(r => r.UpsertAsync(snapshot)).Returns(Task.CompletedTask);
        var coordinator = new AclSyncCoordinator(service.Object, repo.Object, dispatcher.Object, NullLogger<AclSyncCoordinator>.Instance);

        var result = await coordinator.RefreshAsync(2, broadcastWhenChanged: true);

        Assert.AreEqual(snapshot.ChannelId, result.ChannelId);
        repo.Verify(r => r.UpsertAsync(It.Is<AclChannelSnapshotDto>(s => s.ChannelId == 2)), Times.Once);
        dispatcher.Verify(d => d.DispatchAclChangedAsync(2, It.IsAny<AclChannelSnapshotDto>()), Times.Once);
    }

    [TestMethod]
    public async Task WriteAndRefreshAsync_WhenRefreshFailsMarksSnapshotStale()
    {
        var service = new Mock<IMumbleAclService>();
        var repo = new Mock<IAclSnapshotRepository>();
        var dispatcher = new Mock<IAclEventDispatcher>();
        var current = new AclChannelSnapshotDto(8, true, [], [], DateTimeOffset.UtcNow, false, null);
        var currentHash = AclSnapshotHasher.Compute(current);
        var request = new AclUpdateRequest(true, [], [], currentHash);
        service.Setup(s => s.SetChannelAclAsync(8, request)).Returns(Task.CompletedTask);
        service.SetupSequence(s => s.GetChannelAclAsync(8))
            .ReturnsAsync(current)
            .ThrowsAsync(new MumbleAclException("refresh failed"));
        repo.Setup(r => r.MarkStaleAsync(8, It.IsAny<string>())).Returns(Task.CompletedTask);
        var coordinator = new AclSyncCoordinator(service.Object, repo.Object, dispatcher.Object, NullLogger<AclSyncCoordinator>.Instance);

        var result = await coordinator.WriteAndRefreshAsync(8, request);

        Assert.IsFalse(result.Success);
        Assert.IsNotNull(result.Warning);
        repo.Verify(r => r.MarkStaleAsync(8, It.Is<string>(reason => reason.Contains("refresh failed"))), Times.Once);
    }
}
