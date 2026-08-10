using System.Text.Json;
using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintSessionManagerTests
{
    [TestMethod]
    public async Task Summary_UserWhoEnteredChannelAfterCreationCanJoin()
    {
        var fixture = await PaintSessionFixture.ActiveAsync();
        fixture.Presence.Participants[fixture.BobUserId] = new(fixture.BobUserId, 9, 203, fixture.BobMatrixUserId);

        var summary = await fixture.Manager.SummaryAsync(fixture.SessionId, fixture.BobUserId);

        Assert.IsTrue(summary.CanJoin);
        Assert.IsFalse(summary.IsParticipant);
    }

    [TestMethod]
    public async Task Join_CurrentChannelMemberDoesNotNeedMatrixRoomMembership()
    {
        var fixture = await PaintSessionFixture.ActiveAsync();
        fixture.Presence.Participants[fixture.BobUserId] = new(fixture.BobUserId, 9, 203, fixture.BobMatrixUserId);

        var joined = await fixture.Manager.JoinAsync(fixture.SessionId, fixture.BobUserId);

        Assert.AreEqual(203, joined.Participant.MumbleSessionId);
    }

    [TestMethod]
    public async Task Summary_UserOutsideSessionChannelIsRejected()
    {
        var fixture = await PaintSessionFixture.ActiveAsync();
        fixture.Presence.Participants[fixture.BobUserId] = new(fixture.BobUserId, 12, 203, fixture.BobMatrixUserId);

        await Assert.ThrowsExceptionAsync<PaintAuthorizationException>(() =>
            fixture.Manager.SummaryAsync(fixture.SessionId, fixture.BobUserId));
    }

    [TestMethod]
    public async Task Create_WritesSourceBeforeReturningActiveSession()
    {
        var fixture = PaintSessionFixture.New();
        var created = await fixture.Manager.CreateAsync(fixture.HostUserId, "image/png", PaintTestImages.ValidPng, CancellationToken.None);

        var snapshot = await fixture.Manager.SnapshotAsync(created.SessionId, fixture.HostUserId);
        Assert.AreEqual(PaintSessionStatus.Active, snapshot.Status);
        Assert.IsNotNull(snapshot.Source);
        CollectionAssert.AreEqual(PaintTestImages.ValidPng,
            (await fixture.Manager.ReadSourceAsync(created.SessionId, fixture.HostUserId, CancellationToken.None)).Bytes);
    }

    [TestMethod]
    public async Task Create_WhenStoreWriteFails_RemovesSessionAndSchedulesCleanup()
    {
        var fixture = PaintSessionFixture.New(store: new FailingWritePaintSourceStore());

        await Assert.ThrowsExceptionAsync<IOException>(() => fixture.Manager.CreateAsync(
            fixture.HostUserId, "image/png", PaintTestImages.ValidPng, CancellationToken.None));

        Assert.AreEqual(1, (await fixture.Cleanup.GetDueAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task End_MakesSourceUnauthorizedAndSchedulesCleanup()
    {
        var fixture = await PaintSessionFixture.ActiveAsync();
        await fixture.Manager.EndAsync(fixture.SessionId, fixture.HostUserId);

        await Assert.ThrowsExceptionAsync<PaintConflictException>(() =>
            fixture.Manager.ReadSourceAsync(fixture.SessionId, fixture.HostUserId, CancellationToken.None));
        Assert.AreEqual(1, (await fixture.Cleanup.GetDueAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task End_RecordsOnlyItsSessionAndLeavesOtherSourceReadable()
    {
        var fixture = PaintSessionFixture.New();
        var first = await fixture.Manager.CreateAsync(fixture.HostUserId, "image/png", PaintTestImages.ValidPng, CancellationToken.None);
        fixture.Presence.Participants[4] = new(4, 9, 104, "@four:test");
        var second = await fixture.Manager.CreateAsync(4, "image/png", PaintTestImages.ValidPng, CancellationToken.None);

        await fixture.Manager.EndAsync(first.SessionId, fixture.HostUserId);

        Assert.AreEqual(first.SessionId, (await fixture.Cleanup.GetDueAsync(CancellationToken.None)).Single().SessionId);
        CollectionAssert.AreEqual(PaintTestImages.ValidPng,
            (await fixture.Manager.ReadSourceAsync(second.SessionId, 4, CancellationToken.None)).Bytes);
    }

    [TestMethod]
    public async Task Disconnect_RemovesParticipationAndReconnectRequiresJoinAgain()
    {
        var fixture = await PaintSessionFixture.ActiveWithBobAsync();
        await fixture.Manager.HandleSessionDisconnectedAsync(103);
        fixture.Presence.Participants[fixture.BobUserId] = new(fixture.BobUserId, 9, 203, fixture.BobMatrixUserId);

        var summary = await fixture.Manager.SummaryAsync(fixture.SessionId, fixture.BobUserId);
        Assert.IsTrue(summary.CanJoin);
        Assert.IsFalse(summary.IsParticipant);
        await Assert.ThrowsExceptionAsync<PaintAuthorizationException>(() =>
            fixture.Manager.SnapshotAsync(fixture.SessionId, fixture.BobUserId));
        Assert.AreEqual(203, (await fixture.Manager.JoinAsync(fixture.SessionId, fixture.BobUserId)).Participant.MumbleSessionId);
    }

    [TestMethod]
    public async Task Expire_MakesSourceUnavailableAndSchedulesCleanup()
    {
        var fixture = await PaintSessionFixture.ActiveAsync();
        fixture.Now = fixture.Now.AddMinutes(30);

        await fixture.Manager.ExpireInactiveForTestAsync();

        var snapshot = await fixture.Manager.SnapshotAsync(fixture.SessionId, fixture.HostUserId);
        Assert.AreEqual(PaintSessionStatus.Expired, snapshot.Status);
        Assert.AreEqual(1, (await fixture.Cleanup.GetDueAsync(CancellationToken.None)).Count);
    }

    [TestMethod]
    public async Task End_WhenCleanupSchedulingFails_RemainsTerminalAndScannerRemovesSource()
    {
        var cleanup = new FailingOnceCleanupRepository();
        var fixture = PaintSessionFixture.New(cleanup: cleanup);
        var created = await fixture.Manager.CreateAsync(fixture.HostUserId, "image/png", PaintTestImages.ValidPng, CancellationToken.None);
        fixture.SessionId = created.SessionId;

        await fixture.Manager.EndAsync(fixture.SessionId, fixture.HostUserId);

        Assert.AreEqual(PaintSessionStatus.Ended, (await fixture.Manager.SnapshotAsync(fixture.SessionId, fixture.HostUserId)).Status);
        Assert.IsTrue(fixture.Store.Sources.ContainsKey(fixture.SessionId));
        var service = new PaintTemporaryCleanupService(cleanup, fixture.Store, fixture.Manager);
        await service.ProcessPendingAsync(CancellationToken.None);
        Assert.IsFalse(fixture.Store.Sources.ContainsKey(fixture.SessionId));
    }

    private static class PaintTestImages
    {
        public static readonly byte[] ValidPng = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    }

    private sealed class PaintSessionFixture
    {
        public long HostUserId => 1;
        public long BobUserId => 3;
        public string HostMatrixUserId => "@host:test";
        public string BobMatrixUserId => "@bob:test";
        public required PaintSessionManager Manager { get; set; }
        public required FakePresence Presence { get; init; }
        public required FakeSourceStore Store { get; init; }
        public required PaintTemporaryCleanupRepository Cleanup { get; init; }
        public Guid SessionId { get; set; }
        public DateTimeOffset Now { get; set; } = new(2026, 7, 24, 12, 0, 0, TimeSpan.Zero);

        public static async Task<PaintSessionFixture> ActiveAsync()
        {
            var fixture = New();
            var created = await fixture.Manager.CreateAsync(fixture.HostUserId, "image/png", PaintTestImages.ValidPng, CancellationToken.None);
            fixture.SessionId = created.SessionId;
            return fixture;
        }

        public static async Task<PaintSessionFixture> ActiveWithBobAsync()
        {
            var fixture = await ActiveAsync();
            await fixture.Manager.JoinAsync(fixture.SessionId, fixture.BobUserId);
            return fixture;
        }

        public static PaintSessionFixture New(IPaintTemporarySourceStore? store = null, PaintTemporaryCleanupRepository? cleanup = null)
        {
            var presence = new FakePresence();
            presence.Participants[1] = new(1, 9, 101, "@host:test");
            presence.Participants[3] = new(3, 9, 103, "@bob:test");
            var database = new Database($"Data Source={Path.Combine(Path.GetTempPath(), $"brmble-paint-{Guid.NewGuid():N}.db")}");
            database.Initialize();
            var cleanupRepository = cleanup ?? new PaintTemporaryCleanupRepository(database);
            var sourceStore = store ?? new FakeSourceStore();
            var fixture = new PaintSessionFixture { Presence = presence, Store = (FakeSourceStore)sourceStore, Cleanup = cleanupRepository, Manager = null! };
            fixture.Manager = new PaintSessionManager(presence, new FakePublisher(), new PaintSourceValidator(), sourceStore, cleanupRepository, new PaintRateLimiter(), () => fixture.Now);
            return fixture;
        }
    }

    private class FakeSourceStore : IPaintTemporarySourceStore
    {
        public Dictionary<Guid, byte[]> Sources { get; } = [];
        public virtual Task WriteAsync(Guid sessionId, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken) { Sources[sessionId] = bytes.ToArray(); return Task.CompletedTask; }
        public virtual Task<byte[]> ReadAsync(Guid sessionId, CancellationToken cancellationToken) => Task.FromResult(Sources[sessionId]);
        public virtual Task DeleteAsync(Guid sessionId, CancellationToken cancellationToken) { Sources.Remove(sessionId); return Task.CompletedTask; }
        public virtual Task<IReadOnlyList<Guid>> ListSessionIdsAsync(CancellationToken cancellationToken) => Task.FromResult<IReadOnlyList<Guid>>(Sources.Keys.ToArray());
    }

    private sealed class FailingWritePaintSourceStore : FakeSourceStore
    {
        public override Task WriteAsync(Guid sessionId, ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken) => throw new IOException("write failed");
    }

    private sealed class FailingOnceCleanupRepository : PaintTemporaryCleanupRepository
    {
        public FailingOnceCleanupRepository()
            : this(new Database($"Data Source={Path.Combine(Path.GetTempPath(), $"brmble-paint-cleanup-{Guid.NewGuid():N}.db")}")) { }
        private FailingOnceCleanupRepository(Database database) : base(database) { database.Initialize(); }
        private bool _shouldFail = true;
        public override Task RecordPendingAsync(Guid sessionId, CancellationToken cancellationToken = default)
        {
            if (_shouldFail) { _shouldFail = false; throw new IOException("cleanup unavailable"); }
            return base.RecordPendingAsync(sessionId, cancellationToken);
        }
    }

    private sealed class FakePresence : IPaintPresence
    {
        public Dictionary<long, PaintPresenceParticipant> Participants { get; } = [];
        public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant) => Participants.TryGetValue(userId, out participant!);
        public bool TryGetParticipantByMumbleSessionId(int mumbleSessionId, out PaintPresenceParticipant participant) { participant = Participants.Values.SingleOrDefault(x => x.MumbleSessionId == mumbleSessionId)!; return participant is not null; }
        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => Participants.Values.Where(x => x.ChannelId == channelId).ToArray();
    }

    private sealed class FakePublisher : IPaintEventPublisher
    {
        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => Task.CompletedTask;
        public Task PublishPreviewToUsersAsync(IReadOnlySet<long> userIds, Guid sessionId, long authorUserId, object message) => Task.CompletedTask;
        public Task PublishToChannelAsync(int channelId, object message) => Task.CompletedTask;
    }
}
