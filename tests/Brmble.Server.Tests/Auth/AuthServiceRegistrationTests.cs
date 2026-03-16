using Brmble.Server.Auth;
using Brmble.Server.Mumble;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceRegistrationTests
{
    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   ")]
    public void ValidateMumbleUsername_RejectsEmptyNames(string? name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }

    [TestMethod]
    public void ValidateMumbleUsername_RejectsNamesTooLong()
    {
        var longName = new string('a', 129);
        var (valid, error) = AuthService.ValidateMumbleUsername(longName);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }

    [TestMethod]
    [DataRow("arie")]
    [DataRow("Player_1")]
    [DataRow("a")]
    public void ValidateMumbleUsername_AcceptsValidNames(string name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsTrue(valid);
        Assert.IsNull(error);
    }

    [TestMethod]
    [DataRow("user/name")]
    [DataRow("user#name")]
    public void ValidateMumbleUsername_RejectsInvalidCharacters(string name)
    {
        var (valid, error) = AuthService.ValidateMumbleUsername(name);
        Assert.IsFalse(valid);
        Assert.IsNotNull(error);
    }
}
