using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleProto;
using MumbleSharp;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// The Brmble flag and the companion both live in the adapter's session mapping cache, and
/// every later user state re-asserts them to the UI from that cache. An event the cache
/// cannot absorb is therefore not merely missed once, it is actively contradicted later.
/// </summary>
[TestClass]
public class MumbleAdapterBrmbleFlagTests
{
    [TestMethod]
    public void UserState_AfterActivationForAnUnmappedSession_StillReportsNotBrmble()
    {
        // A client that learns a session is a Brmble client before it learns the session's
        // mapping has nowhere to record the flag. The next user state for that session --
        // a mute toggle, a channel move, a comment reply -- then tells the UI the opposite.
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(
            new IPEndPoint(IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 1, Name = "General", Parent = 0 });

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(
            adapter, """{"type":"brmbleClientActivated","sessionId":42}""");
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

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(
            adapter,
            """{"type":"userMappingAdded","sessionId":42,"matrixUserId":"@broan:x","mumbleName":"Broan","companionId":"cat","certHash":"h","isBrmbleClient":true}""");
        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(
            adapter,
            """{"type":"userMappingAdded","sessionId":42,"matrixUserId":"@broan:x","mumbleName":"Broan","certHash":"h","isBrmbleClient":true}""");

        var mappings = MumbleAdapterTestHarness
            .GetField<ConcurrentDictionary<uint, MumbleAdapter.SessionMappingEntry>>(adapter, "_sessionMappings");

        Assert.AreEqual("cat", mappings[42].CompanionId);
    }
}
