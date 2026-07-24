using System.Text.Json;
using Brmble.Server.Data;
using Brmble.Server.Paint;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Paint;

[TestClass]
public sealed class PaintSessionManagerTests
{
    [TestMethod]
    public async Task CommitStroke_PublishesConcurrentPermanentEventsInRevisionOrder()
    {
        var fixture = await PaintSessionFixture.ActiveWithTwoParticipantsAsync();
        fixture.Publisher.BlockNextPermanentEvent();

        var firstCommit = fixture.CommitAliceAsync();
        await fixture.Publisher.WaitUntilBlockedAsync();
        var secondCommit = fixture.CommitBobAsync();

        fixture.Publisher.ReleaseBlockedEvent();
        var commits = await Task.WhenAll(firstCommit, secondCommit);

        CollectionAssert.AreEqual(new[] { PaintEventNames.StrokeCommitted, PaintEventNames.StrokeCommitted }, fixture.Publisher.PermanentEventTypes.TakeLast(2).ToArray());
        CollectionAssert.AreEqual(commits.Select(commit => commit.Revision).ToArray(), fixture.Publisher.PermanentRevisions.TakeLast(2).ToArray());
    }

    [TestMethod]
    public async Task CommitStroke_AssignsServerIdentitySequenceAndRevision()
    {
        var fixture = await PaintSessionFixture.ActiveWithParticipantAsync();

        var result = await fixture.Manager.CommitStrokeAsync(fixture.SessionId, fixture.AliceUserId,
            new PaintStrokeInput(Guid.NewGuid(), 0, PaintTool.Pen, "#ef4444", PaintStrokeWidth.Medium,
                [new PaintPoint(0.1, 0.2, 0.5)]));

        Assert.AreNotEqual(Guid.Empty, result.Stroke.Id);
        Assert.AreEqual(1L, result.Stroke.Sequence);
        Assert.AreEqual(3L, result.Revision);
        Assert.AreEqual(fixture.AliceUserId, result.Stroke.AuthorUserId);
        Assert.IsTrue(fixture.Publisher.SentTypes.Contains(PaintEventNames.StrokeCommitted));
    }

    [TestMethod]
    public async Task Undo_RemovesOnlyCallerMostRecentActiveStroke()
    {
        var fixture = await PaintSessionFixture.ActiveWithTwoParticipantsAsync();
        var aliceFirst = await fixture.CommitAliceAsync();
        var bobStroke = await fixture.CommitBobAsync();
        var aliceSecond = await fixture.CommitAliceAsync();

        var undo = await fixture.Manager.UndoAsync(fixture.SessionId, fixture.AliceUserId);
        var snapshot = await fixture.Manager.SnapshotAsync(fixture.SessionId, fixture.AliceUserId);

        Assert.AreEqual(aliceSecond.Stroke.Id, undo.UndoneStrokeId);
        Assert.IsTrue(snapshot.Strokes.Single(s => s.Id == aliceFirst.Stroke.Id).Active);
        Assert.IsTrue(snapshot.Strokes.Single(s => s.Id == bobStroke.Stroke.Id).Active);
        Assert.IsFalse(snapshot.Strokes.Any(s => s.Id == aliceSecond.Stroke.Id));
    }

    [TestMethod]
    public async Task Clear_HostOnlyIncrementsGenerationAndHidesOldStrokes()
    {
        var fixture = await PaintSessionFixture.ActiveWithTwoParticipantsAsync();
        await fixture.CommitAliceAsync();

        await Assert.ThrowsExceptionAsync<PaintAuthorizationException>(() =>
            fixture.Manager.ClearAsync(fixture.SessionId, fixture.BobUserId));

        var clear = await fixture.Manager.ClearAsync(fixture.SessionId, fixture.HostUserId);
        var snapshot = await fixture.Manager.SnapshotAsync(fixture.SessionId, fixture.HostUserId);

        Assert.AreEqual(1L, clear.Generation);
        Assert.AreEqual(0, snapshot.Strokes.Count);
    }

    [TestMethod]
    public async Task Join_RequiresMatrixMembershipBeforeActivatingParticipant()
    {
        var fixture = await PaintSessionFixture.PendingWithTwoParticipantsAsync();
        fixture.Matrix.Memberships[fixture.BobMatrixUserId] = "leave";

        await Assert.ThrowsExceptionAsync<PaintAuthorizationException>(() =>
            fixture.Manager.JoinAsync(fixture.SessionId, fixture.BobUserId));

        CollectionAssert.Contains(fixture.Matrix.InvitedUsers, fixture.BobMatrixUserId);
    }

