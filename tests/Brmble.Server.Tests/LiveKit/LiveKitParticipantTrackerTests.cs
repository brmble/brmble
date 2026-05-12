using Brmble.Server.LiveKit;
using System.Collections.Concurrent;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitParticipantTrackerTests
{
    [TestMethod]
    public void Upsert_ReplacesExistingParticipantRecord()
    {
        var tracker = new LiveKitParticipantTracker();
        var firstExpiry = DateTimeOffset.UtcNow.AddMinutes(5);
        var secondExpiry = DateTimeOffset.UtcNow.AddMinutes(10);

        Assert.IsTrue(tracker.TryUpsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, firstExpiry)));
        Assert.IsTrue(tracker.TryUpsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Publish, secondExpiry)));

        var records = tracker.GetSnapshot();

        Assert.AreEqual(1, records.Count);
        Assert.AreEqual(LiveKitAccessMode.Publish, records[0].AccessMode);
        Assert.AreEqual(secondExpiry, records[0].ExpiresAt);
    }

    [TestMethod]
    public void RemoveBySession_RemovesOnlyThatSession()
    {
        var tracker = new LiveKitParticipantTracker();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry));
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@bob:test", 20, 8, LiveKitAccessMode.Subscribe, expiry));

        var removed = tracker.RemoveBySession(7);

        Assert.AreEqual(1, removed.Count);
        Assert.AreEqual("@alice:test", removed[0].MatrixUserId);
        CollectionAssert.AreEquivalent(new[] { "@bob:test" }, tracker.GetSnapshot().Select(r => r.MatrixUserId).ToArray());
    }

    [TestMethod]
    public void RemoveRoomsOtherThan_RemovesOldRoomsAndKeepsCurrentRoom()
    {
        var tracker = new LiveKitParticipantTracker();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Publish, expiry));
        tracker.Upsert(new LiveKitParticipantRecord("channel-2", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry));

        var removed = tracker.RemoveBySessionExceptRoom(7, "channel-2");

        Assert.AreEqual(1, removed.Count);
        Assert.AreEqual("channel-1", removed[0].RoomName);
        Assert.AreEqual("channel-2", tracker.GetSnapshot().Single().RoomName);
    }

    [TestMethod]
    public void PruneExpired_RemovesExpiredRecords()
    {
        var tracker = new LiveKitParticipantTracker();
        var now = DateTimeOffset.UtcNow;
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@old:test", 10, 7, LiveKitAccessMode.Subscribe, now.AddSeconds(-1)));
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@fresh:test", 20, 8, LiveKitAccessMode.Subscribe, now.AddMinutes(5)));

        var removed = tracker.PruneExpired(now);

        Assert.AreEqual(1, removed.Count);
        Assert.AreEqual("@old:test", removed[0].MatrixUserId);
        Assert.AreEqual("@fresh:test", tracker.GetSnapshot().Single().MatrixUserId);
    }

    [TestMethod]
    public void Remove_RemovesByRoomAndIdentity()
    {
        var tracker = new LiveKitParticipantTracker();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry));

        var removed = tracker.Remove("channel-1", "@alice:test");

        Assert.IsNotNull(removed);
        Assert.AreEqual("@alice:test", removed.MatrixUserId);
        Assert.AreEqual(0, tracker.GetSnapshot().Count);
    }

    [TestMethod]
    public void MarkSessionRevoking_MarksOnlyThatSession()
    {
        var tracker = new LiveKitParticipantTracker();

        tracker.MarkSessionRevoking(7);

        Assert.IsTrue(tracker.IsSessionRevoking(7));
        Assert.IsFalse(tracker.IsSessionRevoking(8));
    }

    [TestMethod]
    public void TryUpsert_ReturnsFalseAfterSessionRevoking()
    {
        var tracker = new LiveKitParticipantTracker();
        var record = new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5));

        tracker.MarkSessionRevoking(7);

        Assert.IsFalse(tracker.TryUpsert(record));
        Assert.AreEqual(0, tracker.GetSnapshot().Count);
    }

    [TestMethod]
    public void TryUpsert_AllowsSessionAfterRevokingGraceExpires()
    {
        var tracker = new LiveKitParticipantTracker();
        var now = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
        var record = new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, now.AddMinutes(5));

        tracker.MarkSessionRevoking(7, now);

        Assert.IsTrue(tracker.TryUpsert(record, now.AddMinutes(3)));
        Assert.AreEqual(1, tracker.GetSnapshot().Count);
    }

    [TestMethod]
    public void TryUpsert_ReturnsFalseForStaleRoomAndTrueForCurrentRoom()
    {
        var tracker = new LiveKitParticipantTracker();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);

        tracker.MarkSessionRoom(7, "channel-2");

        Assert.IsFalse(tracker.TryUpsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry)));
        Assert.IsTrue(tracker.TryUpsert(new LiveKitParticipantRecord("channel-2", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry)));
        Assert.AreEqual("channel-2", tracker.GetSnapshot().Single().RoomName);
    }

    [TestMethod]
    public void PruneExpired_RemovesExpiredSessionRoomMarker()
    {
        var tracker = new LiveKitParticipantTracker();
        var now = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
        var record = new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, now.AddMinutes(5));

        tracker.MarkSessionRoom(7, "channel-2", now);
        tracker.PruneExpired(now.AddMinutes(3));

        Assert.IsTrue(tracker.TryUpsert(record, now.AddMinutes(3)));
    }

    [TestMethod]
    public void TryRemoveMatched_DoesNotRemoveReplacementRecord()
    {
        var participants = new ConcurrentDictionary<(string RoomName, string MatrixUserId), LiveKitParticipantRecord>();
        var key = ("channel-1", "@alice:test");
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);
        var matched = new LiveKitParticipantRecord(key.Item1, key.Item2, 10, 7, LiveKitAccessMode.Subscribe, expiry);
        var replacement = new LiveKitParticipantRecord(key.Item1, key.Item2, 10, 8, LiveKitAccessMode.Publish, expiry);
        participants[key] = replacement;

        var removed = LiveKitParticipantTracker.TryRemoveMatched(participants, new KeyValuePair<(string RoomName, string MatrixUserId), LiveKitParticipantRecord>(key, matched));

        Assert.IsFalse(removed);
        Assert.AreEqual(replacement, participants[key]);
    }
}
