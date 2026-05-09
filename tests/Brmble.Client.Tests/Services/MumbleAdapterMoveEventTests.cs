using Brmble.Client.Services.Voice;
using MumbleProto;
using MumbleSharp;
using MumbleSharp.Model;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterMoveEventTests
{
    [TestMethod]
    public void CreateChannelChangedPayload_WithActor_ReturnsMoveMetadata()
    {
        var payload = MumbleAdapter.CreateChannelChangedPayload(
            previousChannelId: 5,
            currentChannelId: 7,
            actorSession: 99,
            actorName: "Moderator",
            movedByOtherUser: true);

        Assert.AreEqual(7u, payload.ChannelId);
        Assert.AreEqual(5u, payload.PreviousChannelId);
        Assert.AreEqual(99u, payload.ActorSession);
        Assert.AreEqual("Moderator", payload.ActorName);
        Assert.AreEqual("moved", payload.Reason);
    }

    [TestMethod]
    public void CreateChannelChangedPayload_WithoutActor_ReturnsUnknownReason()
    {
        var payload = MumbleAdapter.CreateChannelChangedPayload(
            previousChannelId: 5,
            currentChannelId: 7,
            actorSession: null,
            actorName: null,
            movedByOtherUser: false);

        Assert.AreEqual(7u, payload.ChannelId);
        Assert.AreEqual(5u, payload.PreviousChannelId);
        Assert.IsNull(payload.ActorSession);
        Assert.IsNull(payload.ActorName);
        Assert.AreEqual("unknown", payload.Reason);
    }

    [TestMethod]
    public void CreateChannelChangedPayload_WithSelfSessionFromServerMove_ReturnsMoveReasonEvenWithoutActor()
    {
        var payload = MumbleAdapter.CreateChannelChangedPayload(
            previousChannelId: 5,
            currentChannelId: 7,
            actorSession: null,
            actorName: null,
            movedByOtherUser: true);

        Assert.AreEqual(7u, payload.ChannelId);
        Assert.AreEqual(5u, payload.PreviousChannelId);
        Assert.IsNull(payload.ActorSession);
        Assert.IsNull(payload.ActorName);
        Assert.AreEqual("moved", payload.Reason);
    }

    [TestMethod]
    public void UserState_ForSelfMoveWithSessionButNoActor_EmitsMovedReason()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        typeof(MumbleConnection)
            .GetProperty(nameof(MumbleConnection.State))!
            .SetValue(connection, ConnectionStates.Connected);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 5, Name = "General", Parent = 0 });
        adapter.ChannelState(new ChannelState { ChannelId = 7, Name = "Gaming", Parent = 0 });
        adapter.UserState(new UserState { Session = 42, Name = "TestUser", ChannelId = 5 });
        adapter.ServerSync(new ServerSync { Session = 42 });
        _ = NativeBridgeTestHarness.DrainMessages(bridge);

        adapter.UserState(new UserState { Session = 42, ChannelId = 7 });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var channelChanged = sent.Single(m => m.Type == "voice.channelChanged");
        using var doc = JsonDocument.Parse(channelChanged.DataJson);
        Assert.AreEqual("moved", doc.RootElement.GetProperty("reason").GetString());
        Assert.AreEqual(5u, doc.RootElement.GetProperty("previousChannelId").GetUInt32());
        Assert.AreEqual(7u, doc.RootElement.GetProperty("channelId").GetUInt32());
    }

    [TestMethod]
    public void UserState_ForLeaveVoiceEcho_KeepsLeftVoiceMuteAndDeafenActive()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        typeof(MumbleConnection)
            .GetProperty(nameof(MumbleConnection.State))!
            .SetValue(connection, ConnectionStates.Connected);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 5, Name = "General", Parent = 0 });
        adapter.UserState(new UserState { Session = 42, Name = "TestUser", ChannelId = 5 });
        adapter.ServerSync(new ServerSync { Session = 42 });
        _ = NativeBridgeTestHarness.DrainMessages(bridge);

        SetField(adapter, "_leftVoice", true);
        SetField(adapter, "_leaveVoiceInProgress", true);
        adapter.LocalUser!.SelfMuted = true;
        adapter.LocalUser!.SelfDeaf = true;
        adapter.UserState(new UserState { Session = 42, ChannelId = 0 });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsTrue(adapter.LocalUser!.SelfMuted);
        Assert.IsTrue(adapter.LocalUser!.SelfDeaf);
        Assert.IsNull(GetField<uint?>(adapter, "_pendingLocalJoinChannelId"));
        Assert.IsFalse(sent.Any(m => m.Type == "voice.leftVoiceChanged" && m.DataJson.Contains("\"leftVoice\":false")));
    }

    [TestMethod]
    public void UserState_ForLocalJoinFromRootWhileLeftVoice_ClearsLeftVoiceMuteAndDeafen()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        typeof(MumbleConnection)
            .GetProperty(nameof(MumbleConnection.State))!
            .SetValue(connection, ConnectionStates.Connected);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 5, Name = "General", Parent = 0 });
        var root = adapter.Channels.Single(c => c.Id == 0);
        var user = new User(adapter, 42) { Name = "TestUser", Channel = root };
        SetBaseField(adapter, "UserDictionary", new ConcurrentDictionary<uint, User>([
            new KeyValuePair<uint, User>(42, user),
        ]));
        SetBaseProperty(adapter, "LocalUser", user);
        SetBaseProperty(adapter, "ReceivedServerSync", true);
        _ = NativeBridgeTestHarness.DrainMessages(bridge);

        SetField(adapter, "_leftVoice", true);
        SetField(adapter, "_leaveVoiceInProgress", false);
        SetField(adapter, "_pendingLocalJoinChannelId", 5u);
        adapter.LocalUser!.SelfMuted = true;
        adapter.LocalUser!.SelfDeaf = true;
        adapter.UserState(new UserState { Session = 42, ChannelId = 5 });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsFalse(adapter.LocalUser!.SelfMuted);
        Assert.IsFalse(adapter.LocalUser!.SelfDeaf);
        Assert.IsTrue(sent.Any(m => m.Type == "voice.leftVoiceChanged" && m.DataJson.Contains("\"leftVoice\":false")));
        Assert.IsTrue(sent.Any(m => m.Type == "voice.selfMuteChanged" && m.DataJson.Contains("\"muted\":false")));
        Assert.IsTrue(sent.Any(m => m.Type == "voice.selfDeafChanged" && m.DataJson.Contains("\"deafened\":false")));
    }

    private static void SetField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);

    private static T? GetField<T>(object instance, string name)
        => (T?)instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance);

    private static void SetBaseField(object instance, string name, object? value)
        => instance.GetType().BaseType!.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);

    private static void SetBaseProperty(object instance, string name, object? value)
        => instance.GetType().BaseType!.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!.SetValue(instance, value);
}
