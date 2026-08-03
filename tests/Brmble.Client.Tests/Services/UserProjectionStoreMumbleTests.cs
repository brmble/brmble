using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionStoreMumbleTests
{
    private UserProjectionStore _store = null!;

    [TestInitialize]
    public void Setup() => _store = new UserProjectionStore();

    private static MumbleUserInput User(uint session, string name = "Alice", uint channel = 0) =>
        new(session, name, channel, false, false, null, null, false);

    [TestMethod]
    public void ApplyMumbleUserState_AddsARowAndReportsIt()
    {
        var change = _store.ApplyMumbleUserState(User(1));

        Assert.AreEqual(1, change.Changed.Count);
        Assert.AreEqual(1u, change.Changed[0].SessionId);
        Assert.AreEqual("Alice", change.Changed[0].Name);
        Assert.AreEqual(1, _store.Snapshot().Count);
    }

    [TestMethod]
    public void ApplyMumbleUserState_IsIdempotentForAnUnchangedState()
    {
        _store.ApplyMumbleUserState(User(1));

        var change = _store.ApplyMumbleUserState(User(1));

        Assert.IsTrue(change.IsEmpty, "an identical UserState must not churn the UI");
    }

    [TestMethod]
    public void ApplyMumbleUserState_UpdatesMumbleFieldsWithoutTouchingServerFields()
    {
        _store.ApplyMumbleUserState(User(1));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [1] = new("@alice:test", "retro", true, "cert-server")
        }));

        var change = _store.ApplyMumbleUserState(User(1, "Alice", channel: 7));

        var row = change.Changed.Single();
        Assert.AreEqual(7u, row.ChannelId);
        Assert.AreEqual("@alice:test", row.MatrixUserId, "a Mumble input must not clear identity");
        Assert.AreEqual("retro", row.CompanionId);
        Assert.AreEqual(true, row.IsBrmbleClient);
    }

    [TestMethod]
    public void ApplyMumbleUserRemove_DeletesTheRowEntirely()
    {
        _store.ApplyMumbleUserState(User(1));

        var change = _store.ApplyMumbleUserRemove(1);

        CollectionAssert.AreEqual(new[] { 1u }, change.Removed.ToArray());
        Assert.AreEqual(0, _store.Snapshot().Count);
    }

    [TestMethod]
    public void ApplyMumbleUserRemove_IsSilentForAnUnknownSession()
    {
        Assert.IsTrue(_store.ApplyMumbleUserRemove(99).IsEmpty);
    }

    [TestMethod]
    public void ApplyMumbleReset_ReplacesMembershipAndFlagsAReset()
    {
        _store.ApplyMumbleUserState(User(1));
        _store.ApplyMumbleUserState(User(2, "Bob"));

        var change = _store.ApplyMumbleReset([User(2, "Bob"), User(3, "Carol")]);

        Assert.IsTrue(change.IsReset);
        CollectionAssert.AreEquivalent(new[] { 2u, 3u }, _store.Snapshot().Keys.ToArray());
    }

    [TestMethod]
    public void ApplyMumbleReset_KeepsServerFieldsForSessionsThatSurvive()
    {
        // A voice reconnect must not cost us identity we already know.
        _store.ApplyMumbleUserState(User(1));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [1] = new("@alice:test", "retro", true, null)
        }));

        _store.ApplyMumbleReset([User(1)]);

        Assert.AreEqual("@alice:test", _store.Snapshot()[1].MatrixUserId);
    }

    private static MumbleUserInput UserWithCert(uint session, string name, string? certHash) =>
        new(session, name, 0, false, false, null, certHash, false);

    [TestMethod]
    public void ApplyMumbleReset_DropsServerFieldsWhenTheCertificateOnASessionChanged()
    {
        // Mumble recycles session ids. If the client misses Alice's UserRemove while
        // disconnected and session 7 has been reassigned to Bob by the time it reconnects,
        // carrying the row across by session id alone would show Bob as Alice — the exact
        // "confidently wrong value" this design exists to remove.
        _store.ApplyMumbleUserState(UserWithCert(7, "Alice", "cert-alice"));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [7] = new("@alice:test", "retro", true, "cert-alice")
        }));

        _store.ApplyMumbleReset([UserWithCert(7, "Bob", "cert-bob")]);

        var row = _store.Snapshot()[7];
        Assert.AreEqual("Bob", row.Name);
        Assert.IsNull(row.MatrixUserId, "Bob must not inherit Alice's identity");
        Assert.IsNull(row.CompanionId);
        Assert.IsNull(row.IsBrmbleClient);
        Assert.AreEqual("cert-bob", row.CertHash, "and must not inherit her certificate either");
    }

    [TestMethod]
    public void ApplyMumbleReset_DropsServerFieldsWhenTheNameOnASessionChangedAndThereIsNoCert()
    {
        // Without certificates the name is the only continuity signal available. Mumble keeps
        // names unique among connected users, so a changed name on a recycled id is a changed
        // occupant.
        _store.ApplyMumbleUserState(User(7, "Alice"));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [7] = new("@alice:test", "retro", true, null)
        }));

        _store.ApplyMumbleReset([User(7, "Bob")]);

        Assert.IsNull(_store.Snapshot()[7].MatrixUserId);
    }

    [TestMethod]
    public void ApplyMumbleReset_KeepsServerFieldsWhenTheCertificateMatchesAcrossARename()
    {
        // A certificate identifies a person independently of the session id, so it settles
        // continuity outright — including across a legitimate rename, where the name check
        // alone would wrongly discard identity we still know to be correct.
        _store.ApplyMumbleUserState(UserWithCert(7, "Alice", "cert-alice"));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [7] = new("@alice:test", "retro", true, "cert-alice")
        }));

        _store.ApplyMumbleReset([UserWithCert(7, "Alice In Chains", "cert-alice")]);

        Assert.AreEqual("@alice:test", _store.Snapshot()[7].MatrixUserId);
        Assert.AreEqual("retro", _store.Snapshot()[7].CompanionId);
    }

    [TestMethod]
    public void ApplyMumbleReset_ANewOccupantIsEnrichedByTheSnapshotThatFollows()
    {
        // Dropping the previous occupant's identity leaves the row unknown, not wrong, and the
        // snapshot that follows a reconnect fills it in correctly. Unknown-then-correct is the
        // trade this design makes against confidently-wrong every time.
        _store.ApplyMumbleUserState(UserWithCert(7, "Alice", "cert-alice"));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [7] = new("@alice:test", "retro", true, "cert-alice")
        }));

        _store.ApplyMumbleReset([UserWithCert(7, "Bob", "cert-bob")]);
        Assert.IsNull(_store.Snapshot()[7].MatrixUserId, "Alice's identity must not survive");

        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 6, new Dictionary<uint, ServerMappingEntry>
        {
            [7] = new("@bob:test", "bee", true, "cert-bob")
        }));

        Assert.AreEqual("@bob:test", _store.Snapshot()[7].MatrixUserId);
        Assert.AreEqual("bee", _store.Snapshot()[7].CompanionId);
    }
}

