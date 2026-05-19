using System.Reflection;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Voice;
using MumbleProto;
using MumbleSharp.Model;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterBridgeTests
{
    [TestMethod]
    public void HandleWebSocketMessage_CompanionChanged_EmitsBridgeEvent()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);

        InvokePrivate(adapter, "HandleWebSocketMessage", """
        {"type":"companionChanged","sessionId":42,"matrixUserId":"@alice:test","companionId":"retro"}
        """);

        AssertBridgeSent(bridge, "voice.companionChanged");
    }

    [TestMethod]
    public void SendVoiceConnected_IncludesChannelEnterRestrictionState()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        var channels = GetChannelDictionary(adapter);
        channels[4] = new Channel(adapter, 4, "Secret", 0) { IsEnterRestricted = true, CanEnter = false };

        InvokePrivate(adapter, "SendVoiceConnected");

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var connected = sent.Single(m => m.Type == "voice.connected");
        using var doc = JsonDocument.Parse(connected.DataJson);
        var channel = doc.RootElement.GetProperty("channels").EnumerateArray().Single();

        Assert.AreEqual(4u, channel.GetProperty("id").GetUInt32());
        Assert.IsTrue(channel.GetProperty("isEnterRestricted").GetBoolean());
        Assert.IsFalse(channel.GetProperty("canEnter").GetBoolean());
        Assert.IsFalse(channel.GetProperty("hasPasswordRestriction").GetBoolean());
    }

    [TestMethod]
    public void SendVoiceConnected_DoesNotExposeManagedPasswordPlaintext()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        var channels = GetChannelDictionary(adapter);
        channels[4] = new Channel(adapter, 4, "Locked", 0)
        {
            IsEnterRestricted = true,
            CanEnter = false,
        };
        SetPrivateField(adapter, "_channelPasswordRestrictions", new System.Collections.Concurrent.ConcurrentDictionary<uint, bool>(
            new[] { new KeyValuePair<uint, bool>(4, true) }));

        InvokePrivate(adapter, "SendVoiceConnected");

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var connected = sent.Single(m => m.Type == "voice.connected");
        using var doc = JsonDocument.Parse(connected.DataJson);
        var channel = doc.RootElement.GetProperty("channels").EnumerateArray().Single();

        Assert.IsTrue(channel.GetProperty("hasPasswordRestriction").GetBoolean());
        Assert.IsFalse(connected.DataJson.Contains("secret", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public void ChannelState_IncludesCanEnterInBridgePayload()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);

        adapter.ChannelState(new ChannelState
        {
            ChannelId = 4,
            Name = "Secret",
            Parent = 0,
            IsEnterRestricted = true,
            CanEnter = true
        });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var channelJoined = sent.Single(m => m.Type == "voice.channelJoined");
        using var doc = JsonDocument.Parse(channelJoined.DataJson);
        var channel = doc.RootElement;

        Assert.AreEqual(4u, channel.GetProperty("id").GetUInt32());
        Assert.IsTrue(channel.GetProperty("isEnterRestricted").GetBoolean());
        Assert.IsTrue(channel.GetProperty("canEnter").GetBoolean());
        Assert.IsFalse(channel.GetProperty("hasPasswordRestriction").GetBoolean());
    }

    [TestMethod]
    public void HandleWebSocketMessage_AclChangedManagedPasswordMarker_UpdatesChannelPayloadWithoutToken()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        var channels = GetChannelDictionary(adapter);
        channels[4] = new Channel(adapter, 4, "Locked", 0)
        {
            IsEnterRestricted = true,
            CanEnter = false,
        };

        InvokePrivate(adapter, "HandleWebSocketMessage", """
        {"type":"acl.changed","channelId":4,"snapshot":{"acls":[{"group":"__brmble_password_marker__:#secret-token"}]}}
        """);

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var channelJoined = sent.Single(m => m.Type == "voice.channelJoined");
        using var doc = JsonDocument.Parse(channelJoined.DataJson);
        var channel = doc.RootElement;

        Assert.IsTrue(channel.GetProperty("hasPasswordRestriction").GetBoolean());
        Assert.IsFalse(channelJoined.DataJson.Contains("secret-token", StringComparison.Ordinal));
    }

    [TestMethod]
    public void Disconnect_ClearsChannelPasswordRestrictionCache()
    {
        var adapter = CreateAdapterWithBridge(out _);
        var restrictions = GetChannelPasswordRestrictionDictionary(adapter);
        restrictions[4] = true;

        adapter.Disconnect();

        Assert.AreEqual(0, restrictions.Count);
    }

    private static MumbleAdapter CreateAdapterWithBridge(out NativeBridge bridge)
    {
        bridge = NativeBridgeTestHarness.Create();
        return MumbleAdapterTestHarness.CreateWithBridge(bridge);
    }

    private static void InvokePrivate(object instance, string methodName, string json)
    {
        var method = instance.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
        method!.Invoke(instance, [json]);
    }

    private static void InvokePrivate(object instance, string methodName)
    {
        var method = instance.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
        method!.Invoke(instance, [null]);
    }

    private static void SetPrivateField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);

    private static System.Collections.Concurrent.ConcurrentDictionary<uint, Channel> GetChannelDictionary(MumbleAdapter adapter)
        => (System.Collections.Concurrent.ConcurrentDictionary<uint, Channel>)adapter
            .GetType()
            .BaseType!
            .GetField("ChannelDictionary", BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(adapter)!;

    private static System.Collections.Concurrent.ConcurrentDictionary<uint, bool> GetChannelPasswordRestrictionDictionary(MumbleAdapter adapter)
        => (System.Collections.Concurrent.ConcurrentDictionary<uint, bool>)adapter
            .GetType()
            .GetField("_channelPasswordRestrictions", BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(adapter)!;

    private static void AssertBridgeSent(NativeBridge bridge, string expectedType)
    {
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsTrue(sent.Any(m => m.Type == expectedType), $"Expected bridge message '{expectedType}' to be sent.");
    }
}
