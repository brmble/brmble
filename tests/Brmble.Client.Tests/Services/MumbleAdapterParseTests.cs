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
using Microsoft.VisualStudio.TestTools.UnitTesting;

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
    public static MumbleAdapter CreateWithBridge(NativeBridge bridge, string? apiUrl = null, CertificateService? certService = null)
    {
        var adapter = (MumbleAdapter)RuntimeHelpers.GetUninitializedObject(typeof(MumbleAdapter));
        SetField(adapter, "_bridge", bridge);
        SetField(adapter, "_apiUrl", apiUrl);
        SetField(adapter, "_certService", certService);
        return adapter;
    }

    private static void SetField(object instance, string name, object? value)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);
}

internal sealed class TestAppConfigService : IAppConfigService
{
    private readonly string _certsDir;

    public TestAppConfigService(string certsDir) => _certsDir = certsDir;

    public bool IsFirstLaunch => false;
    public IReadOnlyList<ServerEntry> GetServers() => [];
    public void AddServer(ServerEntry server) { }
    public ServerEntry? UpdateServer(ServerEntry server) => server;
    public void RemoveServer(string id) { }
    public AppSettings GetSettings() => AppSettings.Default;
    public void SetSettings(AppSettings settings) { }
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

internal sealed class TestTlsHttpServer : IAsyncDisposable
{
    private readonly TcpListener _listener;
    private readonly X509Certificate2 _serverCertificate;
    private readonly Task _serverTask;
    private readonly CancellationTokenSource _cts = new();

    public string Url { get; }

    public TestTlsHttpServer(string responseBody)
    {
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
        var header = $"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {bodyBytes.Length}\r\nConnection: close\r\n\r\n";
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
}
