using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryChallengesBlockedTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;
    private UserRepository? _repo;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "userrepo_challenges_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        var settings = Options.Create(new MatrixSettings { HomeserverUrl = "http://localhost", AppServiceToken = "test", ServerDomain = "test.local" });
        _repo = new UserRepository(_db, settings);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task ChallengesBlocked_DefaultsFalse_AndRoundTrips()
    {
        var user = await _repo!.Insert("challenges-cert", "alice");

        Assert.IsFalse(await _repo.GetChallengesBlocked(user.Id));

        await _repo.SetChallengesBlocked(user.Id, true);
        Assert.IsTrue(await _repo.GetChallengesBlocked(user.Id));

        await _repo.SetChallengesBlocked(user.Id, false);
        Assert.IsFalse(await _repo.GetChallengesBlocked(user.Id));
    }
}
