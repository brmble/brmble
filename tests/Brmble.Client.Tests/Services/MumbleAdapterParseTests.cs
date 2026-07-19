using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Certificate;
using Brmble.Client.Services.Serverlist;
using Brmble.Client.Services.Voice;
using MumbleProto;
using MumbleSharp;
using MumbleSharp.Packets;
using MumbleSharp.Model;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using ProtoBuf;

namespace Brmble.Client.Tests.Services;

internal static class NativeBridgeTestHarness
{
    public static NativeBridge Create()
    {
        var bridge = (NativeBridge)RuntimeHelpers.GetUninitializedObject(typeof(NativeBridge));
        SetField(bridge, "_handlers", new Dictionary<string, List<Func<JsonElement, Task>>>());
        SetField(bridge, "_pendingMessages", new ConcurrentQueue<string>());
        return bridge;
    }

    public static async Task InvokeAsync(NativeBridge bridge, string type, JsonElement data)
    {
        var handlers = (Dictionary<string, List<Func<JsonElement, Task>>>)GetField(bridge, "_handlers");
        foreach (var handler in handlers[type])
            await handler(data);
    }

    public static List<(string Type, string DataJson)> DrainMessages(NativeBridge bridge)
    {
        var queue = (ConcurrentQueue<string>)GetField(bridge, "_pendingMessages");
        var result = new List<(string Type, string DataJson)>();

        while (queue.TryDequeue(out var json))
        {
            using var doc = JsonDocument.Parse(json);
            var type = doc.RootElement.GetProperty("type").GetString() ?? string.Empty;
            var dataJson = doc.RootElement.GetProperty("data").GetRawText();
            result.Add((type, dataJson));
        }

        return result;
    }

    private static object GetField(object instance, string name)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;

    private static void SetField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);
}

internal static class MumbleAdapterTestHarness
{
    public static MumbleAdapter CreateWithBridge(
        NativeBridge bridge,
        string? apiUrl = null,
        CertificateService? certService = null,
        IAppConfigService? appConfigService = null,
        AudioManager? audioManager = null)
    {
        var adapter = (MumbleAdapter)RuntimeHelpers.GetUninitializedObject(typeof(MumbleAdapter));
        SetBaseField(adapter, "UserDictionary", new ConcurrentDictionary<uint, User>());
        SetBaseField(adapter, "ChannelDictionary", new ConcurrentDictionary<uint, Channel>());
        SetField(adapter, "_bridge", bridge);
        SetField(adapter, "_apiUrl", apiUrl);
        SetField(adapter, "_certService", certService);
        SetField(adapter, "_appConfigService", appConfigService);
        SetField(adapter, "_audioManager", audioManager);
        SetField(adapter, "_sessionMappings", new ConcurrentDictionary<uint, MumbleAdapter.SessionMappingEntry>());
        SetField(adapter, "_channelPasswordRestrictions", new ConcurrentDictionary<uint, bool>());
        return adapter;
    }

    public static void SetField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);

    public static T GetField<T>(object instance, string name)
        => (T)instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;

    public static void InvokeHandleWebSocketMessage(MumbleAdapter adapter, string json)
        => adapter.GetType().GetMethod("HandleWebSocketMessage", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(adapter, [json]);

    private static void SetBaseField(object instance, string name, object? value)
        => instance.GetType().BaseType!.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);

    public static T GetBaseField<T>(object instance, string name)
        => (T)instance.GetType().BaseType!.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;
}

internal sealed class TestAppConfigService : IAppConfigService
{
    private readonly string _certsDir;
    private readonly List<SavedChannelPassword> _channelPasswords = new();

    public TestAppConfigService(string certsDir) => _certsDir = certsDir;

