using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionStoreEventTests
{
    private UserProjectionStore _store = null!;

    [TestInitialize]
    public void Setup()
    {
        _store = new UserProjectionStore();
        _store.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst-a", 10,
            new Dictionary<uint, ServerMappingEntry>
            {
                [1] = new("@alice:test", "retro", true, "cert-a")
            }));
    }

    private static ServerEvent Companion(long baseRevision, long revision, string? companionId) =>
        new(ServerEventKind.CompanionChanged, "inst-a", baseRevision, revision, 1,
            new ServerMappingEntry(null, companionId, null, null));

    [TestMethod]
    public void ApplyServerEvent_AppliesWhenBaseRevisionMatchesTheCursor()
    {
        var change = _store.ApplyServerEvent(Companion(10, 13, "bee"));

        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
        Assert.AreEqual(1, change.Changed.Count);
        Assert.IsFalse(change.NeedsSnapshot);
    }

    [TestMethod]
    public void ApplyServerEvent_AcceptsAMultiBumpRange()
    {
        // One server operation can bump the counter several times; the client must not read
        // that as a gap.
        var change = _store.ApplyServerEvent(Companion(10, 40, "bee"));

        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
        Assert.IsFalse(change.NeedsSnapshot);
    }

    [TestMethod]
    public void ApplyServerEvent_IgnoresAnAlreadyAppliedEvent()
    {
        _store.ApplyServerEvent(Companion(10, 13, "bee"));

        var change = _store.ApplyServerEvent(Companion(10, 13, "bee"));

        Assert.IsTrue(change.IsEmpty, "a duplicate must not re-emit");
        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
    }

    [TestMethod]
    public void ApplyServerEvent_IgnoresAReorderedOlderEvent()
    {
        _store.ApplyServerEvent(Companion(10, 20, "bee"));

        var change = _store.ApplyServerEvent(Companion(12, 15, "stale"));

        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
        Assert.IsTrue(change.IsEmpty);
    }

    [TestMethod]
    public void ApplyServerEvent_RequestsASnapshotOnAGapAndChangesNothing()
    {
        var change = _store.ApplyServerEvent(Companion(30, 33, "bee"));

        Assert.IsTrue(change.NeedsSnapshot);
        Assert.AreEqual(0, change.Changed.Count);
        Assert.AreEqual("retro", _store.Snapshot()[1].CompanionId, "a gap must apply nothing");
    }

    [TestMethod]
    public void ApplyServerEvent_RequestsASnapshotWhenTheInstanceChanged()
    {
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.CompanionChanged, "inst-b", 0, 1, 1,
                new ServerMappingEntry(null, "bee", null, null)));

        Assert.IsTrue(change.NeedsSnapshot);
        Assert.AreEqual("retro", _store.Snapshot()[1].CompanionId);
    }

    [TestMethod]
    public void ApplyServerEvent_BeforeAnySnapshotRequestsOne()
    {
        var fresh = new UserProjectionStore();
        fresh.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));

        var change = fresh.ApplyServerEvent(Companion(0, 1, "bee"));

        Assert.IsTrue(change.NeedsSnapshot, "without a cursor there is nothing to sequence against");
    }

    [TestMethod]
    public void ApplyServerEvent_NullFieldsLeaveKnownValuesAlone()
    {
        // The rule that makes a lost field harmless: unknown never overwrites known.
        var change = _store.ApplyServerEvent(Companion(10, 11, null));

        Assert.AreEqual("retro", _store.Snapshot()[1].CompanionId);
        Assert.IsTrue(change.IsEmpty);
    }

    [TestMethod]
    public void ApplyServerEvent_BrmbleDeactivatedIsKnowledgeAndClearsTheBadge()
    {
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.BrmbleDeactivated, "inst-a", 10, 11, 1));

        Assert.AreEqual(false, _store.Snapshot()[1].IsBrmbleClient);
        Assert.AreEqual(1, change.Changed.Count);
    }

    [TestMethod]
    public void ApplyServerEvent_BrmbleActivatedSetsTheBadge()
    {
        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleDeactivated, "inst-a", 10, 11, 1));

        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleActivated, "inst-a", 11, 12, 1));

        Assert.AreEqual(true, _store.Snapshot()[1].IsBrmbleClient);
    }

    [TestMethod]
    public void ApplyServerEvent_MappingRemovedClearsServerFieldsButKeepsTheRow()
    {
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.MappingRemoved, "inst-a", 10, 11, 1));

        Assert.IsTrue(_store.Snapshot().ContainsKey(1), "only Mumble removes rows");
        Assert.IsNull(_store.Snapshot()[1].MatrixUserId);
        Assert.IsNull(_store.Snapshot()[1].IsBrmbleClient);
        Assert.AreEqual(0, change.Removed.Count);
    }

    [TestMethod]
    public void ApplyServerEvent_ForASessionMumbleHasNotShownIsHeldAndAdvancesTheCursor()
    {
        // The row does not exist yet, so there is nothing to enrich — the entry is held for
        // when it appears. The cursor still advances, because the event was observed, and
        // treating it as a gap would resync on every unrelated user's join.
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.CompanionChanged, "inst-a", 10, 11, 77,
                new ServerMappingEntry(null, "bee", null, null)));

        Assert.IsFalse(change.NeedsSnapshot);
        Assert.IsFalse(_store.Snapshot().ContainsKey(77));

        var next = _store.ApplyServerEvent(Companion(11, 12, "pip"));
        Assert.AreEqual("pip", _store.Snapshot()[1].CompanionId);
        Assert.IsFalse(next.NeedsSnapshot);
    }
}
