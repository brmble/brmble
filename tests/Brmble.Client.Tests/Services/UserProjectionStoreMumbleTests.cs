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
}
