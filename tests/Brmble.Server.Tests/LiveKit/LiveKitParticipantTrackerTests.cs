using Brmble.Server.LiveKit;
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

        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, firstExpiry));
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Publish, secondExpiry));

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
}
