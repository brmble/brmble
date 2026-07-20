using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Games;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

file sealed class FakeSessionMapping : ISessionMappingService
{
    private readonly Dictionary<int, SessionMapping> _snapshot;
    public FakeSessionMapping(Dictionary<int, SessionMapping> snapshot) => _snapshot = snapshot;
    public IReadOnlyDictionary<int, SessionMapping> GetSnapshot() => _snapshot;

    public void SetNameForSession(string name, int sessionId) => throw new NotImplementedException();
    public bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId, string companionId) => throw new NotImplementedException();
    public void RemoveSession(int sessionId) => throw new NotImplementedException();
    public bool TryGetMatrixUserId(int sessionId, out string? matrixUserId) => throw new NotImplementedException();
    public bool TryGetSessionId(string mumbleName, out int sessionId) => throw new NotImplementedException();
    public bool TryGetSessionByUserId(long userId, out int sessionId) => throw new NotImplementedException();
    public bool TryGetMappingByUserId(long userId, out int sessionId, out SessionMapping? mapping) => throw new NotImplementedException();
    public bool TryUpdateCompanionId(int sessionId, string companionId) => throw new NotImplementedException();
    public bool TryUpdateBrmbleStatus(int sessionId, bool isBrmbleClient) => throw new NotImplementedException();
}

file sealed class FakeChannelMembership : IChannelMembershipService
{
    public void Update(int sessionId, int channelId) => throw new NotImplementedException();
    public void Remove(int sessionId) => throw new NotImplementedException();
    public bool TryGetChannel(int sessionId, out int channelId) => throw new NotImplementedException();
    public IReadOnlyList<int> GetSessionsInChannel(int channelId) => throw new NotImplementedException();
}

[TestClass]
public class SessionMappingGamePresenceTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;
    private UserRepository? _repo;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "presence_challenges_" + Guid.NewGuid().ToString("N");
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

    private static SessionMapping MappingFor(long userId)
        => new("@u:test.local", "user" + userId, userId, "companion" + userId, IsBrmbleClient: true);

    [TestMethod]
    public async Task AreChallengesBlocked_ReturnsTrue_WhenUserBlocked()
    {
        var user = await _repo!.Insert("cert-blocked", "alice");
        await _repo.SetChallengesBlocked(user.Id, true);
        var snapshot = new Dictionary<int, SessionMapping> { [10] = MappingFor(user.Id) };
        var presence = new SessionMappingGamePresence(new FakeSessionMapping(snapshot), new FakeChannelMembership(), _repo);

        Assert.IsTrue(await presence.AreChallengesBlockedAsync(10));
    }

    [TestMethod]
    public async Task AreChallengesBlocked_ReturnsFalse_WhenUserNotBlocked()
    {
        var user = await _repo!.Insert("cert-unblocked", "bob");
        var snapshot = new Dictionary<int, SessionMapping> { [20] = MappingFor(user.Id) };
        var presence = new SessionMappingGamePresence(new FakeSessionMapping(snapshot), new FakeChannelMembership(), _repo);

        Assert.IsFalse(await presence.AreChallengesBlockedAsync(20));
    }

    [TestMethod]
    public async Task AreChallengesBlocked_ReturnsFalse_WhenNoMapping()
    {
        var snapshot = new Dictionary<int, SessionMapping>();
        var presence = new SessionMappingGamePresence(new FakeSessionMapping(snapshot), new FakeChannelMembership(), _repo!);

        Assert.IsFalse(await presence.AreChallengesBlockedAsync(999));
    }
}
