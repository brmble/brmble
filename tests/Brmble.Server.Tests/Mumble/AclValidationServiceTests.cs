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
}
