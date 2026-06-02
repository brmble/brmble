using Brmble.Server.ChannelRequests;
using Brmble.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.ChannelRequests;

[TestClass]
public class ChannelRequestRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private ChannelRequestRepository? _repo;

    [TestInitialize]
    public void Setup()
    {
        var name = "channel_requests_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={name};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        _repo = new ChannelRequestRepository(db);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task CreatePendingAsync_PersistsPendingRequest()
    {
        var created = await _repo!.CreatePendingAsync(new CreateChannelRequestRecord(
            RequesterUserId: 11,
            RequesterDisplayName: "Alice",
            RequestedChannelName: "Raid Team 2",
            NormalizedChannelName: "raid team 2",
            Reason: "Weekly runs"), 3);

        Assert.AreEqual(CreatePendingChannelRequestOutcome.Created, created.Outcome);
        Assert.AreEqual(ChannelRequestStatus.Pending, created.Request!.Status);
        Assert.AreEqual("Raid Team 2", created.Request.RequestedChannelName);
    }

    [TestMethod]
    public async Task CreatePendingAsync_ReturnsDuplicateForSameUserAndName()
    {
        await _repo!.CreatePendingAsync(new CreateChannelRequestRecord(11, "Alice", "Raid Team 2", "raid team 2", null), 3);

        var result = await _repo.CreatePendingAsync(new CreateChannelRequestRecord(11, "Alice", "Raid Team 2", "raid team 2", null), 3);

        Assert.AreEqual(CreatePendingChannelRequestOutcome.DuplicatePending, result.Outcome);
    }

    [TestMethod]
    public async Task CreatePendingAsync_ReturnsTooManyPendingWhenLimitReached()
    {
        await _repo!.CreatePendingAsync(new CreateChannelRequestRecord(11, "Alice", "Raid Team 2", "raid team 2", null), 1);

        var result = await _repo.CreatePendingAsync(new CreateChannelRequestRecord(11, "Alice", "Arena", "arena", null), 1);

        Assert.AreEqual(CreatePendingChannelRequestOutcome.TooManyPending, result.Outcome);
    }
}
