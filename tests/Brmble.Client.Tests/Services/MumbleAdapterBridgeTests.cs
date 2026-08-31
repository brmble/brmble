using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Serverlist;
using Brmble.Client.Services.Voice;
using Brmble.Client.Services.Voice.Input;
using Brmble.Client.Tests.Services.Input;
using MumbleSharp;
using MumbleSharp.Packets;
using MumbleProto;
using MumbleSharp.Model;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ProtoBuf;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterBridgeTests
{
    [TestMethod]
    public void GameInputCapture_FirstIdSuspendsAndLastReleaseResumes()
    {
        using var h = InputCaptureHarness.Create();
        h.Send("game.inputCapture", new { captureId = "a", active = true });
        Assert.IsTrue(h.Router.IsSuspended);
        h.Send("game.inputCapture", new { captureId = "b", active = true });
        h.Send("game.inputCapture", new { captureId = "a", active = false });
        Assert.IsTrue(h.Router.IsSuspended);
        h.Send("game.inputCapture", new { captureId = "b", active = false });
        Assert.IsFalse(h.Router.IsSuspended);
    }

    [TestMethod]
    public void GameInputCapture_ForcesPttReleaseAndBlocksShortcutUntilMatchingRelease()
    {
        using var h = InputCaptureHarness.Create();
        var transmitting = false;
        var shortcutCount = 0;
        h.Router.PttStateChanged += active => transmitting = active;
        h.Router.ShortcutReleased += (_, forced) => { if (!forced) shortcutCount++; };
        h.Router.SetPttBinding("Space");
        h.Router.SetShortcutBinding("toggleMute", "F1");
        h.Router.HandleJsPttKey(true);
        Assert.IsTrue(transmitting);

        h.Send("game.inputCapture", new { captureId = "arena", active = true });
        Assert.IsFalse(transmitting);
        h.PressAndReleaseShortcut();
        Assert.AreEqual(0, shortcutCount);
        h.Send("game.inputCapture", new { captureId = "arena", active = false });
        h.PressAndReleaseShortcut();
        Assert.AreEqual(1, shortcutCount);
    }

    [TestMethod]
    public void GameInputCapture_DuplicateAndStaleMessagesAreIdempotent()
    {
        using var h = InputCaptureHarness.Create();
        h.Send("game.inputCapture", new { captureId = "old", active = true });
        h.Send("game.inputCapture", new { captureId = "old", active = true });
        h.Send("game.inputCapture", new { captureId = "old", active = false });
        h.Send("game.inputCapture", new { captureId = "new", active = true });
        h.Send("game.inputCapture", new { captureId = "old", active = false });
        Assert.IsTrue(h.Router.IsSuspended);
    }

    [TestMethod]
    public void LegacyVoiceSuspendSharesCaptureOwnershipWithoutBareResumeAffectingArena()
    {
        using var h = InputCaptureHarness.Create();
        h.Send("game.inputCapture", new { captureId = "arena", active = true });
        h.Send("voice.resumeHotkeys", new { });
        Assert.IsTrue(h.Router.IsSuspended);
        h.Send("voice.suspendHotkeys", new { });
        h.Send("voice.suspendHotkeys", new { });
        h.Send("game.inputCapture", new { captureId = "arena", active = false });
        Assert.IsTrue(h.Router.IsSuspended);
        h.Send("voice.resumeHotkeys", new { });
        Assert.IsFalse(h.Router.IsSuspended);
    }

    [DataTestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   ")]
    [DataRow("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public void GameInputCapture_RejectsInvalidCaptureIds(string? captureId)
    {
        using var h = InputCaptureHarness.Create();
        h.Send("game.inputCapture", new { captureId, active = true });
        Assert.IsFalse(h.Router.IsSuspended);
    }

    [DataTestMethod]
    [DataRow("{}")]
    [DataRow("{\"active\":null}")]
    [DataRow("{\"active\":\"false\"}")]
    [DataRow("{\"active\":0}")]
    [DataRow("{\"active\":{}}")]
    public void GameInputCapture_MalformedActiveCannotReleaseHeldId(string activeFragment)
    {
        using var h = InputCaptureHarness.Create();
        h.Send("game.inputCapture", new { captureId = "arena", active = true });

        h.SendJson("game.inputCapture", activeFragment == "{}"
            ? "{\"captureId\":\"arena\"}"
            : $"{{\"captureId\":\"arena\",{activeFragment[1..]}");

        Assert.IsTrue(h.Router.IsSuspended);
    }

    [DataTestMethod]
    [DataRow("{\"captureId\":\"new\"}")]
    [DataRow("{\"captureId\":\"new\",\"active\":null}")]
    [DataRow("{\"captureId\":\"new\",\"active\":\"true\"}")]
    [DataRow("{\"captureId\":\"new\",\"active\":1}")]
    [DataRow("{\"captureId\":\"new\",\"active\":[]}")]
    public void GameInputCapture_MalformedActiveCannotSuspendNewId(string json)
    {
        using var h = InputCaptureHarness.Create();
        h.SendJson("game.inputCapture", json);
        Assert.IsFalse(h.Router.IsSuspended);
    }

    [TestMethod]
    public void Disconnect_ClearsCaptureOwnersAndResumesInput()
    {
        using var h = InputCaptureHarness.Create();
        h.Send("game.inputCapture", new { captureId = "arena", active = true });
        h.Adapter.Disconnect();
        Assert.IsFalse(h.Router.IsSuspended);
    }

    [TestMethod]
    public void Disconnect_RacingLateCaptureCannotLeaveInputSuspended()
    {
        using var h = InputCaptureHarness.Create();
        using var start = new ManualResetEventSlim(false);
        var sends = Enumerable.Range(0, 64).Select(index => Task.Run(() =>
        {
            start.Wait();
            h.Send("game.inputCapture", new { captureId = $"race-{index}", active = true });
        })).ToArray();
        var disconnect = Task.Run(() =>
        {
            start.Wait();
            h.Adapter.Disconnect();
        });

        start.Set();
        Task.WaitAll([.. sends, disconnect]);
        h.Send("game.inputCapture", new { captureId = "late", active = true });

        Assert.IsFalse(h.Router.IsSuspended);
    }

    [TestMethod]
    public void GameInputCapture_IsAcceptedOnlyDuringAnActiveVoiceLifecycle()
    {
        using var h = InputCaptureHarness.Create(acceptInputCaptures: false);
        h.Send("game.inputCapture", new { captureId = "early", active = true });
        Assert.IsFalse(h.Router.IsSuspended);

        h.AttachConnectedVoice(session: 1);
        SetPrivateField(h.Adapter, "_apiUrl", null);
        h.Adapter.ServerSync(new ServerSync { Session = 1 });
        h.Send("game.inputCapture", new { captureId = "active", active = true });

        Assert.IsTrue(h.Router.IsSuspended);
    }

    [TestMethod]
    public void DelayedCredentialCompletionAfterDisconnectCannotReopenCaptureAdmission()
    {
        using var h = InputCaptureHarness.Create(acceptInputCaptures: false);
        var fetch = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        h.SetCredentialFetch(_ => fetch.Task);
        h.AttachConnectedVoice(session: 1);
        h.Adapter.ServerSync(new ServerSync { Session = 1 });

        h.Adapter.Disconnect();
        fetch.SetResult();
        h.WaitForCredentialContinuations();
        h.Send("game.inputCapture", new { captureId = "late", active = true });

        Assert.IsFalse(h.Router.IsSuspended);
    }

    [TestMethod]
    public void DelayedOldCredentialCompletionCannotReopenReplacementButCurrentCompletionCan()
    {
        using var h = InputCaptureHarness.Create(acceptInputCaptures: false);
        var oldFetch = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var currentFetch = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var fetches = new System.Collections.Concurrent.ConcurrentQueue<Task>([oldFetch.Task, currentFetch.Task]);
        h.SetCredentialFetch(_ => fetches.TryDequeue(out var fetch) ? fetch : Task.CompletedTask);
        h.AttachConnectedVoice(session: 1);
        h.Adapter.ServerSync(new ServerSync { Session = 1 });
        Assert.IsTrue(SpinWait.SpinUntil(() => fetches.Count == 1, TimeSpan.FromSeconds(5)));

        h.Adapter.Disconnect();
        h.AttachConnectedVoice(session: 2);
        h.Adapter.ServerSync(new ServerSync { Session = 2 });
        Assert.IsTrue(SpinWait.SpinUntil(() => fetches.IsEmpty, TimeSpan.FromSeconds(5)));
        oldFetch.SetResult();
        h.WaitForCredentialContinuations(expectedCompleted: 1);
        h.Send("game.inputCapture", new { captureId = "old", active = true });
        Assert.IsFalse(h.Router.IsSuspended);

        currentFetch.SetResult();
        h.WaitForCredentialContinuations(expectedCompleted: 2);
        h.Send("game.inputCapture", new { captureId = "current", active = true });
        Assert.IsTrue(h.Router.IsSuspended);
    }

    [TestMethod]
    public void HandleWebSocketMessage_CompanionChanged_EmitsTheUpdatedRow()
    {
        // The dedicated voice.companionChanged event is gone: a companion change is just a
        // change to a server-owned field, so it arrives as the complete row like any other.
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(
            new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        adapter.ChannelState(new MumbleProto.ChannelState { ChannelId = 0, Name = "Root" });
        adapter.UserState(new MumbleProto.UserState { Session = 42, Name = "Alice", ChannelId = 0 });

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(adapter,
            """{"type":"sessionMappingSnapshot","instanceId":"i","revision":1,"mappings":{}}""");
        _ = NativeBridgeTestHarness.DrainMessages(bridge);

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(adapter, """
        {"type":"companionChanged","instanceId":"i","baseRevision":1,"revision":2,"sessionId":42,"matrixUserId":"@alice:test","companionId":"retro"}
        """);

        var row = NativeBridgeTestHarness.DrainMessages(bridge)
            .Where(m => m.Type == "voice.usersChanged")
            .SelectMany(m => JsonDocument.Parse(m.DataJson).RootElement
                .GetProperty("changed").EnumerateArray().ToList())
            .Last(e => e.GetProperty("session").GetUInt32() == 42);

        Assert.AreEqual("retro", row.GetProperty("companionId").GetString());
    }

    [TestMethod]
    public void SendVoiceConnected_IncludesChannelEnterRestrictionState()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        var channels = GetChannelDictionary(adapter);
        channels[4] = new Channel(adapter, 4, "Secret", 0) { IsEnterRestricted = true, CanEnter = false, Position = 9 };

        InvokePrivate(adapter, "SendVoiceConnected");

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var connected = sent.Single(m => m.Type == "voice.connected");
        using var doc = JsonDocument.Parse(connected.DataJson);
        var channel = doc.RootElement.GetProperty("channels").EnumerateArray().Single();

        Assert.AreEqual(4u, channel.GetProperty("id").GetUInt32());
        Assert.IsTrue(channel.GetProperty("isEnterRestricted").GetBoolean());
        Assert.IsFalse(channel.GetProperty("canEnter").GetBoolean());
        Assert.IsFalse(channel.GetProperty("hasPasswordRestriction").GetBoolean());
        Assert.AreEqual(9, channel.GetProperty("position").GetInt32());
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
    public void SendVoiceConnected_IncludesChannelDescriptionAndPosition()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        var channels = GetChannelDictionary(adapter);
        channels[4] = new Channel(adapter, 4, "General", 0)
        {
            Description = "Lobby",
            Position = 7,
        };

        InvokePrivate(adapter, "SendVoiceConnected");

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var connected = sent.Single(m => m.Type == "voice.connected");
        using var doc = JsonDocument.Parse(connected.DataJson);
        var channel = doc.RootElement.GetProperty("channels").EnumerateArray().Single();

        Assert.AreEqual("Lobby", channel.GetProperty("description").GetString());
        Assert.AreEqual(7, channel.GetProperty("position").GetInt32());
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
    public void ChannelState_IncludesPositionInBridgePayload()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);

        adapter.ChannelState(new ChannelState
        {
            ChannelId = 4,
            Name = "Secret",
            Parent = 0,
            Position = 12
        });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var channelJoined = sent.Single(m => m.Type == "voice.channelJoined");
        using var doc = JsonDocument.Parse(channelJoined.DataJson);

        Assert.AreEqual(12, doc.RootElement.GetProperty("position").GetInt32());
    }

    [TestMethod]
    public void CreateEditChannelState_IncludesRequestedPosition()
    {
        var adapter = CreateAdapterWithBridge(out _);
        var channel = new Channel(adapter, 4, "Secret", 7) { Position = 2 };

        var state = MumbleAdapter.CreateEditChannelState(4, channel, "Secret", "Updated", 12);

        Assert.AreEqual(4u, state.ChannelId);
        Assert.AreEqual(7u, state.Parent);
        Assert.IsTrue(state.ShouldSerializeParent());
        Assert.AreEqual("Secret", state.Name);
        Assert.AreEqual("Updated", state.Description);
        Assert.AreEqual(12, state.Position);
    }

    [TestMethod]
    public void CreateEditChannelState_MarksZeroPositionForSerialization()
    {
        var adapter = CreateAdapterWithBridge(out _);
        var channel = new Channel(adapter, 4, "Secret", 0) { Position = 2 };

        var state = MumbleAdapter.CreateEditChannelState(4, channel, "Secret", "Updated", 0);

        Assert.AreEqual(0, state.Position);
        Assert.IsTrue(state.ShouldSerializePosition());
    }

    [TestMethod]
    public void CreateEditChannelState_RoundTripsZeroPositionThroughProtobuf()
    {
        var adapter = CreateAdapterWithBridge(out _);
        var channel = new Channel(adapter, 4, "Secret", 0) { Position = 2 };
        var state = MumbleAdapter.CreateEditChannelState(4, channel, "Secret", "Updated", 0);

        using var stream = new MemoryStream();
        ProtoBuf.Serializer.Serialize(stream, state);
        stream.Position = 0;

        var roundTripped = ProtoBuf.Serializer.Deserialize<ChannelState>(stream);
        Assert.IsTrue(roundTripped.ShouldSerializePosition());
        Assert.AreEqual(0, roundTripped.Position);
    }

    [TestMethod]
    public void CreateEditChannelState_PreservesExistingPositionWhenMissing()
    {
        var adapter = CreateAdapterWithBridge(out _);
        var channel = new Channel(adapter, 4, "Secret", 0) { Position = 2 };

        var state = MumbleAdapter.CreateEditChannelState(4, channel, "Secret", "Updated", null);

        Assert.AreEqual(2, state.Position);
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
    public void ApplyPasswordProtectedChannelIdsFromCredentials_UpdatesChannelPayloadWithoutToken()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        var channels = GetChannelDictionary(adapter);
        channels[4] = new Channel(adapter, 4, "Locked", 0)
        {
            IsEnterRestricted = true,
            CanEnter = false,
        };

        using var doc = JsonDocument.Parse("""
        {"passwordProtectedChannelIds":[4],"matrix":{"homeserverUrl":"https://matrix.example.com"}}
        """);
        InvokePrivate(adapter, "ApplyPasswordProtectedChannelIdsFromCredentials", (object)doc.RootElement);
        InvokePrivate(adapter, "SendVoiceConnected");

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var connected = sent.Single(m => m.Type == "voice.connected");
        using var payload = JsonDocument.Parse(connected.DataJson);
        var channel = payload.RootElement.GetProperty("channels").EnumerateArray().Single();

        Assert.IsTrue(channel.GetProperty("hasPasswordRestriction").GetBoolean());
        Assert.IsFalse(connected.DataJson.Contains("secret", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public void ApplyPasswordProtectedChannelIdsFromCredentials_ReplacesPreviousRestrictionCache()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        var channels = GetChannelDictionary(adapter);
        channels[4] = new Channel(adapter, 4, "Old Locked", 0) { IsEnterRestricted = true, CanEnter = false };
        channels[5] = new Channel(adapter, 5, "New Locked", 0) { IsEnterRestricted = true, CanEnter = false };
        var restrictions = GetChannelPasswordRestrictionDictionary(adapter);
        restrictions[4] = true;

        using var doc = JsonDocument.Parse("""
        {"passwordProtectedChannelIds":[5]}
        """);
        InvokePrivate(adapter, "ApplyPasswordProtectedChannelIdsFromCredentials", (object)doc.RootElement);
        InvokePrivate(adapter, "SendVoiceConnected");

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var connected = sent.Single(m => m.Type == "voice.connected");
        using var payload = JsonDocument.Parse(connected.DataJson);
        var channelStates = payload.RootElement.GetProperty("channels").EnumerateArray().ToDictionary(
            channel => channel.GetProperty("id").GetUInt32(),
            channel => channel.GetProperty("hasPasswordRestriction").GetBoolean());

        Assert.IsFalse(channelStates[4]);
        Assert.IsTrue(channelStates[5]);
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

    [TestMethod]
    public void PermissionDenied_ForwardsStructuredFields()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);

        adapter.PermissionDenied(new PermissionDenied
        {
            Type = PermissionDenied.DenyType.Permission,
            Permission = (uint)Permission.Enter,
            ChannelId = 4,
            Session = 12,
            Reason = "Denied",
            Name = "Secret",
        });

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var error = sent.Single(m => m.Type == "voice.error");
        using var doc = JsonDocument.Parse(error.DataJson);
        var payload = doc.RootElement;

        Assert.AreEqual("permissionDenied", payload.GetProperty("type").GetString());
        Assert.AreEqual("Permission", payload.GetProperty("denyType").GetString());
        Assert.AreEqual((int)Permission.Enter, payload.GetProperty("permission").GetInt32());
        Assert.AreEqual(4u, payload.GetProperty("channelId").GetUInt32());
        Assert.AreEqual(12u, payload.GetProperty("session").GetUInt32());
        Assert.AreEqual("Denied", payload.GetProperty("reason").GetString());
        Assert.AreEqual("Secret", payload.GetProperty("name").GetString());
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerStoresPasswordForActiveServer()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret",
            password = "secret-token"
        }));

        var saved = appConfig.GetChannelPasswords("example.test:64738");
        Assert.AreEqual(1, saved.Count);
        Assert.AreEqual("secret-token", saved[0].Password);
    }

    [TestMethod]
    public async Task Reconnect_HandlerEmitsReconnectingWhenCredentialsAreAvailable()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetPrivateField(adapter, "_reconnectUsername", "TestUser");
        SetPrivateField(adapter, "_reconnectPassword", "server-password");
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.reconnect", JsonSerializer.SerializeToElement(new { channelId = 5 }));
        await Task.Delay(50);

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsTrue(sent.Any(m => m.Type == "voice.reconnecting"));
        var reconnectingDelays = sent
            .Where(m => m.Type == "voice.reconnecting")
            .Select(m => JsonDocument.Parse(m.DataJson))
            .ToList();
        try
        {
            Assert.AreEqual(1, reconnectingDelays.Count);
            Assert.IsTrue(reconnectingDelays.All(doc => doc.RootElement.GetProperty("delayMs").GetInt32() == 0));
        }
        finally
        {
            foreach (var doc in reconnectingDelays)
                doc.Dispose();
        }
        Assert.AreEqual(5u, GetPrivateField<uint?>(adapter, "_reconnectTargetChannelId"));
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerRemovesPasswordWhenBlank()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        appConfig.SaveChannelPassword("example.test:64738", 5, "Secret", "secret-token");
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret",
            password = ""
        }));

        Assert.AreEqual(0, appConfig.GetChannelPasswords("example.test:64738").Count);
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerIgnoresMissingPasswordWithoutRemovingExistingPassword()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        appConfig.SaveChannelPassword("example.test:64738", 5, "Secret", "secret-token");
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret"
        }));

        var saved = appConfig.GetChannelPasswords("example.test:64738");
        Assert.AreEqual(1, saved.Count);
        Assert.AreEqual("secret-token", saved[0].Password);
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerIgnoresMissingActiveServer()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret",
            password = "secret-token"
        }));

        Assert.AreEqual(0, appConfig.GetChannelPasswords("example.test:64738").Count);
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerIgnoresStaleServerWhenDisconnected()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret",
            password = "secret-token"
        }));

        Assert.AreEqual(0, appConfig.GetChannelPasswords("example.test:64738").Count);
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerIgnoresMalformedChannelId()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = "not-a-number",
            channelName = "Secret",
            password = "secret-token"
        }));

        Assert.AreEqual(0, appConfig.GetChannelPasswords("example.test:64738").Count);
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerIgnoresNonStringPasswordWithoutRemovingExistingPassword()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        appConfig.SaveChannelPassword("example.test:64738", 5, "Secret", "secret-token");
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret",
            password = new { value = "not-a-string" }
        }));

        var saved = appConfig.GetChannelPasswords("example.test:64738");
        Assert.AreEqual(1, saved.Count);
        Assert.AreEqual("secret-token", saved[0].Password);
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsFalse(sent.Any(m => m.DataJson.Contains("secret-token", StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerEmitsSafeErrorWhenPersistenceFails()
    {
        var appConfig = new ThrowingAppConfigService();
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret",
            password = "secret-token"
        }));

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var error = sent.Single(m => m.Type == "voice.channelPasswordSaveError");
        StringAssert.Contains(error.DataJson, "Unable to save channel password");
        Assert.IsFalse(error.DataJson.Contains("secret-token", StringComparison.Ordinal));
    }

    [TestMethod]
    public async Task SaveChannelPassword_HandlerTrimsPasswordBeforeSaving()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("Example.Test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            channelName = "Secret",
            password = "  secret-token  "
        }));

        var saved = appConfig.GetChannelPasswords("example.test:64738");
        Assert.AreEqual(1, saved.Count);
        Assert.AreEqual("secret-token", saved[0].Password);
    }

    [TestMethod]
    public async Task GetChannelPassword_HandlerReturnsSavedPasswordForActiveServer()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        appConfig.SaveChannelPassword("example.test:64738", 5, "Secret", "secret-token");
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.getChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            requestId = "req-1"
        }));

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var response = sent.Single(m => m.Type == "voice.channelPassword");
        using var doc = JsonDocument.Parse(response.DataJson);
        Assert.AreEqual("req-1", doc.RootElement.GetProperty("requestId").GetString());
        Assert.AreEqual(5u, doc.RootElement.GetProperty("channelId").GetUInt32());
        Assert.AreEqual("secret-token", doc.RootElement.GetProperty("password").GetString());
    }

    [TestMethod]
    public async Task GetChannelPassword_HandlerReturnsEmptyPasswordWhenNoneSaved()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.getChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = 5,
            requestId = "req-1"
        }));

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var response = sent.Single(m => m.Type == "voice.channelPassword");
        using var doc = JsonDocument.Parse(response.DataJson);
        Assert.AreEqual("", doc.RootElement.GetProperty("password").GetString());
    }

    [TestMethod]
    public async Task GetChannelPassword_HandlerIgnoresMalformedChannelId()
    {
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, appConfigService: appConfig);
        adapter.RegisterHandlers(bridge);
        adapter.SetActiveServerForTests("example.test", 64738);
        SetConnectedConnection(adapter);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.getChannelPassword", JsonSerializer.SerializeToElement(new
        {
            channelId = "not-a-number",
            requestId = "req-1"
        }));

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsFalse(sent.Any(m => m.Type == "voice.channelPassword"));
    }

    [TestMethod]
    public void VoiceReorderChannels_RejectsMixedParentGroups()
    {
        var adapter = CreateAdapterWithBridge(out var bridge);
        adapter.RegisterHandlers(bridge);
        var channels = GetChannelDictionary(adapter);
        channels[10] = new Channel(adapter, 10, "General", 0) { Position = 0 };
        channels[20] = new Channel(adapter, 20, "Raid", 10) { Position = 0 };
        SetConnectedConnection(adapter);

        InvokeBridgeHandler(bridge, "voice.reorderChannels", """
        {"parentId":0,"channelIds":[10,20]}
        """);

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsTrue(sent.Any(message => message.Type == "voice.error" && message.DataJson.Contains("same parent", StringComparison.OrdinalIgnoreCase)));
    }

    [TestMethod]
    public void VoiceReorderChannels_SendsDistinctChannelPositions()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        adapter.RegisterHandlers(bridge);
        var capture = AttachCapturingConnection(adapter);
        adapter.ChannelState(new ChannelState { ChannelId = 0, Name = "Root" });
        adapter.ChannelState(new ChannelState { ChannelId = 10, Name = "General", Parent = 0, Description = "Lobby", Position = 0 });
        adapter.ChannelState(new ChannelState { ChannelId = 20, Name = "Raid", Parent = 0, Description = "Games", Position = 1 });
        _ = NativeBridgeTestHarness.DrainMessages(bridge);

        InvokeBridgeHandler(bridge, "voice.reorderChannels", """
        {"parentId":0,"channelIds":[20,10]}
        """);

        var sentPackets = ReadSentChannelStatePackets(capture.PacketStream)
            .Where(packet => packet.ShouldSerializePosition())
            .ToArray();

        CollectionAssert.AreEqual(new[] { 20u, 10u }, sentPackets.Select(packet => packet.ChannelId).ToArray());
        CollectionAssert.AreEqual(new[] { 0, 10 }, sentPackets.Select(packet => packet.Position).ToArray());
        CollectionAssert.AreEqual(new[] { 0u, 0u }, sentPackets.Select(packet => packet.Parent).ToArray());
        CollectionAssert.AreEqual(new[] { "Raid", "General" }, sentPackets.Select(packet => packet.Name).ToArray());
        CollectionAssert.AreEqual(new[] { "Games", "Lobby" }, sentPackets.Select(packet => packet.Description).ToArray());
        Assert.IsTrue(sentPackets.All(packet => packet.ShouldSerializeParent()));
        capture.Dispose();
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

    private static void InvokePrivate(object instance, string methodName, object arg)
    {
        var method = instance.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
        method!.Invoke(instance, [arg]);
    }

    private static void InvokePrivate(object instance, string methodName)
    {
        var method = instance.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
        method!.Invoke(instance, [null]);
    }

    private static void SetPrivateField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);

    private static T GetPrivateField<T>(object instance, string name)
        => (T)instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;

    private static void SetConnectedConnection(MumbleAdapter adapter)
    {
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        typeof(MumbleConnection)
            .GetProperty(nameof(MumbleConnection.State))!
            .SetValue(connection, ConnectionStates.Connected);
    }

    private static CapturingConnection AttachCapturingConnection(MumbleAdapter adapter)
    {
        var connection = new MumbleConnection(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        typeof(MumbleConnection)
            .GetProperty(nameof(MumbleConnection.State))!
            .SetValue(connection, ConnectionStates.Connected);

        var packetStream = new MemoryStream();
        var socketPair = CreateSocketPair();
        var tcpSocketType = Type.GetType("MumbleSharp.TcpSocket, MumbleSharp")!;
        var tcpSocket = RuntimeHelpers.GetUninitializedObject(tcpSocketType);
        tcpSocketType.GetField("_netStream", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(tcpSocket, socketPair.Client.GetStream());
        tcpSocketType.GetField("_tlsStream", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(tcpSocket, packetStream);
        tcpSocketType.GetField("_writer", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(tcpSocket, new BinaryWriter(packetStream));
        tcpSocketType.GetField("_sendLock", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(tcpSocket, new object());
        typeof(MumbleConnection).GetField("_tcp", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(connection, tcpSocket);

        return new CapturingConnection(packetStream, socketPair.Client, socketPair.Server);
    }

    private static (TcpClient Client, TcpClient Server) CreateSocketPair()
    {
        var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var client = new TcpClient();
            client.Connect((System.Net.IPEndPoint)listener.LocalEndpoint);
            var server = listener.AcceptTcpClient();
            return (client, server);
        }
        finally
        {
            listener.Stop();
        }
    }

    private static ChannelState[] ReadSentChannelStatePackets(MemoryStream stream)
    {
        stream.Position = 0;
        using var reader = new BinaryReader(stream, System.Text.Encoding.UTF8, leaveOpen: true);
        var packets = new List<ChannelState>();

        while (stream.Position < stream.Length)
        {
            var packetType = (PacketType)IPAddress.NetworkToHostOrder(reader.ReadInt16());
            Assert.AreEqual(PacketType.ChannelState, packetType);
            packets.Add(Serializer.DeserializeWithLengthPrefix<ChannelState>(stream, PrefixStyle.Fixed32BigEndian));
        }

        return packets.ToArray();
    }

    private static void InvokeBridgeHandler(NativeBridge bridge, string type, string json)
    {
        using var doc = JsonDocument.Parse(json);
        NativeBridgeTestHarness.InvokeAsync(bridge, type, doc.RootElement.Clone()).GetAwaiter().GetResult();
    }

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

    private sealed class CapturingConnection : IDisposable
    {
        public CapturingConnection(MemoryStream packetStream, TcpClient client, TcpClient server)
        {
            PacketStream = packetStream;
            Client = client;
            Server = server;
        }

        public MemoryStream PacketStream { get; }
        private TcpClient Client { get; }
        private TcpClient Server { get; }

        public void Dispose()
        {
            Client.Dispose();
            Server.Dispose();
            PacketStream.Dispose();
        }
    }

    private sealed class ThrowingAppConfigService : IAppConfigService
    {
        public bool IsFirstLaunch => false;
        public IReadOnlyList<ServerEntry> GetServers() => [];
        public void AddServer(ServerEntry server) { }
        public ServerEntry? UpdateServer(ServerEntry server) => server;
        public void RemoveServer(string id) { }
        public AppSettings GetSettings() => AppSettings.Default;
        public IReadOnlyList<SavedChannelPassword> GetChannelPasswords(string serverKey) => [];
        public IReadOnlyList<string> GetChannelAccessTokens(string serverKey) => [];
        public void SaveChannelPassword(string serverKey, uint channelId, string channelName, string password)
            => throw new InvalidOperationException("Persistence failed for secret-token");
        public void RemoveChannelPassword(string serverKey, uint channelId)
            => throw new InvalidOperationException("Persistence failed for secret-token");
        public void SetSettings(AppSettings settings) { }
        public WindowState? GetWindowState() => null;
        public void SaveWindowState(WindowState state) { }
        public string? GetClosePreference() => null;
        public void SaveClosePreference(string? preference) { }
        public string? GetLastConnectedServerId() => null;
        public void SaveLastConnectedServerId(string? serverId) { }
        public double? GetZoomFactor() => null;
        public void SaveZoomFactor(double? factor) { }
        public IReadOnlyList<ProfileEntry> GetProfiles() => [];
        public bool AddProfile(ProfileEntry profile) => true;
        public void RemoveProfile(string id) { }
        public bool RenameProfile(string id, string newName) => true;
        public string? GetActiveProfileId() => null;
        public void SetActiveProfileId(string? id) { }
        public string GetCertsDir() => Path.GetTempPath();
        public void SwapProfileRegistrations(string? oldProfileId, string? newProfileId) { }
    }

    private sealed class InputCaptureHarness : IDisposable
    {
        private const int VK_F1 = 0x70;
        private readonly NativeBridge _bridge;
        private readonly FakeInputBackend _backend;

        private InputCaptureHarness(NativeBridge bridge, MumbleAdapter adapter, InputRouter router, FakeInputBackend backend)
        {
            _bridge = bridge;
            Adapter = adapter;
            Router = router;
            _backend = backend;
        }

        public MumbleAdapter Adapter { get; }
        public InputRouter Router { get; }

        public static InputCaptureHarness Create(bool acceptInputCaptures = true)
        {
            var bridge = NativeBridgeTestHarness.Create();
            var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
            var backend = new FakeInputBackend();
            var router = new InputRouter(backend, autoStartTimers: false);
            SetPrivateField(adapter, "_inputRouter", router);
            SetPrivateField(adapter, "_activeCaptureIds", new HashSet<string>(StringComparer.Ordinal));
            SetPrivateField(adapter, "_captureLock", new object());
            SetPrivateField(adapter, "_acceptInputCaptures", acceptInputCaptures);
            adapter.RegisterHandlers(bridge);
            return new InputCaptureHarness(bridge, adapter, router, backend);
        }

        public void Send(string type, object payload)
            => NativeBridgeTestHarness.InvokeAsync(_bridge, type, JsonSerializer.SerializeToElement(payload)).GetAwaiter().GetResult();

        public void SendJson(string type, string json)
        {
            using var document = JsonDocument.Parse(json);
            NativeBridgeTestHarness.InvokeAsync(_bridge, type, document.RootElement.Clone()).GetAwaiter().GetResult();
        }

        public void SetCredentialFetch(Func<string, Task> fetch)
            => Adapter.CredentialFetchForTests = fetch;

        public void AttachConnectedVoice(uint session)
        {
            var connection = new MumbleConnection(new IPEndPoint(IPAddress.Loopback, 64738), Adapter, voiceSupport: false);
            Adapter.Initialise(connection);
            typeof(MumbleConnection).GetProperty(nameof(MumbleConnection.State))!.SetValue(connection, ConnectionStates.Connected);
            var channels = GetChannelDictionary(Adapter);
            channels[0] = new Channel(Adapter, 0, "Root", 0);
            var users = MumbleAdapterTestHarness.GetBaseField<System.Collections.Concurrent.ConcurrentDictionary<uint, User>>(Adapter, "UserDictionary");
            users[session] = new User(Adapter, session) { Name = $"User {session}", Channel = channels[0] };
            SetPrivateField(Adapter, "_apiUrl", "https://api.example.com");
        }

        public void WaitForCredentialContinuations(int expectedCompleted = 1)
        {
            Assert.IsTrue(SpinWait.SpinUntil(
                () => Adapter.CredentialContinuationsCompletedForTests >= expectedCompleted,
                TimeSpan.FromSeconds(5)));
        }

        public void PressAndReleaseShortcut()
        {
            _backend.KeyDownStates[VK_F1] = true;
            Router.TickShortcutPollOnce();
            _backend.KeyDownStates[VK_F1] = false;
            Router.TickShortcutPollOnce();
        }

        public void Dispose() => Router.Dispose();
    }
}
