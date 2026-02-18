using Brmble.Server.Auth;
using Brmble.Server.Data;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceTests
{
    private static AuthService CreateService()
    {
        var db = new Database("Data Source=:memory:");
        var repo = new UserRepository(db);
        return new AuthService(repo);
    }

    [TestMethod]
    public void IsBrmbleClient_UnknownHash_ReturnsFalse()
    {
        var svc = CreateService();
        Assert.IsFalse(svc.IsBrmbleClient("unknown-cert-hash"));
    }

    [TestMethod]
    public void IsBrmbleClient_EmptyHash_ReturnsFalse()
    {
        var svc = CreateService();
        Assert.IsFalse(svc.IsBrmbleClient(string.Empty));
    }

    [TestMethod]
    public void IsBrmbleClient_NullHash_ReturnsFalse()
    {
        var svc = CreateService();
        Assert.IsFalse(svc.IsBrmbleClient(null!));
    }

    // TODO: Add tests once Authenticate(certHash, displayName) is implemented:
    // - IsBrmbleClient_AfterAuthenticate_ReturnsTrue
    // - IsBrmbleClient_AfterDeactivate_ReturnsFalse
}