    [TestMethod]
    public async Task End_WritesCleanupThenAttemptsRoomDeletion()
    {
        var fixture = await PaintSessionFixture.ActiveWithParticipantAsync();
        fixture.Matrix.DeleteResult = new MatrixPaintRoomCleanupResult(false, "delete", "unavailable");

        var result = await fixture.Manager.EndAsync(fixture.SessionId, fixture.HostUserId);
        var pending = await fixture.Cleanup.GetPendingAsync();

        Assert.AreEqual(PaintSessionStatus.Ended, result.Status);
        Assert.AreEqual(1, pending.Count);
        Assert.AreEqual(fixture.Matrix.RoomId, pending[0].MatrixRoomId);
    }

    [TestMethod]
    public async Task Preview_BackpressureMaySkipPreviewButNeverPreventsCommit()
    {
        var fixture = await PaintSessionFixture.ActiveWithParticipantAsync();
        var accepted = 0;
        for (var i = 0; i < 21; i++)
        {
            var preview = await fixture.Manager.PreviewAsync(fixture.SessionId, fixture.AliceUserId,
                new PaintStrokeInput(Guid.NewGuid(), 0, PaintTool.Pen, "#ef4444", PaintStrokeWidth.Thin,
                    [new PaintPoint(0.1, 0.2, null)]));
            if (preview.Published) accepted++;
        }

        var commit = await fixture.CommitAliceAsync();

        Assert.AreEqual(20, accepted);
        Assert.AreNotEqual(Guid.Empty, commit.Stroke.Id);
        Assert.IsTrue(fixture.Publisher.SentTypes.Contains(PaintEventNames.StrokeCommitted));
    }

    [TestMethod]
    public async Task ExpireInactive_ExpiresAndWritesCleanup()
    {
        var fixture = await PaintSessionFixture.ActiveWithParticipantAsync();
        fixture.Now = fixture.Now.AddMinutes(30);

        await fixture.Manager.ExpireInactiveForTestAsync();

        var snapshot = await fixture.Manager.SnapshotAsync(fixture.SessionId, fixture.HostUserId);
        Assert.AreEqual(PaintSessionStatus.Expired, snapshot.Status);
        Assert.AreEqual(1, (await fixture.Cleanup.GetPendingAsync()).Count);
    }

    private sealed class PaintSessionFixture
    {
        public long HostUserId => 1;
        public long AliceUserId => 2;
        public long BobUserId => 3;
        public string HostMatrixUserId => "@host:test";
        public string AliceMatrixUserId => "@alice:test";
        public string BobMatrixUserId => "@bob:test";

        public PaintSessionManager Manager { get; set; } = null!;
        public required FakePublisher Publisher { get; init; }
        public required FakeMatrixPaintService Matrix { get; init; }
        public required PaintRoomCleanupRepository Cleanup { get; init; }
        public Guid SessionId { get; set; }
        public DateTimeOffset Now { get; set; } = new(2026, 7, 24, 12, 0, 0, TimeSpan.Zero);

        public static async Task<PaintSessionFixture> PendingWithTwoParticipantsAsync()
        {
            var fixture = New();
            var create = await fixture.Manager.CreateAsync(1, [2, 3]);
            fixture.SessionId = create.SessionId;
            return fixture;
        }

        public static async Task<PaintSessionFixture> ActiveWithParticipantAsync()
        {
            var fixture = await PendingWithTwoParticipantsAsync();
            await fixture.Manager.AttachSourceAsync(fixture.SessionId, 1, "$source");
            fixture.Matrix.Memberships["@alice:test"] = "join";
            await fixture.Manager.JoinAsync(fixture.SessionId, 2);
            return fixture;
        }

        public static async Task<PaintSessionFixture> ActiveWithTwoParticipantsAsync()
        {
            var fixture = await ActiveWithParticipantAsync();
            fixture.Matrix.Memberships["@alice:test"] = "join";
            fixture.Matrix.Memberships["@bob:test"] = "join";
            await fixture.Manager.JoinAsync(fixture.SessionId, 2);
            await fixture.Manager.JoinAsync(fixture.SessionId, 3);
            return fixture;
        }

        public async Task<PaintStrokeCommittedResult> CommitAliceAsync() => await CommitAsync(AliceUserId);
        public async Task<PaintStrokeCommittedResult> CommitBobAsync() => await CommitAsync(BobUserId);

