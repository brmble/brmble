using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionStoreSnapshotTests
{
    private UserProjectionStore _store = null!;

    [TestInitialize]
    public void Setup()
    {
        _store = new UserProjectionStore();
        _store.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));
        _store.ApplyMumbleUserState(new MumbleUserInput(2, "Bob", 0, false, false, null, null, false));
    }

    private static ServerSnapshot Snapshot(long revision, params (uint Session, ServerMappingEntry Entry)[] entries) =>
        new("inst-a", revision, entries.ToDictionary(e => e.Session, e => e.Entry));

    [TestMethod]
    public void ApplyServerSnapshot_FillsServerFieldsForKnownSessions()
    {
        var change = _store.ApplyServerSnapshot(
            Snapshot(5, (1, new ServerMappingEntry("@alice:test", "retro", true, "cert-a"))));

        Assert.AreEqual("@alice:test", _store.Snapshot()[1].MatrixUserId);
        Assert.AreEqual(1, change.Changed.Count);
    }

    [TestMethod]
    public void ApplyServerSnapshot_ResetsServerFieldsForSessionsItOmits()
    {
        // Session 2 was known to the server, then vanished during an outage. The snapshot is
        // authoritative for membership, so its enrichment goes back to unknown rather than
        // lingering as a confident wrong answer.
        _store.ApplyServerSnapshot(Snapshot(5,
            (1, new ServerMappingEntry("@alice:test", "retro", true, null)),
            (2, new ServerMappingEntry("@bob:test", "bee", true, null))));

        _store.ApplyServerSnapshot(Snapshot(6,
            (1, new ServerMappingEntry("@alice:test", "retro", true, null))));

        var bob = _store.Snapshot()[2];
        Assert.IsNull(bob.MatrixUserId);
        Assert.IsNull(bob.CompanionId);
        Assert.IsNull(bob.IsBrmbleClient);
    }

    [TestMethod]
    public void ApplyServerSnapshot_DoesNotDeleteRowsMumbleStillShows()
    {
        _store.ApplyServerSnapshot(Snapshot(5, (1, new ServerMappingEntry("@alice:test", null, null, null))));

        Assert.IsTrue(_store.Snapshot().ContainsKey(2), "only Mumble may remove a row");
        Assert.AreEqual("Bob", _store.Snapshot()[2].Name);
    }

    [TestMethod]
    public void ApplyServerSnapshot_KeepsMumbleFieldsIntact()
    {
        _store.ApplyServerSnapshot(Snapshot(5, (1, new ServerMappingEntry("@alice:test", null, null, null))));

        Assert.AreEqual("Alice", _store.Snapshot()[1].Name);
    }

    [TestMethod]
    public void ApplyServerSnapshot_ForAnEntryWithNoMumbleRowIsIgnored()
    {
        // The server knows a session Mumble has not shown us. Existence is Mumble's to grant,
        // so nothing is created; the next UserState will pick the enrichment up via the
        // snapshot that follows it.
        _store.ApplyServerSnapshot(Snapshot(5, (99, new ServerMappingEntry("@ghost:test", null, null, null))));

        Assert.IsFalse(_store.Snapshot().ContainsKey(99));
    }

    [TestMethod]
    public void ApplyServerSnapshot_ReportsRowsItResets()
    {
        _store.ApplyServerSnapshot(Snapshot(5,
            (1, new ServerMappingEntry("@alice:test", null, null, null)),
            (2, new ServerMappingEntry("@bob:test", null, null, null))));

        var change = _store.ApplyServerSnapshot(Snapshot(6,
            (1, new ServerMappingEntry("@alice:test", null, null, null))));

        Assert.IsTrue(change.Changed.Any(r => r.SessionId == 2),
            "the reset row must be reported so the UI drops the badge");
    }

    [TestMethod]
    public void ApplyServerSnapshot_FromANewInstanceReplacesEverything()
    {
        _store.ApplyServerSnapshot(Snapshot(90, (1, new ServerMappingEntry("@alice:test", "retro", true, null))));

        _store.ApplyServerSnapshot(new ServerSnapshot("inst-b", 2,
            new Dictionary<uint, ServerMappingEntry>
            {
                [1] = new("@alice:test", "bee", null, null)
            }));

        var alice = _store.Snapshot()[1];
        Assert.AreEqual("bee", alice.CompanionId);
        Assert.IsNull(alice.IsBrmbleClient, "a restart invalidates what the old instance told us");
    }
}
