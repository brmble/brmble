using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Services.Messages;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public sealed class MessageServiceTests
{
    [TestMethod]
    public async Task Delete_ForwardsExactPathAndBody()
    {
        Uri? calledUri = null;
        string? calledBody = null;
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = CreateService(
            bridge,
            cert,
            (uri, body) =>
            {
                calledUri = uri;
                calledBody = body;
                return new(true, "{\"status\":\"deleted\"}", 200, null);
            });
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(
            bridge,
            "messages.delete",
            JsonSerializer.SerializeToElement(new
            {
                requestId = 17,
                roomId = "!general:test",
                eventId = "$message:test"
            }));

        Assert.AreEqual(
            new Uri("https://api.example/messages/delete"),
            calledUri);
        using var bodyDocument = JsonDocument.Parse(calledBody!);
        Assert.AreEqual(
            "!general:test",
            bodyDocument.RootElement.GetProperty("roomId").GetString());
        Assert.AreEqual(
            "$message:test",
            bodyDocument.RootElement.GetProperty("eventId").GetString());
    }

    [TestMethod]
    public async Task Delete_ReturnsCorrelatedStructuredFailure()
    {
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = CreateService(
            bridge,
            cert,
            (_, _) => new(
                false,
                "{\"code\":\"expired\",\"error\":\"Messages can only be deleted within 24 hours.\"}",
                410,
                "Gone"));
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(
            bridge,
            "messages.delete",
            JsonSerializer.SerializeToElement(new
            {
                requestId = 73,
                roomId = "!general:test",
                eventId = "$message:test"
            }));

        var response = NativeBridgeTestHarness
            .DrainMessages(bridge)
            .Single(message => message.Type == "messages.response");
        using var document = JsonDocument.Parse(response.DataJson);

        Assert.AreEqual(
            73,
            document.RootElement.GetProperty("requestId").GetInt32());
        Assert.IsFalse(
            document.RootElement.GetProperty("success").GetBoolean());
        Assert.AreEqual(
            410,
            document.RootElement.GetProperty("statusCode").GetInt32());
        Assert.AreEqual(
            "expired",
            JsonDocument.Parse(
                    document.RootElement.GetProperty("body").GetString()!)
                .RootElement.GetProperty("code").GetString());
    }

    [TestMethod]
    public async Task Delete_WithoutApiUrl_ReturnsCorrelatedFailure()
    {
        using var cert = CreateCertificate();
        var bridge = NativeBridgeTestHarness.Create();
        var service = new MessageService(
            bridge,
            getCertificate: () => cert,
            getApiUrl: () => null,
            postJsonAsync: (_, _, _) =>
                Task.FromResult(
                    new ChannelRequestBridgeHandler.TlsCallResult(
                        true, "{}", 200, null)));
        service.RegisterHandlers(bridge);

        await NativeBridgeTestHarness.InvokeAsync(
            bridge,
            "messages.delete",
            JsonSerializer.SerializeToElement(new
            {
                requestId = 5,
                roomId = "!general:test",
                eventId = "$message:test"
            }));

        var response = NativeBridgeTestHarness
            .DrainMessages(bridge)
            .Single(message => message.Type == "messages.response");
        using var document = JsonDocument.Parse(response.DataJson);
        Assert.IsFalse(
            document.RootElement.GetProperty("success").GetBoolean());
        StringAssert.Contains(
            document.RootElement.GetProperty("error").GetString(),
            "Not connected");
    }

    private static MessageService CreateService(
        Brmble.Client.Bridge.NativeBridge bridge,
        X509Certificate2 certificate,
        Func<Uri, string, ChannelRequestBridgeHandler.TlsCallResult> post) =>
        new(
            bridge,
            () => certificate,
            () => "https://api.example/",
            (_, uri, body) => Task.FromResult(post(uri, body)));

    private static X509Certificate2 CreateCertificate()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(
            "CN=MessageServiceTests",
            rsa,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        return request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-1),
            DateTimeOffset.UtcNow.AddMinutes(5));
    }
}