    public bool IsFirstLaunch => false;
    public IReadOnlyList<ServerEntry> GetServers() => [];
    public void AddServer(ServerEntry server) { }
    public ServerEntry? UpdateServer(ServerEntry server) => server;
    public void RemoveServer(string id) { }
    public AppSettings CurrentSettings { get; private set; } = AppSettings.Default;
    public AppSettings? LastSetSettings { get; private set; }
    public AppSettings GetSettings() => CurrentSettings;
    public IReadOnlyList<SavedChannelPassword> GetChannelPasswords(string serverKey)
        => _channelPasswords.Where(p => p.ServerKey == serverKey).ToList();
    public IReadOnlyList<string> GetChannelAccessTokens(string serverKey)
        => _channelPasswords
            .Where(p => p.ServerKey == serverKey)
            .Select(p => p.Password.Trim())
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Distinct(StringComparer.Ordinal)
            .ToList();
    public void SaveChannelPassword(string serverKey, uint channelId, string channelName, string password)
    {
        _channelPasswords.RemoveAll(p => p.ServerKey == serverKey && p.ChannelId == channelId);
        _channelPasswords.Add(new SavedChannelPassword(serverKey, channelId, channelName, password));
    }
    public void RemoveChannelPassword(string serverKey, uint channelId)
        => _channelPasswords.RemoveAll(p => p.ServerKey == serverKey && p.ChannelId == channelId);
    public void SetSettings(AppSettings settings)
    {
        CurrentSettings = settings;
        LastSetSettings = settings;
    }
    public WindowState? GetWindowState() => null;
    public void SaveWindowState(WindowState state) { }
    public string? GetClosePreference() => null;
    public void SaveClosePreference(string? preference) { }
    public string? GetLastConnectedServerId() => null;
    public void SaveLastConnectedServerId(string? serverId) { }
    public double? GetZoomFactor() => null;
    public void SaveZoomFactor(double? factor) { }
    public IReadOnlyList<ProfileEntry> GetProfiles() => [new("test", "Test")];
    public bool AddProfile(ProfileEntry profile) => true;
    public void RemoveProfile(string id) { }
    public bool RenameProfile(string id, string newName) => true;
    public string? GetActiveProfileId() => "test";
    public void SetActiveProfileId(string? id) { }
    public string GetCertsDir() => _certsDir;
    public void SwapProfileRegistrations(string? oldProfileId, string? newProfileId) { }
}

internal sealed class MumbleProtocolTestHarness : IAsyncDisposable
{
    private readonly TcpListener _listener;
    private readonly X509Certificate2 _serverCertificate;
    private readonly Task<TcpClient> _acceptTask;
    private SslStream? _ssl;
    private TcpClient? _client;

    private MumbleProtocolTestHarness()
    {
        _serverCertificate = TestTlsHttpServer.CreateCertificate("CN=localhost");
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _acceptTask = _listener.AcceptTcpClientAsync();
    }

    public int Port { get; }

    public static Task<MumbleProtocolTestHarness> StartAsync()
        => Task.FromResult(new MumbleProtocolTestHarness());

    public async Task<MumbleProto.Authenticate> ReadAuthenticateAsync()
    {
        _client = await _acceptTask.WaitAsync(TimeSpan.FromSeconds(5));
        _ssl = new SslStream(_client.GetStream(), false);
        await _ssl.AuthenticateAsServerAsync(_serverCertificate, clientCertificateRequired: false, enabledSslProtocols: System.Security.Authentication.SslProtocols.Tls12, checkCertificateRevocation: false);

        _ = await ReadPacketAsync<MumbleProto.Version>();
        var (type, authenticate) = await ReadPacketAsync<MumbleProto.Authenticate>();
        Assert.AreEqual(PacketType.Authenticate, type);
        return authenticate;
    }

    private async Task<(PacketType Type, T Payload)> ReadPacketAsync<T>()
    {
        var typeBytes = await ReadExactlyAsync(2);
        var type = (PacketType)IPAddress.NetworkToHostOrder(BitConverter.ToInt16(typeBytes));
        var lengthBytes = await ReadExactlyAsync(4);
        var length = IPAddress.NetworkToHostOrder(BitConverter.ToInt32(lengthBytes));
        var payloadBytes = await ReadExactlyAsync(length);
        using var payload = new MemoryStream(payloadBytes);
        return (type, Serializer.Deserialize<T>(payload));
    }

    private async Task<byte[]> ReadExactlyAsync(int length)
    {
        var buffer = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            var read = await _ssl!.ReadAsync(buffer.AsMemory(offset, length - offset)).AsTask().WaitAsync(TimeSpan.FromSeconds(5));
            if (read == 0)
                throw new EndOfStreamException();
            offset += read;
        }

        return buffer;
    }

    public async ValueTask DisposeAsync()
    {
        _listener.Stop();
        _ssl?.Dispose();
        _client?.Dispose();
        try { await _acceptTask; } catch { }
        _serverCertificate.Dispose();
    }
}

internal sealed class TestTlsHttpServer : IAsyncDisposable
{
    private readonly TcpListener _listener;
    private readonly X509Certificate2 _serverCertificate;
    private readonly Task _serverTask;
    private readonly CancellationTokenSource _cts = new();
    private readonly int _statusCode;

    public string Url { get; }

    public TestTlsHttpServer(string responseBody, int statusCode = 200)
    {
        _statusCode = statusCode;
        _serverCertificate = CreateCertificate("CN=localhost");
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        var port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        Url = $"https://127.0.0.1:{port}/";
        _serverTask = HandleOneRequestAsync(responseBody, _cts.Token);
    }

