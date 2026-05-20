using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleAclServiceTests
{
    [TestMethod]
    public async Task GetChannelAclAsync_ReturnsMappedCanonicalSnapshot()
    {
        var ice = new Mock<IMumbleAclIceClient>();
        ice.Setup(i => i.GetAclAsync(9))
            .ReturnsAsync(new MumbleServer.Server_GetACLResult(
                [new MumbleServer.ACL(true, true, false, -1, "all", MumbleServer.PermissionEnter.value, 0)],
                [],
                inherit: true));
        var service = new MumbleAclService(ice.Object, NullLogger<MumbleAclService>.Instance);

        var snapshot = await service.GetChannelAclAsync(9);

        Assert.AreEqual(9, snapshot.ChannelId);
        Assert.AreEqual("all", snapshot.Acls[0].Group);
        Assert.IsFalse(snapshot.Stale);
        Assert.IsNull(snapshot.Warning);
    }

    [TestMethod]
    public async Task SetChannelAclAsync_WritesOnlyLocalRules()
    {
        var ice = new Mock<IMumbleAclIceClient>();
        var service = new MumbleAclService(ice.Object, NullLogger<MumbleAclService>.Instance);
        var request = new AclUpdateRequest(
            InheritAcls: true,
            Groups: [],
            Acls:
            [
                new AclRuleDto(true, true, false, null, "#secret", MumbleServer.PermissionEnter.value, 0),
                new AclRuleDto(true, true, true, null, "inherited", MumbleServer.PermissionWrite.value, 0)
            ]);

        await service.SetChannelAclAsync(4, request);

        ice.Verify(i => i.SetAclAsync(
            4,
            It.Is<MumbleServer.ACL[]>(rules => rules.Length == 1 && rules[0].group == "#secret"),
            It.Is<MumbleServer.Group[]>(groups => groups.Length == 0),
            true), Times.Once);
    }

    [TestMethod]
    public async Task HasWritePermissionAsync_DelegatesToMumblePermissionWrite()
    {
        var ice = new Mock<IMumbleAclIceClient>();
        ice.Setup(i => i.HasPermissionAsync(12, 5, MumbleServer.PermissionWrite.value)).ReturnsAsync(true);
        var service = new MumbleAclService(ice.Object, NullLogger<MumbleAclService>.Instance);

        Assert.IsTrue(await service.HasWritePermissionAsync(sessionId: 12, channelId: 5));
    }
}
