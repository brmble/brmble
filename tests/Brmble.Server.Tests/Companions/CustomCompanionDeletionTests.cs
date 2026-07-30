using System.Net;
using Brmble.Server.Companions;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Tests.Integration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Companions;

[TestClass]
public sealed class CustomCompanionDeletionTests : IDisposable
{
    private readonly BrmbleServerFactory _factory = new();
    private readonly HttpClient _client;

    public CustomCompanionDeletionTests() => _client = _factory.CreateClient();

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task Delete_RequiresRootKickOrBan()
    {
        await InsertActiveAsync();
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(false);

        var response = await _client.DeleteAsync("/companions/%24sprite%3Atest");

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
        _factory.MatrixAppMock.Verify(service => service.RedactRoomEvent(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [TestMethod]
    public async Task Delete_ActiveRecordRedactsResetsSelectionAndBroadcasts()
    {
        await InsertActiveAsync();
        var repository = _factory.Services.GetRequiredService<CustomCompanionRepository>();
        _factory.SessionMappingMock.Object.TryAddMatrixUser(42, "@alice:test", "Alice", 1, "custom:$sprite:test");
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(true);
        _factory.MatrixAppMock.Setup(service => service.RedactRoomEvent("!gallery:test", "$sprite:test", It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var response = await _client.DeleteAsync("/companions/%24sprite%3Atest");

        Assert.AreEqual(HttpStatusCode.NoContent, response.StatusCode);
        Assert.IsNull(await repository.GetActiveByEventIdAsync("$sprite:test"));
        _factory.SessionMappingMock.Verify(service => service.TryUpdateCompanionId(42, "floppy"), Times.Once);
    }

    [TestMethod]
    public async Task Delete_AlreadyDeletedRecordIsIdempotentWithoutSecondRedaction()
    {
        await InsertActiveAsync();
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(true);
        _factory.MatrixAppMock.Setup(service => service.RedactRoomEvent(
                "!gallery:test", "$sprite:test", It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        Assert.AreEqual(HttpStatusCode.NoContent,
            (await _client.DeleteAsync("/companions/%24sprite%3Atest")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NoContent,
            (await _client.DeleteAsync("/companions/%24sprite%3Atest")).StatusCode);
        _factory.MatrixAppMock.Verify(service => service.RedactRoomEvent(
            "!gallery:test", "$sprite:test", It.IsAny<string>()), Times.Once);
    }

    [TestMethod]
    public async Task Delete_MatrixRedactionFailureKeepsRecordActiveAndReturns503()
    {
        await InsertActiveAsync();
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(true);
        _factory.MatrixAppMock.Setup(service => service.RedactRoomEvent(
                "!gallery:test", "$sprite:test", It.IsAny<string>()))
            .ThrowsAsync(new HttpRequestException("Matrix unavailable"));

        var response = await _client.DeleteAsync("/companions/%24sprite%3Atest");

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.IsNotNull(await _factory.Services.GetRequiredService<CustomCompanionRepository>()
            .GetActiveByEventIdAsync("$sprite:test"));
    }

    private async Task InsertActiveAsync()
    {
        var repository = _factory.Services.GetRequiredService<CustomCompanionRepository>();
        await repository.InsertAsync(new CustomCompanionRecord(
            "$sprite:test", "sprite", "!gallery:test", 1, "@alice:test", "Alice",
            "Orbit", "mxc://test/media", "image/png", 1, 1, 1, 1,
            DateTimeOffset.UtcNow, null, null));
        await _factory.Services.GetRequiredService<Brmble.Server.Auth.UserRepository>()
            .SetCompanionId(1, "custom:$sprite:test");
    }
}
