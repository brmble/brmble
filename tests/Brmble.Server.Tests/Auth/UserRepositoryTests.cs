// tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;
    private UserRepository? _repo;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "userrepo_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Matrix:ServerDomain"] = "test.local"
            })
            .Build();
        _repo = new UserRepository(_db, config);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void Constructor_WithValidDatabase_DoesNotThrow()
    {
        Assert.IsNotNull(_repo);
    }

    [TestMethod]
    public async Task GetByCertHash_UnknownHash_ReturnsNull()
    {
        var result = await _repo!.GetByCertHash("nonexistent");
        Assert.IsNull(result);
    }

    [TestMethod]
    public async Task GetByCertHash_ExistingUser_ReturnsUser()
    {
        var inserted = await _repo!.Insert("abc123", "TestUser");
        var found = await _repo.GetByCertHash("abc123");
        Assert.IsNotNull(found);
        Assert.AreEqual(inserted.Id, found.Id);
        Assert.AreEqual("abc123", found.CertHash);
        Assert.AreEqual("TestUser", found.DisplayName);
    }
}
