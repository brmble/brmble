using Brmble.Server.Events;
using Brmble.Server.Mumble;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclEventDispatcherTests
{
    [TestMethod]
    public async Task DispatchAclChangedAsync_SendsOnlyAuthorizedConnectedUsers()
    {
        var auth = new Mock<IAclAuthorizationService>();
        var bus = new Mock<IBrmbleEventBus>();
        var connected = new HashSet<long> { 10, 11, 12 };
        bus.Setup(b => b.GetConnectedUserIdsAsync()).ReturnsAsync(connected);
        auth.Setup(a => a.CanManageChannelAclAsync(10, 5)).ReturnsAsync(true);
        auth.Setup(a => a.CanManageChannelAclAsync(11, 5)).ReturnsAsync(false);
        auth.Setup(a => a.CanManageChannelAclAsync(12, 5)).ReturnsAsync(true);
        var dispatcher = new AclEventDispatcher(auth.Object, bus.Object);
        var snapshot = new AclChannelSnapshotDto(5, true, [], [], DateTimeOffset.UtcNow, false, null);

        await dispatcher.DispatchAclChangedAsync(5, snapshot);

        bus.Verify(b => b.BroadcastToUsersAsync(
            It.Is<IReadOnlySet<long>>(s => s.SetEquals(new HashSet<long> { 10, 12 })),
            It.IsAny<object>()), Times.Once);
    }
}
