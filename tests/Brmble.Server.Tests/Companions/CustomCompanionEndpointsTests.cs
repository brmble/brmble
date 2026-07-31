using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Brmble.Server.Matrix;
using Brmble.Server.Companions;
using Brmble.Server.Tests.Integration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Companions;

[TestClass]
public sealed class CustomCompanionEndpointsTests : IDisposable
{
    private BrmbleServerFactory _factory = null!;
    private HttpClient _client = null!;
    private Mock<IMatrixAppService> _matrix = null!;

    [TestInitialize]
    public void Setup()
    {
        _factory = new BrmbleServerFactory();
        _client = _factory.CreateClient();
        _matrix = _factory.MatrixAppMock;
        _matrix.Setup(service => service.CreateCustomCompanionGalleryRoom())
            .ReturnsAsync("!gallery:test");
        _matrix.Setup(service => service.SendStateEvent(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync("$sprite:test");
    }

    [TestMethod]
    public async Task Create_ValidPngPublishesServerDerivedMetadata()
    {
        _matrix.Setup(service => service.DownloadMedia(
                "mxc://test/media", 5_242_881, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CustomCompanionImageValidatorTests.FixtureBytes("valid.png"));

        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = " Orbit ", mediaUri = "mxc://test/media" });

        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        _matrix.Verify(service => service.SendStateEvent(
            "!gallery:test", "im.brmble.sprite", It.IsAny<string>(),
            It.Is<string>(json =>
                json.Contains("\"uploaderMatrixUserId\":\"@alice:test\"") &&
                json.Contains("\"mimeType\":\"image/png\"") &&
                json.Contains("\"width\":") && json.Contains("\"height\":") &&
                json.Contains("\"frameCount\":1") &&
                !json.Contains("reportedWidth") && !json.Contains("reportedHeight"))), Times.Once);
    }

    [TestMethod]
    public async Task Create_UnsupportedImageReturns415AndWritesNoState()
    {
        _matrix.Setup(service => service.DownloadMedia(
                "mxc://test/text", 5_242_881, It.IsAny<CancellationToken>()))
            .ReturnsAsync("not an image"u8.ToArray());

        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = "Text", mediaUri = "mxc://test/text" });

        Assert.AreEqual(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        Assert.AreEqual("unsupported_file_type", (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString());
        VerifyNoStateWritten();
    }

    [DataTestMethod]
    [DataRow("truncated.png", HttpStatusCode.UnprocessableEntity, "invalid_image")]
    [DataRow("oversized-width.png", HttpStatusCode.UnprocessableEntity, "invalid_image")]
    [DataRow("animated.webp", HttpStatusCode.UnprocessableEntity, "animated_image_not_supported")]
    public async Task Create_RecognizedButInvalidImageReturns422AndWritesNoState(
        string fixture,
        HttpStatusCode expectedStatus,
        string expectedCode)
    {
        _matrix.Setup(service => service.DownloadMedia(
                It.IsAny<string>(), 5_242_881, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CustomCompanionImageValidatorTests.FixtureBytes(fixture));

        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = "Unsafe", mediaUri = $"mxc://test/{fixture}" });

        Assert.AreEqual(expectedStatus, response.StatusCode);
        Assert.AreEqual(expectedCode, (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString());
        VerifyNoStateWritten();
    }

    [TestMethod]
    public async Task Create_BytesAboveTransferLimitNeverWriteGalleryState()
    {
        _matrix.Setup(service => service.DownloadMedia(
                "mxc://test/large", 5_242_881, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidDataException("media exceeds byte limit"));

        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = "Large", mediaUri = "mxc://test/large" });

        Assert.AreEqual(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        VerifyNoStateWritten();
    }

    [TestMethod]
    public async Task Create_RequiresACertificateBoundUser()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/companions", new { name = "Unauthenticated", mediaUri = "mxc://test/media" });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task Create_RejectsUntrustedMediaUriBeforeDownload()
    {
        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = "Bad Uri", mediaUri = "mxc://other/media" });

        Assert.AreEqual(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.AreEqual("invalid_media_uri", (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString());
        _matrix.Verify(service => service.DownloadMedia(
            It.IsAny<string>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task Create_RejectsInvalidNameBeforeDownload()
    {
        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = "bad!", mediaUri = "mxc://test/media" });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.AreEqual("invalid_name", (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString());
        _matrix.Verify(service => service.DownloadMedia(
            It.IsAny<string>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task Create_AtUserLimitReturns409BeforeDownload()
    {
        var repository = _factory.Services.GetRequiredService<CustomCompanionRepository>();
        await repository.SetRoomIdAsync("!gallery:test");
        for (var index = 0; index < 10; index++)
        {
            await repository.InsertAsync(new CustomCompanionRecord(
                $"$existing:{index}", $"existing-{index}", "!gallery:test", 1, "@alice:test", "Alice",
                "Existing", "mxc://test/existing", "image/png", 1, 1, 1, 1,
                DateTimeOffset.UtcNow, null, null));
        }

        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = "Full", mediaUri = "mxc://test/media" });

        Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode);
        Assert.AreEqual("user_limit", (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString());
        _matrix.Verify(service => service.DownloadMedia(
            It.IsAny<string>(), It.IsAny<long>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task Create_PersistenceFailureRedactsPublishedStateAndReturns503()
    {
        var repository = _factory.Services.GetRequiredService<CustomCompanionRepository>();
        await repository.SetRoomIdAsync("!gallery:test");
        await repository.InsertAsync(new CustomCompanionRecord(
            "$sprite:test", "existing", "!gallery:test", 2, "@other:test", "Other",
            "Existing", "mxc://test/existing", "image/png", 1, 1, 1, 1,
            DateTimeOffset.UtcNow, null, null));
        _matrix.Setup(service => service.DownloadMedia(
                "mxc://test/media", 5_242_881, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CustomCompanionImageValidatorTests.FixtureBytes("valid.png"));

        var response = await _client.PostAsJsonAsync(
            "/companions", new { name = "Orbit", mediaUri = "mxc://test/media" });

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        _matrix.Verify(service => service.RedactRoomEvent(
            "!gallery:test", "$sprite:test", It.IsAny<string>()), Times.Once);
    }

    [TestMethod]
    public async Task Create_UsesConfiguredRateLimit()
    {
        _matrix.Setup(service => service.DownloadMedia(
                "mxc://test/media", 5_242_881, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CustomCompanionImageValidatorTests.FixtureBytes("valid.png"));
        _matrix.Setup(service => service.SendStateEvent(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync(() => "$sprite:" + Guid.NewGuid().ToString("N"));

        for (var attempt = 0; attempt < 5; attempt++)
        {
            var response = await _client.PostAsJsonAsync(
                "/companions", new { name = $"Sprite{attempt}", mediaUri = "mxc://test/media" });
            Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        }

        var rejected = await _client.PostAsJsonAsync(
            "/companions", new { name = "Sprite6", mediaUri = "mxc://test/media" });
        Assert.AreEqual(HttpStatusCode.TooManyRequests, rejected.StatusCode);
    }

    [TestCleanup]
    public void Cleanup()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    public void Dispose() => Cleanup();

    private void VerifyNoStateWritten() => _matrix.Verify(service => service.SendStateEvent(
        It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
}