        private async Task<PaintStrokeCommittedResult> CommitAsync(long userId) => await Manager.CommitStrokeAsync(SessionId, userId,
            new PaintStrokeInput(Guid.NewGuid(), 0, PaintTool.Pen, "#ef4444", PaintStrokeWidth.Thin,
                [new PaintPoint(0.1, 0.2, null)]));

        private static PaintSessionFixture New()
        {
            var presence = new FakePresence();
            presence.Participants[1] = new(1, 9, 101, "@host:test");
            presence.Participants[2] = new(2, 9, 102, "@alice:test");
            presence.Participants[3] = new(3, 9, 103, "@bob:test");
            var matrix = new FakeMatrixPaintService();
            var publisher = new FakePublisher();
            var path = Path.Combine(Path.GetTempPath(), $"brmble-paint-{Guid.NewGuid():N}.db");
            var database = new Database($"Data Source={path}");
            database.Initialize();
            var fixture = new PaintSessionFixture
            {
                Matrix = matrix,
                Publisher = publisher,
                Cleanup = new PaintRoomCleanupRepository(database),
            };
            fixture.Manager = new PaintSessionManager(presence, publisher, matrix, new MatrixPaintSourceResolver(matrix), fixture.Cleanup,
                new PaintRateLimiter(), () => fixture.Now);
            return fixture;
        }
    }

    private sealed class FakePresence : IPaintPresence
    {
        public Dictionary<long, PaintPresenceParticipant> Participants { get; } = [];
        public bool TryGetParticipant(long userId, out PaintPresenceParticipant participant) => Participants.TryGetValue(userId, out participant!);
        public IReadOnlyList<PaintPresenceParticipant> GetParticipantsInChannel(int channelId) => Participants.Values.Where(p => p.ChannelId == channelId).ToArray();
    }

    private sealed class FakePublisher : IPaintEventPublisher
    {
        public List<string> SentTypes { get; } = [];
        public List<string> PermanentEventTypes { get; } = [];
        public List<long> PermanentRevisions { get; } = [];
        private readonly TaskCompletionSource _blocked = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private bool _blockNextPermanentEvent;

        public void BlockNextPermanentEvent() => _blockNextPermanentEvent = true;
        public Task WaitUntilBlockedAsync() => _blocked.Task;
        public void ReleaseBlockedEvent() => _release.TrySetResult();

        public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => PublishAsync(message);
        public Task PublishToChannelAsync(int channelId, object message) => PublishAsync(message);

        private async Task PublishAsync(object message)
        {
            var type = ReadType(message);
            if (!string.Equals(type, PaintEventNames.PreviewUpdated, StringComparison.Ordinal))
            {
                if (_blockNextPermanentEvent)
                {
                    _blockNextPermanentEvent = false;
                    _blocked.TrySetResult();
                    await _release.Task;
                }

                PermanentEventTypes.Add(type);
                var revision = message.GetType().GetProperty("revision")?.GetValue(message);
                if (revision is long value) PermanentRevisions.Add(value);
            }

            SentTypes.Add(type);
        }

        private static string ReadType(object message) => message.GetType().GetProperty("type")?.GetValue(message)?.ToString() ?? string.Empty;
    }

    private sealed class FakeMatrixPaintService : IMatrixPaintService
    {
        public string RoomId { get; } = "!paint:test";
        public Dictionary<string, string?> Memberships { get; } = [];
        public List<string> InvitedUsers { get; } = [];
        public MatrixPaintRoomCleanupResult DeleteResult { get; set; } = new(true, "delete", null);
        public Task<string> CreatePaintRoomAsync(string name, IReadOnlyList<string> invitedMatrixUserIds, CancellationToken cancellationToken) => Task.FromResult(RoomId);
        public Task InvitePaintUserAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) { InvitedUsers.Add(matrixUserId); return Task.CompletedTask; }
        public Task<JsonElement> GetRoomEventAsync(string roomId, string eventId, CancellationToken cancellationToken) => Task.FromResult(JsonDocument.Parse("""{"room_id":"!paint:test","sender":"@host:test","type":"m.image","content":{"url":"mxc://test/image","info":{"mimetype":"image/png","size":4}}}""").RootElement.Clone());
        public Task<string?> GetMembershipAsync(string roomId, string matrixUserId, CancellationToken cancellationToken) => Task.FromResult(Memberships.GetValueOrDefault(matrixUserId));
        public Task<byte[]> DownloadMediaAsync(string mxcUrl, CancellationToken cancellationToken) => Task.FromResult(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137 });
        public Task<MatrixPaintRoomCleanupResult> DeletePaintRoomAsync(string roomId, CancellationToken cancellationToken) => Task.FromResult(DeleteResult);
    }
}