    public static X509Certificate2 CreateCertificate(string subject)
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(subject, rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, false));
        var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        return X509CertificateLoader.LoadPkcs12(certificate.Export(X509ContentType.Pkcs12), password: null, X509KeyStorageFlags.Exportable);
    }

    private async Task HandleOneRequestAsync(string responseBody, CancellationToken cancellationToken)
    {
        using var tcp = await _listener.AcceptTcpClientAsync(cancellationToken);
        await using var ssl = new SslStream(tcp.GetStream(), false);
        await ssl.AuthenticateAsServerAsync(_serverCertificate, clientCertificateRequired: false, enabledSslProtocols: System.Security.Authentication.SslProtocols.Tls12, checkCertificateRevocation: false);

        var buffer = new byte[4096];
        _ = await ssl.ReadAsync(buffer, cancellationToken);

        var bodyBytes = System.Text.Encoding.UTF8.GetBytes(responseBody);
        var reason = _statusCode == 409 ? "Conflict" : "OK";
        var header = $"HTTP/1.1 {_statusCode} {reason}\r\nContent-Type: application/json\r\nContent-Length: {bodyBytes.Length}\r\nConnection: close\r\n\r\n";
        var headerBytes = System.Text.Encoding.UTF8.GetBytes(header);
        await ssl.WriteAsync(headerBytes, cancellationToken);
        await ssl.WriteAsync(bodyBytes, cancellationToken);
        await ssl.FlushAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        _listener.Stop();
        try { await _serverTask; } catch { }
        _serverCertificate.Dispose();
        _cts.Dispose();
    }
}

[TestClass]
public class MumbleAdapterParseTests
{
    [TestMethod]
    public void ParseSessionMappings_PreservesCertHash()
    {
        using var doc = JsonDocument.Parse("""
        {
            "42": {
                "matrixUserId": "@mjg:example.com",
                "mumbleName": "MJG",
                "companionId": "bee",
                "isBrmbleClient": false,
                "certHash": "cert-mjg"
            }
        }
        """);

        var mappings = MumbleAdapter.ParseSessionMappings(doc.RootElement);

        Assert.AreEqual("cert-mjg", mappings[42].CertHash);
    }

    [TestMethod]
    public void ServerSync_JoinsReconnectTargetAfterAuthenticateTokensApply()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
        var connection = new MumbleConnection(new IPEndPoint(IPAddress.Loopback, 64738), adapter, voiceSupport: false);
        adapter.Initialise(connection);
        typeof(MumbleConnection).GetProperty(nameof(MumbleConnection.State))!.SetValue(connection, ConnectionStates.Connected);
        var channelDictionary = MumbleAdapterTestHarness.GetBaseField<ConcurrentDictionary<uint, Channel>>(adapter, "ChannelDictionary");
        channelDictionary[0] = new Channel(adapter, 0, "Root", 0);
        var userDictionary = MumbleAdapterTestHarness.GetBaseField<ConcurrentDictionary<uint, User>>(adapter, "UserDictionary");
        userDictionary[1] = new User(adapter, 1) { Name = "TestUser", Channel = channelDictionary[0] };
        MumbleAdapterTestHarness.SetField(adapter, "_isReconnect", true);
        MumbleAdapterTestHarness.SetField(adapter, "_reconnectTargetChannelId", 5u);

        adapter.ServerSync(new ServerSync { Session = 1 });

