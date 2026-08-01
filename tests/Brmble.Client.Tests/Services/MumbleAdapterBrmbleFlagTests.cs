using System.Net;
using System.Text.Json;
using Brmble.Client.Services.Voice;
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleProto;
using MumbleSharp;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// The Brmble flag and the companion are server-owned fields of the user projection, and every
/// later user state re-emits the whole row. An event the projection cannot absorb is therefore
/// not merely missed once, it is actively contradicted later.
/// </summary>
/// <remarks>
/// Each test opens with a snapshot because an incremental event with no cursor to sequence
/// against is discarded by design — the store asks for a snapshot instead of guessing.
/// </remarks>
[TestClass]
public class MumbleAdapterBrmbleFlagTests
{
    private const string EmptySnapshot =
        """{"type":"sessionMappingSnapshot","instanceId":"i","revision":1,"mappings":{}}""";

    [TestMethod]
    public void UserState_AfterActivationForAnUnmappedSession_StillReportsBrmble()
    {
        // A client that learns a session is a Brmble client before it learns the session's
        // mapping must hold the flag. Otherwise the next user state for that session --
        // a mute toggle, a channel move, a comment reply -- tells the UI the opposite.
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(
            new IPEndPoint(IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 1, Name = "General", Parent = 0 });

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(adapter, EmptySnapshot);
        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(
            adapter,
            """{"type":"brmbleClientActivated","instanceId":"i","baseRevision":1,"revision":2,"sessionId":42}""");
        adapter.UserState(new UserState { Session = 42, Name = "Broan", ChannelId = 1 });

        var joined = NativeBridgeTestHarness.DrainMessages(bridge)
            .Where(m => m.Type == "voice.userJoined")
            .Select(m => JsonDocument.Parse(m.DataJson).RootElement)
            .Last(e => e.GetProperty("session").GetUInt32() == 42);

        Assert.IsTrue(
            joined.GetProperty("isBrmbleClient").GetBoolean(),
            "the activation was dropped, so this user state reverts the badge to a plain Mumble user");
    }

    [TestMethod]
    public void UserMappingAdded_WithoutACompanion_KeepsTheKnownCompanion()
    {
        // The announcement the server broadcasts when a Brmble client opens its WebSocket
        // carries no companion. It must not be read as "this user has no companion", because
        // it is sent for a session the other clients already have a full mapping for.
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(
            new IPEndPoint(IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.UserState(new UserState { Session = 42, Name = "Broan", ChannelId = 0 });

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(adapter, EmptySnapshot);
        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(
            adapter,
            """{"type":"userMappingAdded","instanceId":"i","baseRevision":1,"revision":2,"sessionId":42,"matrixUserId":"@broan:x","mumbleName":"Broan","companionId":"cat","certHash":"h","isBrmbleClient":true}""");
        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(
            adapter,
            """{"type":"userMappingAdded","instanceId":"i","baseRevision":2,"revision":3,"sessionId":42,"matrixUserId":"@broan:x","mumbleName":"Broan","certHash":"h","isBrmbleClient":true}""");

        var projection = MumbleAdapterTestHarness
            .GetField<UserProjectionStore>(adapter, "_projection");

        Assert.AreEqual("cat", projection.Snapshot()[42].CompanionId);
    }
}
