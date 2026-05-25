using System.Reflection;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Serverlist;
using Brmble.Client.Services.Voice;
using MumbleSharp;
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
        var channel = new Channel(adapter, 4, "Secret", 0) { Position = 2 };

        var state = MumbleAdapter.CreateEditChannelState(4, channel, "Secret", "Updated", 12);

        Assert.AreEqual(4u, state.ChannelId);
        Assert.AreEqual("Secret", state.Name);
        Assert.AreEqual("Updated", state.Description);
        Assert.AreEqual(12, state.Position);
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
}
