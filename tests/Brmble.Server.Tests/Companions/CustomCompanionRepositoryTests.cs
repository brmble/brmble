using Brmble.Server.Companions;
using Brmble.Server.Data;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Companions;

[TestClass]
public sealed class CustomCompanionRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private CustomCompanionRepository _repository = null!;

    [TestInitialize]
    public void Setup()
    {
        var databaseName = "testdb_" + Guid.NewGuid().ToString("N");
        var connectionString = $"Data Source={databaseName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(connectionString);
        _keepAlive.Open();
        var database = new Database(connectionString);
        database.Initialize();
        _repository = new CustomCompanionRepository(database);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public async Task InsertAndDelete_PreservesEventIdentityAndRemovesFromActiveGallery()
    {
        var record = new CustomCompanionRecord(
            "$sprite:test", "sprite-1", "!gallery:test", 7, "@7:test", "Alice",
            "Orbit", "mxc://test/media", "image/png", 1536, 1872, 1, 1024,
            DateTimeOffset.Parse("2026-07-29T10:00:00Z"), null, null);

        await _repository.InsertAsync(record);
        Assert.AreEqual("$sprite:test", (await _repository.GetActiveByEventIdAsync("$sprite:test"))?.EventId);

        Assert.IsTrue(await _repository.MarkDeletedAsync("$sprite:test", 9, DateTimeOffset.Parse("2026-07-29T11:00:00Z")));
        Assert.IsNull(await _repository.GetActiveByEventIdAsync("$sprite:test"));
        Assert.IsFalse(await _repository.MarkDeletedAsync("$sprite:test", 9, DateTimeOffset.Parse("2026-07-29T11:01:00Z")));
    }

    [TestMethod]
    public async Task GetActiveAsync_ReturnsActiveRecordsNewestFirst()
    {
        await _repository.InsertAsync(CreateRecord("$sprite:old", 7, "2026-07-29T10:00:00Z"));
        await _repository.InsertAsync(CreateRecord("$sprite:b", 8, "2026-07-29T11:00:00Z"));
        await _repository.InsertAsync(CreateRecord("$sprite:a", 7, "2026-07-29T11:00:00Z"));
        await _repository.MarkDeletedAsync("$sprite:old", 9, DateTimeOffset.Parse("2026-07-29T12:00:00Z"));

        var records = await _repository.GetActiveAsync();

        CollectionAssert.AreEqual(new[] { "$sprite:a", "$sprite:b" }, records.Select(record => record.EventId).ToArray());
    }

    [TestMethod]
    public async Task CountsAndGalleryRoom_TrackActiveRecordsAndSingletonRoom()
    {
        await _repository.InsertAsync(CreateRecord("$sprite:one", 7, "2026-07-29T10:00:00Z"));
        await _repository.InsertAsync(CreateRecord("$sprite:two", 7, "2026-07-29T11:00:00Z"));
        await _repository.InsertAsync(CreateRecord("$sprite:three", 8, "2026-07-29T12:00:00Z"));
        await _repository.MarkDeletedAsync("$sprite:two", 9, DateTimeOffset.Parse("2026-07-29T13:00:00Z"));

        await _repository.SetRoomIdAsync("!first:test");
        await _repository.SetRoomIdAsync("!gallery:test");

        Assert.AreEqual(1, await _repository.CountActiveForUserAsync(7));
        Assert.AreEqual(2, await _repository.CountActiveAsync());
        Assert.AreEqual("!gallery:test", await _repository.GetRoomIdAsync());
    }

    [TestMethod]
    public async Task ResetSelectionsAsync_ReturnsAffectedUsersAndPreservesBuiltInIds()
    {
        using var connection = _keepAlive!;
        await connection.ExecuteAsync("""
            INSERT INTO users (id, cert_hash, display_name, matrix_user_id, companion_id) VALUES
                (1, 'hash1', 'Alice', '@1:test', 'custom:$sprite:test'),
                (2, 'hash2', 'Bob', '@2:test', 'floppy'),
                (3, 'hash3', 'Charlie', '@3:test', 'custom:$sprite:other');
            """);

        var affectedUserIds = await _repository.ResetSelectionsAsync("$sprite:test");
        var selections = (await connection.QueryAsync<(long Id, string CompanionId)>("SELECT id, companion_id FROM users ORDER BY id")).ToArray();

        CollectionAssert.AreEqual(new[] { 1L }, affectedUserIds.ToArray());
        CollectionAssert.AreEqual(new[] { "floppy", "floppy", "custom:$sprite:other" }, selections.Select(selection => selection.CompanionId).ToArray());
    }

    private static CustomCompanionRecord CreateRecord(string eventId, long userId, string createdAt) => new(
        eventId, eventId[1..], "!gallery:test", userId, $"@{userId}:test", "Alice",
        eventId, "mxc://test/media", "image/png", 16, 16, 1, 1024,
        DateTimeOffset.Parse(createdAt), null, null);
}
