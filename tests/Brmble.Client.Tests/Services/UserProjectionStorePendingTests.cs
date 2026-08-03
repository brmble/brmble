using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// Server data can arrive before Mumble has announced the session it describes — most
/// importantly on voice connect, where <c>/auth/token</c> returns a full snapshot that can beat
/// Mumble's <c>UserState</c> batch. Dropping it there would blank every badge and companion on
/// every connect, with nothing to re-deliver them.
/// </summary>
[TestClass]
public class UserProjectionStorePendingTests
{
    private UserProjectionStore _store = null!;

    [TestInitialize]
    public void Setup() => _store = new UserProjectionStore();

    private static MumbleUserInput User(uint session, string name = "Alice") =>
        new(session, name, 0, false, false, null, null, false);

    private static ServerSnapshot Snapshot(long revision, params (uint Session, ServerMappingEntry Entry)[] entries) =>
        new("inst-a", revision, entries.ToDictionary(e => e.Session, e => e.Entry));

    [TestMethod]
    public void ApplyServerEvent_ForAnUnknownSessionIsHeldUntilMumbleAnnouncesIt()
    {
        _store.ApplyServerSnapshot(Snapshot(10));

        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.CompanionChanged, "inst-a", 10, 11, 77,
            new ServerMappingEntry(null, "bee", null, null)));

        var change = _store.ApplyMumbleUserState(User(77, "Carol"));

        Assert.AreEqual("bee", _store.Snapshot()[77].CompanionId);
        Assert.AreEqual("bee", change.Changed.Single().CompanionId,
            "the held enrichment must be reported, or the UI never learns about it");
    }

    [TestMethod]
    public void ApplyServerEvent_BrmbleActivatedForAnUnknownSessionIsHeld()
    {
        _store.ApplyServerSnapshot(Snapshot(10));

        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleActivated, "inst-a", 10, 11, 77));
        _store.ApplyMumbleUserState(User(77));

        Assert.AreEqual(true, _store.Snapshot()[77].IsBrmbleClient);
    }

    [TestMethod]
    public void ApplyServerSnapshot_ArrivingBeforeAnyMumbleRowEnrichesTheSubsequentReset()
    {
        // The real connect ordering: /auth/token resolves before the UserState batch lands.
        _store.ApplyServerSnapshot(Snapshot(10,
            (1, new ServerMappingEntry("@alice:test", "retro", true, "cert-a")),
            (2, new ServerMappingEntry("@bob:test", "bee", true, null))));

        _store.ApplyMumbleReset([User(1, "Alice"), User(2, "Bob")]);

        var rows = _store.Snapshot();
        Assert.AreEqual("@alice:test", rows[1].MatrixUserId);
        Assert.AreEqual("retro", rows[1].CompanionId);
        Assert.AreEqual(true, rows[1].IsBrmbleClient);
        Assert.AreEqual("@bob:test", rows[2].MatrixUserId);
        Assert.AreEqual("bee", rows[2].CompanionId);
    }

    [TestMethod]
    public void ApplyServerSnapshot_ArrivingBeforeAnyMumbleRowEnrichesASingleUserState()
    {
        _store.ApplyServerSnapshot(Snapshot(10,
            (1, new ServerMappingEntry("@alice:test", "retro", true, "cert-a"))));

        var change = _store.ApplyMumbleUserState(User(1));

        Assert.AreEqual("@alice:test", change.Changed.Single().MatrixUserId);
        Assert.AreEqual("cert-a", _store.Snapshot()[1].CertHash);
    }

    [TestMethod]
    public void ApplyServerSnapshot_DiscardsAHeldEntryItOmits()
    {
        _store.ApplyServerSnapshot(Snapshot(10,
            (1, new ServerMappingEntry("@alice:test", "retro", true, null))));

        // Session 1 vanished from the server before Mumble ever announced it.
        _store.ApplyServerSnapshot(Snapshot(11));
        _store.ApplyMumbleUserState(User(1));

        Assert.IsNull(_store.Snapshot()[1].MatrixUserId,
            "a superseded held entry must not resurrect stale identity");
        Assert.IsNull(_store.Snapshot()[1].CompanionId);
    }

    [TestMethod]
    public void ApplyServerEvent_MappingRemovedDiscardsAHeldEntry()
    {
        _store.ApplyServerSnapshot(Snapshot(10,
            (77, new ServerMappingEntry("@carol:test", "bee", true, null))));

        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.MappingRemoved, "inst-a", 10, 11, 77));
        _store.ApplyMumbleUserState(User(77));

        Assert.IsNull(_store.Snapshot()[77].MatrixUserId);
        Assert.IsNull(_store.Snapshot()[77].IsBrmbleClient);
    }

    [TestMethod]
    public void HeldEntries_AreConsumedOnceAndNotReappliedAfterAMumbleRemove()
    {
        _store.ApplyServerSnapshot(Snapshot(10,
            (1, new ServerMappingEntry("@alice:test", "retro", true, null))));

        _store.ApplyMumbleUserState(User(1));
        _store.ApplyMumbleUserRemove(1);
        _store.ApplyMumbleUserState(User(1));

        Assert.IsNull(_store.Snapshot()[1].MatrixUserId,
            "the entry was consumed; a rejoining session must be re-enriched by the server, not by a stale hold");
    }

    [TestMethod]
    public void HeldEntries_MergeUnderTheNullMeansUnknownRule()
    {
        _store.ApplyServerSnapshot(Snapshot(10));

        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.CompanionChanged, "inst-a", 10, 11, 77,
            new ServerMappingEntry("@carol:test", "bee", null, null)));
        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleActivated, "inst-a", 11, 12, 77));

        _store.ApplyMumbleUserState(User(77));

        var row = _store.Snapshot()[77];
        Assert.AreEqual("@carol:test", row.MatrixUserId, "a later partial event must not blank an earlier field");
        Assert.AreEqual("bee", row.CompanionId);
        Assert.AreEqual(true, row.IsBrmbleClient);
    }

    [TestMethod]
    public void HeldEntries_AreBoundedAndEvictTheOldestFirst()
    {
        // The map is fed by a remote server, so it must not be allowed to grow without limit.
        _store.ApplyServerSnapshot(Snapshot(0));

        var overflow = UserProjectionStore.MaxPendingEntries + 1;
        for (var i = 0; i < overflow; i++)
        {
            _store.ApplyServerEvent(new ServerEvent(ServerEventKind.CompanionChanged, "inst-a", i, i + 1,
                (uint)(1000 + i), new ServerMappingEntry(null, $"c{i}", null, null)));
        }

        // The first session inserted was evicted to make room for the last.
        _store.ApplyMumbleUserState(User(1000));
        Assert.IsNull(_store.Snapshot()[1000].CompanionId, "the oldest held entry should have been evicted");

        _store.ApplyMumbleUserState(User((uint)(1000 + overflow - 1)));
        Assert.AreEqual($"c{overflow - 1}", _store.Snapshot()[(uint)(1000 + overflow - 1)].CompanionId,
            "the newest held entry must survive");
    }

    [TestMethod]
    public void ApplyServerSnapshot_DoesNotHoldEntriesForSessionsItAlreadyApplied()
    {
        _store.ApplyMumbleUserState(User(1));
        _store.ApplyServerSnapshot(Snapshot(10,
            (1, new ServerMappingEntry("@alice:test", "retro", true, null))));

        // Session 1 leaves and rejoins with no server statement in between.
        _store.ApplyMumbleUserRemove(1);
        _store.ApplyMumbleUserState(User(1));

        Assert.IsNull(_store.Snapshot()[1].MatrixUserId,
            "an entry applied to a live row must not also be held for later");
    }
}
