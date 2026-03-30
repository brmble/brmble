using Brmble.Server.Moderator;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests;

[TestClass]
public class PermissionEnforcerTests
{
    private Mock<IModeratorPermissionChecker> _checkerMock = null!;
    private PermissionEnforcer _enforcer = null!;

    [TestInitialize]
    public void Setup()
    {
        _checkerMock = new Mock<IModeratorPermissionChecker>();
        _enforcer = new PermissionEnforcer(_checkerMock.Object);
    }

    [TestMethod]
    public async Task HasModeratorPermission_ReturnsTrue_WhenUserHasPermission()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermissions.Kick | ModeratorPermissions.DenyEnter);

        var result = await _enforcer.HasModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermissions.Kick);

        Assert.IsTrue(result);
    }

    [TestMethod]
    public async Task HasModeratorPermission_ReturnsFalse_WhenUserLacksPermission()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermissions.Kick);

        var result = await _enforcer.HasModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermissions.DenyEnter);

        Assert.IsFalse(result);
    }

    [TestMethod]
    public async Task HasModeratorPermission_ReturnsFalse_WhenUserHasNoModeratorRole()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermissions.None);

        var result = await _enforcer.HasModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermissions.Kick);

        Assert.IsFalse(result);
    }

    [TestMethod]
    public async Task RequireModeratorPermission_Throws_WhenUserLacksPermission()
    {
        _checkerMock.Setup(x => x.GetModeratorPermissionsAsync(It.IsAny<int>(), It.IsAny<int>()))
            .ReturnsAsync(ModeratorPermissions.None);

        await Assert.ThrowsExceptionAsync<UnauthorizedAccessException>(
            () => _enforcer.RequireModeratorPermissionAsync(userId: 123, channelId: 5, ModeratorPermissions.Kick));
    }
}
