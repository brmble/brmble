using Brmble.Server.Mumble;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclValidationServiceTests
{
    [TestMethod]
    public void ValidateUpdate_RejectsMissingHash()
    {
        var service = new AclValidationService();
        var (valid, error) = service.ValidateUpdate(new AclUpdateRequest(true, [], [], null));
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }

    [TestMethod]
    public void ValidateUpdate_AcceptsValidSelectorRule()
    {
        var service = new AclValidationService();
        var request = new AclUpdateRequest(
            true,
            [],
            [new AclRuleDto(true, true, false, null, "#secret", MumbleServer.PermissionEnter.value, 0)],
            "hash");

        var (valid, error) = service.ValidateUpdate(request);
        Assert.IsTrue(valid);
        Assert.IsNull(error);
    }

    [TestMethod]
    public void ValidateUpdate_AcceptsListenPermissionBit()
    {
        var service = new AclValidationService();
        var request = new AclUpdateRequest(
            true,
            [],
            [new AclRuleDto(true, false, false, null, "#secret", 0x800, 0)],
            "hash");

        var (valid, error) = service.ValidateUpdate(request);

        Assert.IsTrue(valid);
        Assert.IsNull(error);
    }

    [DataTestMethod]
    [DataRow("all")]
    [DataRow("auth")]
    [DataRow("in")]
    [DataRow("out")]
    [DataRow("sub")]
    [DataRow("#secret")]
    [DataRow("$certificate")]
    [DataRow("!moderator")]
    [DataRow("~moderator")]
    public void ValidateUpdate_RejectsReservedMumbleSelectorAsGroupName(string groupName)
    {
        var service = new AclValidationService();
        var request = new AclUpdateRequest(
            true,
            [new AclGroupDto(groupName, false, true, true, [], [], [])],
            [],
            "hash");

        var (valid, error) = service.ValidateUpdate(request);

        Assert.IsFalse(valid);
        StringAssert.Contains(error, "reserved");
    }

    [TestMethod]
    public void ValidateUpdate_AcceptsNormalGroupName()
    {
        var service = new AclValidationService();
        var request = new AclUpdateRequest(
            true,
            [new AclGroupDto("moderator", false, true, true, [], [], [])],
            [],
            "hash");

        var (valid, error) = service.ValidateUpdate(request);

        Assert.IsTrue(valid);
        Assert.IsNull(error);
    }
}
