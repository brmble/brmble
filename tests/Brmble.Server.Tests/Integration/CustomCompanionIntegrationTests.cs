using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Brmble.Server.Companions;
using Brmble.Server.Tests.Companions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using SkiaSharp;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public sealed class CustomCompanionIntegrationTests : IDisposable
{
    private BrmbleServerFactory _factory = null!;
    private HttpClient _client = null!;

    [TestInitialize]
    public void Setup()
    {
        _factory = new BrmbleServerFactory();
        _client = _factory.CreateClient();
    }

    [DataTestMethod]
    [DataRow("valid.png", "image/png")]
    [DataRow("valid.webp", "image/webp")]
    public async Task Upload_ValidStillImagePersistsServerMetadata(
        string fixtureName,
        string expectedMimeType)
    {
        var upload = await UploadSpriteAsAlice(fixtureName);

        Assert.AreEqual(expectedMimeType, upload.MimeType);
        Assert.AreEqual(1, upload.FrameCount);
        Assert.IsTrue(upload.Width > 0);
        Assert.IsTrue(upload.Height > 0);
        Assert.AreEqual(1, await _factory.Gallery.CountActiveAsync());
        Assert.AreEqual(1, _factory.Matrix.SentSpriteEventCount);
    }

    [TestMethod]
    public async Task Upload_UnsupportedImageCreatesNoGalleryEntry()
    {
        await AssertRejectedUpload(
            "not an image"u8.ToArray(),
            HttpStatusCode.UnsupportedMediaType,
            "unsupported_file_type");
    }

    [DataTestMethod]
    [DataRow("truncated.png")]
    [DataRow("truncated.webp")]
    public async Task Upload_CorruptImageCreatesNoGalleryEntry(string fixtureName)
    {
        await AssertRejectedUpload(
            CustomCompanionImageValidatorTests.FixtureBytes(fixtureName),
            HttpStatusCode.UnprocessableEntity,
            "invalid_image");
    }

    [TestMethod]
    public async Task Upload_OversizedDimensionCreatesNoGalleryEntry()
    {
        await AssertRejectedUpload(
            CreateStillPng(4_097, 1),
            HttpStatusCode.UnprocessableEntity,
            "unsafe_image_dimensions");
    }

    [TestMethod]
    public async Task Upload_OverPixelBudgetCreatesNoGalleryEntry()
    {
        await AssertRejectedUpload(
            CreateStillPng(4_000, 4_000),
            HttpStatusCode.UnprocessableEntity,
            "unsafe_image_dimensions");
    }

    [DataTestMethod]
    [DataRow("animated.png")]
    [DataRow("animated.webp")]
    public async Task Upload_AnimatedImageCreatesNoGalleryEntry(string fixtureName)
    {
        await AssertRejectedUpload(
            CustomCompanionImageValidatorTests.FixtureBytes(fixtureName),
            HttpStatusCode.UnprocessableEntity,
            "animated_image_not_supported");
    }

    [TestMethod]
    public async Task UploadSelectDelete_FallsBackAndRemainsDeletedAfterReconnect()
    {
        var upload = await UploadSpriteAsAlice();
        await SelectAsAlice($"custom:{upload.EventId}");

        var firstDelete = await DeleteAsModerator(upload.EventId);

        Assert.AreEqual(HttpStatusCode.NoContent, firstDelete.StatusCode);
        Assert.AreEqual("floppy", await _factory.Users.GetCompanionId(_factory.AliceUserId));
        Assert.IsNull(await _factory.Gallery.GetActiveByEventIdAsync(upload.EventId));
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await DeleteAsModerator(upload.EventId)).StatusCode);
        var payload = await AuthenticateAlice();
        Assert.AreEqual(
            "floppy",
            payload.GetProperty("matrix")
                .GetProperty("customCompanions")
                .GetProperty("selectedCompanionId")
                .GetString());
    }

    [TestMethod]
    public async Task Auth_OlderFeatureFailureStillReturnsMatrixAndBuiltIns()
    {
        _factory.Matrix.FailGalleryRoomCreation = true;

        var payload = await AuthenticateAlice();

        Assert.IsTrue(payload.GetProperty("matrix").TryGetProperty("accessToken", out _));
        Assert.IsFalse(payload.GetProperty("matrix").TryGetProperty("customCompanions", out _));
    }

    [TestMethod]
    public async Task Auth_GalleryJoinFailureDoesNotAdvertiseCapability()
    {
        _factory.Matrix.GalleryJoinSucceeds = false;

        var payload = await AuthenticateAlice();

        Assert.IsTrue(payload.GetProperty("matrix").TryGetProperty("accessToken", out _));
        Assert.IsFalse(payload.GetProperty("matrix").TryGetProperty("customCompanions", out _));
    }

    [TestCleanup]
    public void Cleanup()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    public void Dispose() => Cleanup();

    private async Task<HttpResponseMessage> PostSpriteAsAlice(byte[] bytes)
    {
        _factory.Matrix.QueueMedia(bytes);
        return await _client.PostAsJsonAsync(
            "/companions",
            new { name = "Orbit", mediaUri = "mxc://test/queued-media" });
    }

    private Task<CustomCompanionRecord> UploadSpriteAsAlice() =>
        UploadSpriteAsAlice("valid.png");

    private async Task<CustomCompanionRecord> UploadSpriteAsAlice(string fixtureName)
    {
        var response = await PostSpriteAsAlice(
            CustomCompanionImageValidatorTests.FixtureBytes(fixtureName));
        Assert.AreEqual(HttpStatusCode.Created, response.StatusCode);
        var record = await response.Content.ReadFromJsonAsync<CustomCompanionRecord>();
        Assert.IsNotNull(record);
        Assert.IsTrue(record.Width > 0);
        Assert.IsTrue(record.Height > 0);
        Assert.AreEqual(1, record.FrameCount);
        Assert.IsTrue(record.MimeType is "image/png" or "image/webp");
        return record;
    }

    private async Task SelectAsAlice(string companionId)
    {
        var response = await _client.PostAsJsonAsync(
            "/auth/companion",
            new { companionId });
        response.EnsureSuccessStatusCode();
    }

    private Task<HttpResponseMessage> DeleteAsModerator(string eventId) =>
        _client.DeleteAsync($"/companions/{Uri.EscapeDataString(eventId)}");

    private async Task<JsonElement> AuthenticateAlice()
    {
        var response = await _client.PostAsJsonAsync(
            "/auth/token",
            new { mumbleUsername = "Alice" });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private async Task AssertRejectedUpload(
        byte[] bytes,
        HttpStatusCode expectedStatus,
        string expectedCode)
    {
        var response = await PostSpriteAsAlice(bytes);

        Assert.AreEqual(expectedStatus, response.StatusCode);
        Assert.AreEqual(
            expectedCode,
            (await response.Content.ReadFromJsonAsync<JsonElement>())
                .GetProperty("code")
                .GetString());
        Assert.AreEqual(0, await _factory.Gallery.CountActiveAsync());
        Assert.AreEqual(0, _factory.Matrix.SentSpriteEventCount);
    }

    private static byte[] CreateStillPng(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height);
        bitmap.Erase(SKColors.Transparent);
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
