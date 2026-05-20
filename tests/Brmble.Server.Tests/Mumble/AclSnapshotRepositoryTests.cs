using Brmble.Server.Data;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclSnapshotRepositoryTests
{
    private SqliteConnection _keepAlive = null!;
    private Database _db = null!;
    private AclSnapshotRepository _repo = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "acl_snapshots_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        _repo = new AclSnapshotRepository(_db);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive.Dispose();

    [TestMethod]
    public async Task UpsertAndGetAsync_RoundTripsSnapshot()
    {
        var snapshot = new AclChannelSnapshotDto(
            ChannelId: 3,
            InheritAcls: true,
            Groups: [new AclGroupDto("admin", false, true, true, [1], [], [1])],
            Acls: [new AclRuleDto(true, true, false, null, "#secret", MumbleServer.PermissionEnter.value, 0)],
            FetchedAt: new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero),
            Stale: false,
            Warning: null);

        await _repo.UpsertAsync(snapshot);
        var loaded = await _repo.GetAsync(3);

        Assert.IsNotNull(loaded);
        Assert.AreEqual("#secret", loaded!.Acls[0].Group);
        Assert.IsFalse(string.IsNullOrWhiteSpace(loaded.SnapshotHash));
        Assert.IsFalse(loaded.Stale);
    }

    [TestMethod]
    public async Task MarkStaleAsync_PreservesPayloadAndStoresReason()
    {
        var snapshot = new AclChannelSnapshotDto(4, true, [], [], DateTimeOffset.UtcNow, false, null);
        await _repo.UpsertAsync(snapshot);

        await _repo.MarkStaleAsync(4, "refresh failed");
        var loaded = await _repo.GetAsync(4);

        Assert.IsNotNull(loaded);
        Assert.IsTrue(loaded!.Stale);
        Assert.AreEqual("refresh failed", loaded.Warning);
    }
}
