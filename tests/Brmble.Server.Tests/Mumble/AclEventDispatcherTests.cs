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

    [TestMethod]
    public async Task DispatchAclChangedAsync_BroadcastsMetadataWithoutSnapshotOrPassword()
    {
        var auth = new Mock<IAclAuthorizationService>();
        var bus = new Mock<IBrmbleEventBus>();
        auth.Setup(a => a.CanManageChannelAclAsync(12, 7)).ReturnsAsync(true);
        bus.Setup(b => b.GetConnectedUserIdsAsync()).ReturnsAsync(new HashSet<long> { 12L });
        object? payload = null;
        bus.Setup(b => b.BroadcastToUsersAsync(It.IsAny<IReadOnlySet<long>>(), It.IsAny<object>(), It.IsAny<EventDeliveryOptions>()))
            .Callback<IReadOnlySet<long>, object, EventDeliveryOptions>((_, value, _) => payload = value)
            .Returns(Task.CompletedTask);
        var dispatcher = new AclEventDispatcher(auth.Object, bus.Object);
        const string password = "class-a-voice";
        var snapshot = new AclChannelSnapshotDto(
            7, true, [],
            [
                new(true, false, false, null, "all", 0, 3854),
                new(true, false, false, null, $"#{password}", 2830, 0),
                new(true, false, false, null, $"__brmble_password_marker__:{('#' + password)}", 0, 0),
            ],
            DateTimeOffset.UtcNow, false, null, "hash-7");

        await dispatcher.DispatchAclChangedAsync(7, snapshot);

        var json = System.Text.Json.JsonSerializer.Serialize(payload);
        StringAssert.Contains(json, "snapshotHash");
        StringAssert.Contains(json, "\"hasManagedPassword\":true");
        Assert.IsFalse(json.Contains("\"snapshot\":", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(json.Contains(password, StringComparison.Ordinal));
    }

    [TestMethod]
    public async Task DispatchAclChangedAsync_BroadcastsPasswordStateToEveryConnectedUser()
    {
        var auth = new Mock<IAclAuthorizationService>();
        var bus = new Mock<IBrmbleEventBus>();
        var connected = new HashSet<long> { 10, 11, 12 };
        bus.Setup(b => b.GetConnectedUserIdsAsync()).ReturnsAsync(connected);
        auth.Setup(a => a.CanManageChannelAclAsync(10, 5)).ReturnsAsync(true);
        auth.Setup(a => a.CanManageChannelAclAsync(11, 5)).ReturnsAsync(false);
        auth.Setup(a => a.CanManageChannelAclAsync(12, 5)).ReturnsAsync(true);
        var messages = new List<(IReadOnlySet<long> UserIds, object Message)>();
        bus.Setup(b => b.BroadcastToUsersAsync(It.IsAny<IReadOnlySet<long>>(), It.IsAny<object>(), It.IsAny<EventDeliveryOptions>()))
            .Callback<IReadOnlySet<long>, object, EventDeliveryOptions>((userIds, message, _) => messages.Add((userIds, message)))
            .Returns(Task.CompletedTask);
        var dispatcher = new AclEventDispatcher(auth.Object, bus.Object);
        var snapshot = new AclChannelSnapshotDto(
            5, true, [],
            [new(true, false, false, null, "__brmble_password_marker__:#secret", 0, 0)],
            DateTimeOffset.UtcNow, false, null);

        await dispatcher.DispatchAclChangedAsync(5, snapshot);

        Assert.AreEqual(2, messages.Count);
        var publicJson = System.Text.Json.JsonSerializer.Serialize(messages.Single(m => m.Message.ToString()!.Contains("passwordStateChanged", StringComparison.Ordinal)).Message);
        StringAssert.Contains(publicJson, "passwordStateChanged");
        StringAssert.Contains(publicJson, "\"channelId\":5");
        StringAssert.Contains(publicJson, "\"hasManagedPassword\":true");
        Assert.IsTrue(messages.Single(m => m.Message.ToString()!.Contains("passwordStateChanged", StringComparison.Ordinal)).UserIds.SetEquals(connected));
        Assert.IsFalse(publicJson.Contains("secret", StringComparison.Ordinal));
    }
}
