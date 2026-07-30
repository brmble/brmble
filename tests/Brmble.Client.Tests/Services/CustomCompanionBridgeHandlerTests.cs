using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class CustomCompanionBridgeHandlerTests
{
    private NativeBridge _bridge = null!;
    private X509Certificate2 _certificate = null!;
    private CustomCompanionBridgeHandler _handler = null!;
    private Uri? _postUri;
    private string _postBody = string.Empty;
    private Uri? _deleteUri;

    [TestInitialize]
    public void Initialize()
    {
        _bridge = NativeBridgeTestHarness.Create();
        _certificate = CreateCertificate();
        _handler = new CustomCompanionBridgeHandler(
            _bridge,
            () => _certificate,
            () => "https://api.test/",
            (_, uri, body) =>
            {
                _postUri = uri;
                _postBody = body;
                return Task.FromResult(new CustomCompanionBridgeHandler.TlsCallResult(true, "{\"eventId\":\"$sprite:test\"}", 201, null));
            },
            (_, uri) =>
            {
                _deleteUri = uri;
                return Task.FromResult(new CustomCompanionBridgeHandler.TlsCallResult(true, null, 204, null));
            });
    }

    [TestCleanup]
    public void Cleanup() => _certificate.Dispose();

    [TestMethod]
    public async Task Create_ForwardsOnlyNameAndMxcUri()
    {
        using var request = JsonDocument.Parse(
            """{"requestId":4,"action":"create","name":"Orbit","mediaUri":"mxc://test/media","width":64,"height":64,"mimeType":"image/png"}""");

        await _handler.HandleAsync(request.RootElement);

        Assert.AreEqual(new Uri("https://api.test/companions"), _postUri);
        StringAssert.Contains(_postBody, "\"name\":\"Orbit\"");
        StringAssert.Contains(_postBody, "\"mediaUri\":\"mxc://test/media\"");
        Assert.IsFalse(_postBody.Contains("width", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(_postBody.Contains("height", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(_postBody.Contains("mimeType", StringComparison.OrdinalIgnoreCase));
        AssertResponse("companions.response", requestId: 4, success: true, statusCode: 201);
    }

    [TestMethod]
    public async Task Delete_EncodesMatrixEventId()
    {
        using var request = JsonDocument.Parse(
            """{"requestId":5,"action":"delete","eventId":"$sprite:test"}""");

        await _handler.HandleAsync(request.RootElement);

        Assert.AreEqual(
            new Uri("https://api.test/companions/%24sprite%3Atest"),
            _deleteUri);
        AssertResponse("companions.response", requestId: 5, success: true, statusCode: 204);
    }

    [TestMethod]
    public async Task Create_PreservesValidationFailureResponse()
    {
        _handler = new CustomCompanionBridgeHandler(
            _bridge,
            () => _certificate,
            () => "https://api.test/",
            (_, _, _) => Task.FromResult(new CustomCompanionBridgeHandler.TlsCallResult(
                false, "{\"error\":\"unsupported image\"}", 415, "unsupported image")),
            (_, _) => throw new AssertFailedException("DELETE should not be called"));
        using var request = JsonDocument.Parse(
            """{"requestId":6,"action":"create","name":"Orbit","mediaUri":"mxc://test/media"}""");

        await _handler.HandleAsync(request.RootElement);

        var response = NativeBridgeTestHarness.DrainMessages(_bridge).Single();
        Assert.AreEqual("companions.response", response.Type);
        using var document = JsonDocument.Parse(response.DataJson);
        Assert.IsFalse(document.RootElement.GetProperty("success").GetBoolean());
        Assert.AreEqual(415, document.RootElement.GetProperty("statusCode").GetInt32());
        Assert.AreEqual("{\"error\":\"unsupported image\"}", document.RootElement.GetProperty("body").GetString());
        Assert.AreEqual("unsupported image", document.RootElement.GetProperty("error").GetString());
    }

    [DataTestMethod]
    [DataRow("{\"requestId\":4.5,\"action\":\"create\"}")]
    [DataRow("{\"requestId\":2147483648,\"action\":\"create\"}")]
    [DataRow("{\"requestId\":7,\"action\":42}")]
    public async Task MalformedRequest_AlwaysEmitsFailureResponse(string requestJson)
    {
        using var request = JsonDocument.Parse(requestJson);

        await _handler.HandleAsync(request.RootElement);

        var response = NativeBridgeTestHarness.DrainMessages(_bridge).Single();
        Assert.AreEqual("companions.response", response.Type);
        using var document = JsonDocument.Parse(response.DataJson);
        Assert.IsFalse(document.RootElement.GetProperty("success").GetBoolean());
        Assert.AreEqual(0, document.RootElement.GetProperty("statusCode").GetInt32());
        Assert.IsTrue(document.RootElement.TryGetProperty("error", out var error));
        Assert.IsFalse(string.IsNullOrWhiteSpace(error.GetString()));
    }

    [TestMethod]
    public async Task Create_RejectsNonHttpsApiUrlWithoutCallingTransport()
    {
        var transportCalled = false;
        _handler = new CustomCompanionBridgeHandler(
            _bridge,
            () => _certificate,
            () => "http://api.test/",
            (_, _, _) =>
            {
                transportCalled = true;
                return Task.FromResult(new CustomCompanionBridgeHandler.TlsCallResult(true, null, 201, null));
            },
            (_, _) => throw new AssertFailedException("DELETE should not be called"));
        using var request = JsonDocument.Parse(
            """{"requestId":8,"action":"create","name":"Orbit","mediaUri":"mxc://test/media"}""");

        await _handler.HandleAsync(request.RootElement);

        Assert.IsFalse(transportCalled);
        AssertResponse("companions.response", requestId: 8, success: false, statusCode: 0);
    }

    private void AssertResponse(string type, int requestId, bool success, int statusCode)
    {
        var response = NativeBridgeTestHarness.DrainMessages(_bridge).Single();
        Assert.AreEqual(type, response.Type);
        using var document = JsonDocument.Parse(response.DataJson);
        Assert.AreEqual(requestId, document.RootElement.GetProperty("requestId").GetInt32());
        Assert.AreEqual(success, document.RootElement.GetProperty("success").GetBoolean());
        Assert.AreEqual(statusCode, document.RootElement.GetProperty("statusCode").GetInt32());
    }

    private static X509Certificate2 CreateCertificate()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=custom-companion-test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(1));
    }
}
