using Brmble.Client.Services.Voice;
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// The ordering guarantees MumbleAdapter relies on when it drives the store from three threads.
/// </summary>
[TestClass]
public class MumbleAdapterProjectionTests
{
    [TestMethod]
    public void AuthTokenSnapshotBeforeUserStateStillEnrichesTheRow()
    {
        // The real connect ordering: ServerSync -> FetchAndSendCredentials -> SendVoiceConnected.
        var store = new UserProjectionStore();
        var snapshot = ProjectionWire.ReadSnapshot(System.Text.Json.JsonDocument.Parse("""
        { "instanceId": "inst-a", "revision": 3,
          "mappings": { "1": { "matrixUserId": "@alice:test", "companionId": "retro",
                               "isBrmbleClient": true } } }
        """).RootElement);

        store.ApplyServerSnapshot(snapshot!);
        var change = store.ApplyMumbleReset([new MumbleUserInput(1, "Alice", 0, false, false, null, null, true)]);

        var row = change.Changed.Single();
        Assert.AreEqual("@alice:test", row.MatrixUserId);
        Assert.AreEqual("retro", row.CompanionId);
        Assert.AreEqual(true, row.IsBrmbleClient);
    }

    [TestMethod]
    public void AChannelMoveDoesNotDisturbIdentity()
    {
        var store = new UserProjectionStore();
        store.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));
        store.ApplyServerSnapshot(new ServerSnapshot("i", 1,
            new Dictionary<uint, ServerMappingEntry> { [1] = new("@a:t", "retro", true, null) }));

        var change = store.ApplyMumbleUserState(
            new MumbleUserInput(1, "Alice", 9, false, false, null, null, false));

        Assert.AreEqual(9u, change.Changed.Single().ChannelId);
        Assert.AreEqual(true, change.Changed.Single().IsBrmbleClient);
    }
}
