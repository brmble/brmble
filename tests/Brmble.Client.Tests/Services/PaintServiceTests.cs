using System.Security.Cryptography.X509Certificates;
using System.Security.Cryptography;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Paint;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public sealed class PaintServiceTests
{
    [TestMethod]
    public async Task PaintRequest_ForwardsSnapshotAndCorrelatesResponse()
    {
        var bridge = NativeBridgeTestHarness.Create();
        using var key = RSA.Create(2048);
        var certificateRequest = new CertificateRequest("CN=paint-test", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var certificate = certificateRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(1));
        var service = new PaintService(
            bridge,
            () => certificate,
            () => "https://api.example.com",
            (_, uri) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(
                true, "{\"sessionId\":\"11111111-1111-1111-1111-111111111111\"}", 200, null)),
            (_, _, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, null, 200, null)));
        service.RegisterHandlers(bridge);

        using var request = JsonDocument.Parse("""{ "action": "snapshot", "sessionId": "11111111-1111-1111-1111-111111111111", "requestId": 7 }""");
        await NativeBridgeTestHarness.InvokeAsync(bridge, "paint.request", request.RootElement.Clone());

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        var response = sent.Single(message => message.Type == "paint.response");
        Assert.IsTrue(response.DataJson.Contains("\"requestId\":7", StringComparison.Ordinal));
        Assert.IsTrue(response.DataJson.Contains("\"statusCode\":200", StringComparison.Ordinal));
    }

    [TestMethod]
    public async Task PaintMutationFailure_DoesNotEmitUncorrelatedResponse()
    {
        var bridge = NativeBridgeTestHarness.Create();
        using var key = RSA.Create(2048);
        var certificateRequest = new CertificateRequest("CN=paint-test", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var certificate = certificateRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(1));
        var service = new PaintService(bridge, () => certificate, () => "https://api.example.com",
            (_, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(true, null, 200, null)),
            (_, _, _) => Task.FromResult(new ChannelRequestBridgeHandler.TlsCallResult(false, null, 403, "forbidden")));
        service.RegisterHandlers(bridge);

        using var request = JsonDocument.Parse("{ \"sessionId\": \"11111111-1111-1111-1111-111111111111\" }");
        await NativeBridgeTestHarness.InvokeAsync(bridge, "paint.join", request.RootElement.Clone());

        var sent = NativeBridgeTestHarness.DrainMessages(bridge);
        Assert.IsFalse(sent.Any(message => message.Type == "paint.response"));
    }
}
