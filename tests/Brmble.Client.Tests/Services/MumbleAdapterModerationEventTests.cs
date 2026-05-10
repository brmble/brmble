using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleProto;
using MumbleSharp;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterModerationEventTests
{
    [TestMethod]
    public void UserRemove_ForOtherUserKick_EmitsModerationEvent()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);

        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 1, Name = "General", Parent = 0 });
        adapter.UserState(new UserState { Session = 7, Name = "Victim", ChannelId = 1 });
        adapter.UserState(new UserState { Session = 8, Name = "Moderator", ChannelId = 1 });
        adapter.ServerSync(new ServerSync { Session = 8 });

        _ = NativeBridgeTestHarness.DrainMessages(bridge);

        adapter.UserRemove(new UserRemove { Session = 7, Actor = 8, Reason = "Too loud", Ban = false });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge).FindAll(m => m.Type == "voice.moderation");
        Assert.AreEqual(1, sent.Count);
        StringAssert.Contains(sent[0].DataJson, "\"kind\":\"user-kicked\"");
        StringAssert.Contains(sent[0].DataJson, "\"name\":\"Victim\"");
        StringAssert.Contains(sent[0].DataJson, "\"actorName\":\"Moderator\"");
    }

    [TestMethod]
    public void UserRemove_ForOtherUserBan_EmitsModerationEvent()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);

        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 1, Name = "General", Parent = 0 });
        adapter.UserState(new UserState { Session = 7, Name = "Victim", ChannelId = 1 });
        adapter.UserState(new UserState { Session = 8, Name = "Admin", ChannelId = 1 });
        adapter.ServerSync(new ServerSync { Session = 8 });

        _ = NativeBridgeTestHarness.DrainMessages(bridge);

        adapter.UserRemove(new UserRemove { Session = 7, Actor = 8, Reason = "Spam", Ban = true });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge).FindAll(m => m.Type == "voice.moderation");
        Assert.AreEqual(1, sent.Count);
        StringAssert.Contains(sent[0].DataJson, "\"kind\":\"user-banned\"");
        StringAssert.Contains(sent[0].DataJson, "\"name\":\"Victim\"");
        StringAssert.Contains(sent[0].DataJson, "\"actorName\":\"Admin\"");
    }
}
