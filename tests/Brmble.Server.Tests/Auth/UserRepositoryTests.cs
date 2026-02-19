using Brmble.Server.Auth;
using Brmble.Server.Data;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryTests
{
    // TODO: Add tests as methods are implemented in UserRepository:
    // - GetByCertHash_ExistingUser_ReturnsUser
    // - GetByCertHash_UnknownHash_ReturnsNull
    // - Insert_NewUser_PersistsToDatabase
    // - UpdateDisplayName_ExistingUser_UpdatesRecord

    [TestMethod]
    public void Constructor_WithValidDatabase_DoesNotThrow()
    {
        var db = new Database("Data Source=:memory:");
        var repo = new UserRepository(db);
        Assert.IsNotNull(repo);
    }
}
