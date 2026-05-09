using Brmble.Client.Services.Voice;
using MumbleProto;
using MumbleSharp;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterRemovalEventTests
{
    [TestMethod]
    public void CreateServerRemovalPayload_ForKick_ReturnsWarningMetadata()
    {
        var payload = MumbleAdapter.CreateServerRemovalPayload(
            banned: false,
            actorName: "Moderator",
            reason: "Too loud");

        Assert.AreEqual("kicked", payload.Reason);
        Assert.AreEqual("Moderator", payload.ActorName);
        Assert.AreEqual("Too loud", payload.Message);
        Assert.IsTrue(payload.ReconnectAvailable);
    }

    [TestMethod]
    public void CreateServerRemovalPayload_ForBan_ReturnsBanMetadata()
    {
        var payload = MumbleAdapter.CreateServerRemovalPayload(
            banned: true,
            actorName: "Admin",
            reason: "Spam");

        Assert.AreEqual("banned", payload.Reason);
        Assert.AreEqual("Admin", payload.ActorName);
        Assert.AreEqual("Spam", payload.Message);
        Assert.IsTrue(payload.ReconnectAvailable);
    }

    [TestMethod]
    public void UserRemove_ForSelfKick_ClosesConnectionAndSuppressesGenericDisconnect()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        typeof(MumbleConnection)
            .GetProperty(nameof(MumbleConnection.State))!
            .SetValue(connection, ConnectionStates.Connected);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 1, Name = "General", Parent = 0 });
        adapter.UserState(new UserState { Session = 7, Name = "TestUser", ChannelId = 1 });
        adapter.UserState(new UserState { Session = 8, Name = "Moderator", ChannelId = 1 });
        adapter.ServerSync(new ServerSync { Session = 7 });

        adapter.UserRemove(new UserRemove { Session = 7, Actor = 8, Reason = "Too loud" });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge).FindAll(m => m.Type == "voice.disconnected");
        Assert.AreEqual(ConnectionStates.Disconnected, connection.State);
        Assert.IsNull(adapter.LocalUser);
        Assert.AreEqual(1, sent.Count);
        StringAssert.Contains(sent[0].DataJson, "\"reason\":\"kicked\"");
        StringAssert.Contains(sent[0].DataJson, "\"actorName\":\"Moderator\"");
    }
}
