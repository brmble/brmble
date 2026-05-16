using Brmble.Server.Mumble;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclMapperTests
{
    [TestMethod]
    public void FromIce_PreservesRuleOrderAndSelectors()
    {
        var result = new MumbleServer.Server_GetACLResult(
            [
                new MumbleServer.ACL(true, true, false, -1, "admin", MumbleServer.PermissionWrite.value, 0),
                new MumbleServer.ACL(true, false, false, -1, "#secret", MumbleServer.PermissionEnter.value, 0),
                new MumbleServer.ACL(false, true, true, 42, "", 0, MumbleServer.PermissionSpeak.value)
            ],
            [
                new MumbleServer.Group("admin", false, true, true, [1], [2], [1, 3])
            ],
            inherit: true);
        var fetchedAt = new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero);

        var dto = AclMapper.FromIce(channelId: 7, result, fetchedAt, stale: false, warning: null);

        Assert.AreEqual(7, dto.ChannelId);
        Assert.IsTrue(dto.InheritAcls);
        Assert.AreEqual(3, dto.Acls.Count);
        Assert.AreEqual("admin", dto.Acls[0].Group);
        Assert.AreEqual("#secret", dto.Acls[1].Group);
        Assert.AreEqual(42, dto.Acls[2].UserId);
        Assert.IsTrue(dto.Acls[2].Inherited);
        Assert.AreEqual(1, dto.Groups.Count);
        CollectionAssert.AreEqual(new[] { 1, 3 }, dto.Groups[0].Members.ToArray());
    }

    [TestMethod]
    public void ToIce_IgnoresInheritedRulesAndMembersForWrites()
    {
        var request = new AclUpdateRequest(
            InheritAcls: false,
            Groups:
            [
                new AclGroupDto("writers", false, true, true, [5], [6], [5, 9]),
                new AclGroupDto("inherited", true, true, true, [1], [], [1])
            ],
            Acls:
            [
                new AclRuleDto(true, true, false, null, "writers", MumbleServer.PermissionTextMessage.value, 0),
                new AclRuleDto(true, true, true, null, "readonly", MumbleServer.PermissionEnter.value, 0),
                new AclRuleDto(true, false, false, 42, null, 0, MumbleServer.PermissionSpeak.value)
            ]);

        var (acls, groups, inherit) = AclMapper.ToIce(request);

        Assert.IsFalse(inherit);
        Assert.AreEqual(2, acls.Length);
        Assert.AreEqual("writers", acls[0].group);
        Assert.AreEqual(-1, acls[0].userid);
        Assert.AreEqual(42, acls[1].userid);
        Assert.AreEqual("", acls[1].group);
        Assert.AreEqual(1, groups.Length);
        Assert.AreEqual("writers", groups[0].name);
        CollectionAssert.AreEqual(new[] { 5 }, groups[0].add);
        CollectionAssert.AreEqual(new[] { 6 }, groups[0].remove);
        CollectionAssert.AreEqual(Array.Empty<int>(), groups[0].members);
    }
}
