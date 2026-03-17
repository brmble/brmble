using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleRegistrationServiceTests
{
    private MumbleRegistrationService _service = null!;

    [TestInitialize]
    public void Setup()
    {
        var logger = new Mock<ILogger<MumbleRegistrationService>>();
        _service = new MumbleRegistrationService(logger.Object);
    }

    [TestMethod]
    public async Task GetRegistrationStatusAsync_ThrowsWhenProxyNotSet()
    {
        await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
            () => _service.GetRegistrationStatusAsync(1));
    }

    [TestMethod]
    public async Task RegisterUserAsync_ThrowsWhenProxyNotSet()
    {
        await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
            () => _service.RegisterUserAsync("testuser", "abc123"));
    }

    [TestMethod]
    public async Task GetRegisteredNameAsync_ThrowsWhenProxyNotSet()
    {
        await Assert.ThrowsExceptionAsync<MumbleRegistrationException>(
            () => _service.GetRegisteredNameAsync(1));
    }

    [TestMethod]
    public void MumbleNameConflictException_ContainsRequestedName()
    {
        var ex = new MumbleNameConflictException("arie");
        Assert.AreEqual("arie", ex.RequestedName);
        Assert.IsTrue(ex.Message.Contains("arie"));
    }
}