        Assert.AreEqual(5u, MumbleAdapterTestHarness.GetField<uint?>(adapter, "_pendingLocalJoinChannelId"));
        Assert.IsNull(MumbleAdapterTestHarness.GetField<uint?>(adapter, "_reconnectTargetChannelId"));
    }

    [TestMethod]
    public void HandleWebSocketAclChanged_ForwardsToBridge()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://api.example.com");
        var json = """
            {
              "type": "acl.changed",
              "channelId": 4,
              "snapshot": {
                "channelId": 4,
                "inheritAcls": true,
                "groups": [],
                "acls": [],
                "fetchedAt": "2026-05-15T12:00:00Z",
                "stale": false,
                "warning": null
              }
            }
            """;

        MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(adapter, json);

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsTrue(sent.Any(m => m.Type == "acl.changed"));
    }

    [TestMethod]
    public async Task ActiveShareFailure_IsNotCollapsedIntoEmptyShares()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://api.example.com");
        adapter.RegisterHandlers(bridge);

        using var doc = JsonDocument.Parse("""
        {
            "roomName": "channel-1"
        }
        """);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.checkActiveShare", doc.RootElement.Clone());
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);

        Assert.IsTrue(sent.Any(x => x.Type == "livekit.activeShareError"));
        Assert.IsFalse(sent.Any(x => x.Type == "livekit.activeShareResult" && x.DataJson.Contains("\"shares\"")));
    }

    [TestMethod]
    public async Task Connect_SendsSavedChannelPasswordsAsAuthenticateTokens()
    {
        await using var harness = await MumbleProtocolTestHarness.StartAsync();
        var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
        appConfig.SaveChannelPassword("127.0.0.1:" + harness.Port, 5, "Secret", "secret-token");
        appConfig.SaveChannelPassword("127.0.0.1:" + harness.Port, 6, "Other", "secret-token");
        var adapter = new MumbleAdapter(NativeBridgeTestHarness.Create(), IntPtr.Zero, appConfigService: appConfig);

        var authenticateTask = harness.ReadAuthenticateAsync();
        adapter.Connect("127.0.0.1", harness.Port, "tester", "");
        var authenticate = await authenticateTask;

        Assert.AreEqual(1, authenticate.Tokens.Count);
        Assert.AreEqual("secret-token", authenticate.Tokens.Single());
    }

    [TestMethod]
    public async Task ChatGetChannelAccess_WithoutApiUrl_ReturnsEmptyAccessMap()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: null);
        adapter.RegisterHandlers(bridge);

        using var doc = JsonDocument.Parse("""
        { "channelIds": [1, 2] }
        """);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "chat.getChannelAccess", doc.RootElement.Clone());

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var access = sent.Single(m => m.Type == "chat.channelAccess");
        using var payload = JsonDocument.Parse(access.DataJson);
        Assert.AreEqual(0, payload.RootElement.GetProperty("channels").EnumerateObject().Count());
    }

    [TestMethod]
    public async Task ActiveShareError_EchoesRequestId()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://api.example.com");
        adapter.RegisterHandlers(bridge);

        using var doc = JsonDocument.Parse("""
        {
            "roomName": "channel-1",
            "requestId": 42
        }
        """);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.checkActiveShare", doc.RootElement.Clone());
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);

        Assert.IsTrue(sent.Any(x => x.Type == "livekit.activeShareError" && x.DataJson.Contains("\"requestId\":42")));
    }

    [TestMethod]
    public async Task ActiveShareFailure_EmitsScreenshareServiceStatus()
    {
        var bridge = NativeBridgeTestHarness.Create();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://api.example.com");
        adapter.RegisterHandlers(bridge);

        using var doc = JsonDocument.Parse("""
        {
            "roomName": "channel-1",
            "requestId": 7
        }
        """);

        await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.checkActiveShare", doc.RootElement.Clone());
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);

        Assert.IsTrue(sent.Any(x => x.Type == "brmble.serviceStatus" && x.DataJson.Contains("\"service\":\"screenshare\"") && x.DataJson.Contains("\"state\":\"disconnected\"")));
    }

    [TestMethod]
    public async Task ShareStoppedFailure_DoesNotEmitScreenshareDisconnectedStatus()
    {
        var tempDir = Directory.CreateTempSubdirectory();
        try
        {
            var bridge = NativeBridgeTestHarness.Create();
            using var clientCertificate = TestTlsHttpServer.CreateCertificate("CN=client");
            await File.WriteAllBytesAsync(Path.Combine(tempDir.FullName, "Test_test.pfx"), clientCertificate.Export(X509ContentType.Pkcs12));

            var certService = new CertificateService(bridge, new TestAppConfigService(tempDir.FullName));
            var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://127.0.0.1:1/", certService: certService);
            adapter.RegisterHandlers(bridge);
            certService.RegisterHandlers(bridge);

            using var statusDoc = JsonDocument.Parse("{}");
            await NativeBridgeTestHarness.InvokeAsync(bridge, "cert.requestStatus", statusDoc.RootElement.Clone());
            _ = NativeBridgeTestHarness.DrainMessages(bridge);

            using var doc = JsonDocument.Parse("""
            {
                "roomName": "channel-1"
            }
            """);

            await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.shareStopped", doc.RootElement.Clone());
            var sent = NativeBridgeTestHarness.DrainMessages(bridge);

            Assert.IsFalse(sent.Any(x => x.Type == "brmble.serviceStatus" && x.DataJson.Contains("\"service\":\"screenshare\"") && x.DataJson.Contains("\"state\":\"disconnected\"")));
        }
        finally
        {
            tempDir.Delete(recursive: true);
        }
    }

    [TestMethod]
    public async Task ActiveShareResult_EchoesRequestId()
    {
        var tempDir = Directory.CreateTempSubdirectory();
        try
        {
            var bridge = NativeBridgeTestHarness.Create();
            using var clientCertificate = TestTlsHttpServer.CreateCertificate("CN=client");
            await File.WriteAllBytesAsync(Path.Combine(tempDir.FullName, "Test_test.pfx"), clientCertificate.Export(X509ContentType.Pkcs12));

            var certService = new CertificateService(bridge, new TestAppConfigService(tempDir.FullName));
            await using var server = new TestTlsHttpServer("""
            {
                "shares": [
                    { "roomName": "channel-1", "userName": "alice", "userId": 10, "sessionId": 1 }
                ]
            }
            """);
            var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: server.Url, certService: certService);
            adapter.RegisterHandlers(bridge);
            certService.RegisterHandlers(bridge);

            using var statusDoc = JsonDocument.Parse("{}");
            await NativeBridgeTestHarness.InvokeAsync(bridge, "cert.requestStatus", statusDoc.RootElement.Clone());
            _ = NativeBridgeTestHarness.DrainMessages(bridge);

            using var doc = JsonDocument.Parse("""
            {
                "roomName": "channel-1",
                "requestId": 42
            }
            """);

            await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.checkActiveShare", doc.RootElement.Clone());
            var sent = NativeBridgeTestHarness.DrainMessages(bridge);

            Assert.IsTrue(sent.Any(x => x.Type == "livekit.activeShareResult" && x.DataJson.Contains("\"requestId\":42")));
        }
        finally
        {
            tempDir.Delete(recursive: true);
        }
    }

    [TestMethod]
    public async Task LiveKitToken_EchoesRequestId()
    {
        var tempDir = Directory.CreateTempSubdirectory();
        try
        {
            var bridge = NativeBridgeTestHarness.Create();
            using var clientCertificate = TestTlsHttpServer.CreateCertificate("CN=client");
            await File.WriteAllBytesAsync(Path.Combine(tempDir.FullName, "Test_test.pfx"), clientCertificate.Export(X509ContentType.Pkcs12));

            var certService = new CertificateService(bridge, new TestAppConfigService(tempDir.FullName));
            await using var server = new TestTlsHttpServer("""
            {
                "token": "jwt",
                "url": "ws://localhost/livekit"
            }
            """);
            var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: server.Url, certService: certService);
            adapter.RegisterHandlers(bridge);
            certService.RegisterHandlers(bridge);

            using var statusDoc = JsonDocument.Parse("{}");
            await NativeBridgeTestHarness.InvokeAsync(bridge, "cert.requestStatus", statusDoc.RootElement.Clone());
            _ = NativeBridgeTestHarness.DrainMessages(bridge);

            using var doc = JsonDocument.Parse("""
            {
                "roomName": "channel-1",
                "accessMode": "subscribe",
                "requestId": 42
            }
            """);

            await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.requestToken", doc.RootElement.Clone());
            var sent = NativeBridgeTestHarness.DrainMessages(bridge);

            Assert.IsTrue(sent.Any(x => x.Type == "livekit.token" && x.DataJson.Contains("\"requestId\":42")));
        }
        finally
        {
            tempDir.Delete(recursive: true);
        }
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_PreservesUnrelatedTokensAndHash()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#vip", "allow": 4, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#event", "allow": 4, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "new-secret");
        using var doc = JsonDocument.Parse(requestJson);
        var root = doc.RootElement;
        var acls = root.GetProperty("acls").EnumerateArray().ToList();

        Assert.AreEqual("known-hash", root.GetProperty("expectedSnapshotHash").GetString());
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "#old-secret"));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "#vip"));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "#event"));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "#new-secret"));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_marker__:#new-secret"));
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_RemovesOnlyManagedTokenWhenPasswordIsCleared()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#vip", "allow": 4, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();

        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "#old-secret"));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_marker__:#old-secret"));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "#vip"));
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_PreservesUnrelatedRulesOnManagedToken()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": true, "inherited": false, "userId": null, "group": "#old-secret", "allow": 4, "deny": 8 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "new-secret");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();

        Assert.IsTrue(acls.Any(a =>
            a.GetProperty("group").GetString() == "#old-secret"
            && a.GetProperty("applySubs").GetBoolean()
            && a.GetProperty("deny").GetInt32() == 8));
        Assert.IsFalse(acls.Any(a =>
            a.GetProperty("group").GetString() == "#old-secret"
            && !a.GetProperty("applySubs").GetBoolean()
            && a.GetProperty("allow").GetInt32() == 6
            && a.GetProperty("deny").GetInt32() == 0));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "#new-secret"));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_marker__:#new-secret"));
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_AddsManagedAllUsersDenyWhenChannelIsOtherwiseOpen()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "new-secret");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();

        Assert.IsTrue(acls.Any(a =>
            a.GetProperty("group").GetString() == "all"
            && a.GetProperty("allow").GetInt32() == 0
            && a.GetProperty("deny").GetInt32() == (0x02 | 0x04 | 0x08 | 0x100 | 0x200 | 0x400 | 0x800)));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_open_block__"));
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_AddsExactlyOrderedPasswordAclBlock()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": true, "inherited": false, "userId": null, "group": "admin", "allow": 1, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "new-secret");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();
        var passwordBlock = acls.TakeLast(3).ToList();

        Assert.AreEqual("all", passwordBlock[0].GetProperty("group").GetString());
        Assert.AreEqual(0, passwordBlock[0].GetProperty("allow").GetInt32());
        Assert.AreEqual(0x02 | 0x04 | 0x08 | 0x100 | 0x200 | 0x400 | 0x800, passwordBlock[0].GetProperty("deny").GetInt32());
        Assert.AreEqual("#new-secret", passwordBlock[1].GetProperty("group").GetString());
        Assert.AreEqual(0x02 | 0x04 | 0x08 | 0x100 | 0x200 | 0x800, passwordBlock[1].GetProperty("allow").GetInt32());
        Assert.AreEqual(0, passwordBlock[1].GetProperty("deny").GetInt32());
        Assert.AreEqual("__brmble_password_marker__:#new-secret", passwordBlock[2].GetProperty("group").GetString());
        Assert.AreEqual(0, passwordBlock[2].GetProperty("allow").GetInt32());
        Assert.AreEqual(0, passwordBlock[2].GetProperty("deny").GetInt32());
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_open_block__"));
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_ChangingPasswordReplacesManagedAclBlock()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "all", "allow": 0, "deny": 3854 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 },
              { "applyHere": true, "applySubs": true, "inherited": false, "userId": null, "group": "vip", "allow": 4, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "new-secret");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();

        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "#old-secret"));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_marker__:#old-secret"));
        Assert.AreEqual(1, acls.Count(a => a.GetProperty("group").GetString() == "all" && a.GetProperty("deny").GetInt32() == 3854));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "vip"));

        var passwordBlock = acls.TakeLast(3).ToList();
        Assert.AreEqual("all", passwordBlock[0].GetProperty("group").GetString());
        Assert.AreEqual("#new-secret", passwordBlock[1].GetProperty("group").GetString());
        Assert.AreEqual("__brmble_password_marker__:#new-secret", passwordBlock[2].GetProperty("group").GetString());
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_ChangingLegacyPasswordAllowMaskWritesExpandedAllowMask()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "all", "allow": 0, "deny": 3854 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "new-secret");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();
        var passwordRule = acls.Single(a => a.GetProperty("group").GetString() == "#new-secret");

        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "#old-secret"));
        Assert.AreEqual(0x02 | 0x04 | 0x08 | 0x100 | 0x200 | 0x800, passwordRule.GetProperty("allow").GetInt32());
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_RemovesManagedAllUsersDenyWhenPasswordIsCleared()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "all", "allow": 0, "deny": 6 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_open_block__", "allow": 0, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();

        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "all" && a.GetProperty("deny").GetInt32() == 6));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "all" && a.GetProperty("deny").GetInt32() == (0x02 | 0x04 | 0x08 | 0x100 | 0x200 | 0x400 | 0x800)));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_open_block__"));
    }

    [TestMethod]
    public void SetChannelPassword_BuildRequest_RemovesManagedAclBlockWhenPasswordIsCleared()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "all", "allow": 0, "deny": 3854 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_open_block__", "allow": 0, "deny": 0 },
              { "applyHere": true, "applySubs": true, "inherited": false, "userId": null, "group": "all", "allow": 0, "deny": 8 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        var requestJson = MumbleAdapter.BuildSetChannelPasswordRequestBody(body, "");
        using var doc = JsonDocument.Parse(requestJson);
        var acls = doc.RootElement.GetProperty("acls").EnumerateArray().ToList();

        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "all" && a.GetProperty("deny").GetInt32() == 3854));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "#old-secret"));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_marker__:#old-secret"));
        Assert.IsFalse(acls.Any(a => a.GetProperty("group").GetString() == "__brmble_password_open_block__"));
        Assert.IsTrue(acls.Any(a => a.GetProperty("group").GetString() == "all" && a.GetProperty("applySubs").GetBoolean() && a.GetProperty("deny").GetInt32() == 8));
    }

    [TestMethod]
    public void TryGetManagedChannelPassword_ReturnsManagedPasswordFromMarkerRule()
    {
        var body = """
        {
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "#old-secret", "allow": 6, "deny": 0 },
              { "applyHere": true, "applySubs": false, "inherited": false, "userId": null, "group": "__brmble_password_marker__:#old-secret", "allow": 0, "deny": 0 }
            ],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null,
            "snapshotHash": "known-hash"
          }
        }
        """;

        Assert.AreEqual("old-secret", MumbleAdapter.TryGetManagedChannelPassword(body));
    }

    [TestMethod]
    public void CreateJoinUserState_IncludesTemporaryAccessTokenOnlyForThisJoin()
    {
        var method = typeof(MumbleAdapter).GetMethod("CreateJoinUserState", BindingFlags.Static | BindingFlags.NonPublic);
        Assert.IsNotNull(method);

        var passwordState = (MumbleProto.UserState)method!.Invoke(null, [4u, "secret-token"])!;
        var normalState = (MumbleProto.UserState)method.Invoke(null, [5u, null])!;

        Assert.AreEqual(4u, passwordState.ChannelId);
        Assert.AreEqual(1, passwordState.TemporaryAccessTokens.Count);
        Assert.AreEqual("secret-token", passwordState.TemporaryAccessTokens.Single());
        Assert.AreEqual(5u, normalState.ChannelId);
        Assert.AreEqual(0, normalState.TemporaryAccessTokens.Count);
    }

    [TestMethod]
    public async Task AclSetChannel_ConflictForwardsStructuredWriteResult()
    {
        var tempDir = Directory.CreateTempSubdirectory();
        try
        {
            var bridge = NativeBridgeTestHarness.Create();
            using var clientCertificate = TestTlsHttpServer.CreateCertificate("CN=client");
            await File.WriteAllBytesAsync(Path.Combine(tempDir.FullName, "Test_test.pfx"), clientCertificate.Export(X509ContentType.Pkcs12));

            var certService = new CertificateService(bridge, new TestAppConfigService(tempDir.FullName));
            await using var server = new TestTlsHttpServer("""
            {
              "success": false,
              "snapshot": {
                "channelId": 4,
                "inheritAcls": true,
                "groups": [],
                "acls": [],
                "fetchedAt": "2026-05-15T12:00:00Z",
                "stale": false,
                "warning": null,
                "snapshotHash": "canonical-hash"
              },
              "warning": null,
              "error": "ACL changed since it was opened."
            }
            """, statusCode: 409);
            var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: server.Url, certService: certService);
            adapter.RegisterHandlers(bridge);
            certService.RegisterHandlers(bridge);

            using var statusDoc = JsonDocument.Parse("{}");
            await NativeBridgeTestHarness.InvokeAsync(bridge, "cert.requestStatus", statusDoc.RootElement.Clone());
            _ = NativeBridgeTestHarness.DrainMessages(bridge);

            using var doc = JsonDocument.Parse("""
            {
              "channelId": 4,
              "request": {
                "inheritAcls": true,
                "groups": [],
                "acls": [],
                "expectedSnapshotHash": "stale-hash"
              }
            }
            """);

            await NativeBridgeTestHarness.InvokeAsync(bridge, "acl.setChannel", doc.RootElement.Clone());
            var sent = NativeBridgeTestHarness.DrainMessages(bridge);

            var writeResult = sent.Single(x => x.Type == "acl.writeResult");
            using var payload = JsonDocument.Parse(writeResult.DataJson);
            Assert.AreEqual(409, payload.RootElement.GetProperty("statusCode").GetInt32());
            Assert.AreEqual(4, payload.RootElement.GetProperty("channelId").GetInt32());
            Assert.IsTrue(payload.RootElement.GetProperty("body").GetString()!.Contains("canonical-hash"));
        }
        finally
        {
            tempDir.Delete(recursive: true);
        }
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_ValidComment_ReturnsUrl()
    {
        var text = """Welcome!<!--brmble:{"apiUrl":"https://noscope.it:1912"}-->""";
        Assert.AreEqual("https://noscope.it:1912", MumbleAdapter.ParseBrmbleApiUrl(text));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_NoComment_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl("Welcome to the server!"));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_NullInput_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl(null));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_MalformedJson_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl("<!--brmble:{bad json}-->"));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_CommentWithHtmlAround_ReturnsUrl()
    {
        var text = "<b>Welcome!</b>\n<!--brmble:{\"apiUrl\":\"https://example.com\"}-->\n<p>Enjoy</p>";
        Assert.AreEqual("https://example.com", MumbleAdapter.ParseBrmbleApiUrl(text));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_SingleQuotedJson_ReturnsUrl()
    {
        var text = "Welcome!<!--brmble:{'apiUrl':'https://noscope.it:1912'}-->";
        Assert.AreEqual("https://noscope.it:1912", MumbleAdapter.ParseBrmbleApiUrl(text));
    }

    [TestMethod]
    public void ParseSessionMappings_WithIsBrmbleClient_RoundTrips()
    {
        var json = JsonDocument.Parse("""
        {
            "1": { "matrixUserId": "@alice:localhost", "mumbleName": "Alice", "isBrmbleClient": true },
            "2": { "matrixUserId": "@bob:localhost", "mumbleName": "Bob", "isBrmbleClient": false }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(2, result.Count);
        Assert.IsTrue(result[1].IsBrmbleClient, "Alice should be a Brmble client");
        Assert.IsFalse(result[2].IsBrmbleClient, "Bob should not be a Brmble client");
        Assert.AreEqual("@alice:localhost", result[1].MatrixUserId);
        Assert.AreEqual("Bob", result[2].MumbleName);
    }

    [TestMethod]
    public void ParseSessionMappings_MissingIsBrmbleClient_DefaultsToFalse()
    {
        var json = JsonDocument.Parse("""
        {
            "5": { "matrixUserId": "@user:localhost", "mumbleName": "User" }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(1, result.Count);
        Assert.IsFalse(result[5].IsBrmbleClient, "Missing isBrmbleClient should default to false");
    }

    [TestMethod]
    public void ParseSessionMappings_SkipsEntriesWithMissingRequiredFields()
    {
        var json = JsonDocument.Parse("""
        {
            "1": { "matrixUserId": "@alice:localhost" },
            "2": { "mumbleName": "Bob" },
            "3": { "matrixUserId": "@charlie:localhost", "mumbleName": "Charlie" }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(1, result.Count, "Only the complete entry should be parsed");
        Assert.IsTrue(result.ContainsKey(3));
    }

    [TestMethod]
    public void ParseSessionMappings_SkipsNonNumericKeys()
    {
        var json = JsonDocument.Parse("""
        {
            "abc": { "matrixUserId": "@x:localhost", "mumbleName": "X" },
            "42": { "matrixUserId": "@y:localhost", "mumbleName": "Y" }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual(1, result.Count);
        Assert.IsTrue(result.ContainsKey(42));
    }

    [TestMethod]
    public void ParseSessionMappings_EmptyObject_ReturnsEmpty()
    {
        var json = JsonDocument.Parse("{}");
        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);
        Assert.AreEqual(0, result.Count);
    }

    [TestMethod]
    public void ParseSessionMappings_WithCompanionId_RoundTrips()
    {
        using var json = JsonDocument.Parse("""
        {
          "42": {
            "matrixUserId": "@alice:test",
            "mumbleName": "Alice",
            "companionId": "pip",
            "isBrmbleClient": true
          }
        }
        """);

        var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

        Assert.AreEqual("pip", result[42].CompanionId);
    }

    // Transmission mode parsing tests
    [TestMethod]
    public void ParseTransmissionMode_PushToTalkPlus_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("pushToTalkPlus");
        Assert.AreEqual(TransmissionMode.PushToTalkPlus, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_PushToTalk_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("pushToTalk");
        Assert.AreEqual(TransmissionMode.PushToTalk, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_VoiceActivity_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("voiceActivity");
        Assert.AreEqual(TransmissionMode.VoiceActivity, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_Continuous_ReturnsCorrectEnum()
    {
        var result = MumbleAdapter.ParseTransmissionMode("continuous");
        Assert.AreEqual(TransmissionMode.Continuous, result);
    }

    [TestMethod]
    public void ParseTransmissionMode_Unknown_DefaultsToContinuous()
    {
        var result = MumbleAdapter.ParseTransmissionMode("invalidMode");
        Assert.AreEqual(TransmissionMode.Continuous, result);
    }

    // DTX behavior tests
    [TestMethod]
    public void ShouldEnableDtx_PushToTalk_ReturnsFalse()
    {
        Assert.IsFalse(MumbleAdapter.ShouldEnableDtx(TransmissionMode.PushToTalk));
    }

    [TestMethod]
    public void ShouldEnableDtx_PushToTalkPlus_ReturnsFalse()
    {
        Assert.IsFalse(MumbleAdapter.ShouldEnableDtx(TransmissionMode.PushToTalkPlus));
    }

    [TestMethod]
    public void ShouldEnableDtx_VoiceActivity_ReturnsTrue()
    {
        Assert.IsTrue(MumbleAdapter.ShouldEnableDtx(TransmissionMode.VoiceActivity));
    }

    [TestMethod]
    public void ShouldEnableDtx_Continuous_ReturnsTrue()
    {
        Assert.IsTrue(MumbleAdapter.ShouldEnableDtx(TransmissionMode.Continuous));
    }

    [TestMethod]
    public async Task VoiceGetAudioDevices_EmitsDefaultDeviceEntries()
    {
        var bridge = NativeBridgeTestHarness.Create();
        using var audioManager = new AudioManager();
        var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, audioManager: audioManager);
        adapter.RegisterHandlers(bridge);

        using var doc = JsonDocument.Parse("{}");
        await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.getAudioDevices", doc.RootElement.Clone());
        var sent = NativeBridgeTestHarness.DrainMessages(bridge);

        var payloadJson = sent.Single(x => x.Type == "voice.audioDevices").DataJson;
        using var payload = JsonDocument.Parse(payloadJson);
        Assert.AreEqual("default", payload.RootElement.GetProperty("input")[0].GetProperty("id").GetString());
        Assert.AreEqual("default", payload.RootElement.GetProperty("output")[0].GetProperty("id").GetString());
    }

    [TestMethod]
    public void RepairAudioDeviceSettings_InvalidAudioDevices_AreRepairedToDefault()
    {
        var settings = AppSettings.Default with
        {
            Audio = AppSettings.Default.Audio with
            {
                InputDevice = "missing-input-device",
                OutputDevice = "missing-output-device",
                CaptureApi = "waveIn",
            }
        };

        var (repaired, didRepair) = MumbleAdapter.RepairAudioDeviceSettings(
            settings,
            _ => false,
            _ => false,
            _ => { });

        Assert.IsTrue(didRepair);
        Assert.AreEqual("default", repaired.Audio.InputDevice);
        Assert.AreEqual("default", repaired.Audio.OutputDevice);
    }
}
