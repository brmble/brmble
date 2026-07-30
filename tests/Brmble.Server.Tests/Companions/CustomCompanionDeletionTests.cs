using System.Net;
using System.Text.Json;
using Brmble.Server.Companions;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Tests.Integration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Companions;

[TestClass]
public sealed class CustomCompanionDeletionTests : IDisposable
{
    private readonly CompanionDeletionFactory _factory = new();
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
        _factory.SessionMappingMock.Verify(service => service.TryUpdateCompanionIdIfCurrent(
            42, "custom:$sprite:test", "floppy"), Times.Once);
    }

    [TestMethod]
    public async Task Delete_ActiveRecordBroadcastsFloppyChangeToAffectedUserChannel()
    {
        await InsertActiveAsync();
        _factory.SessionMappingMock.Object.TryAddMatrixUser(42, "@alice:test", "Alice", 1, "custom:$sprite:test");
        _factory.Services.GetRequiredService<IChannelMembershipService>().Update(42, 7);
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(true);
        _factory.MatrixAppMock.Setup(service => service.RedactRoomEvent(
                "!gallery:test", "$sprite:test", It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        var response = await _client.DeleteAsync("/companions/%24sprite%3Atest");

        Assert.AreEqual(HttpStatusCode.NoContent, response.StatusCode);
        _factory.EventBusMock.Verify(bus => bus.BroadcastToChannelAsync(7, It.Is<object>(payload =>
            JsonSerializer.Serialize(payload) ==
            "{\"type\":\"companionChanged\",\"sessionId\":42,\"matrixUserId\":\"@alice:test\",\"companionId\":\"floppy\",\"customCompanionId\":null}")), Times.Once);
    }

    [TestMethod]
    public async Task Delete_DoesNotOverwriteOrBroadcastWhenLiveSelectionChangesAfterReset()
    {
        await InsertActiveAsync();
        var userRepository = _factory.Services.GetRequiredService<Brmble.Server.Auth.UserRepository>();
        _factory.SessionMappingMock.Object.TryAddMatrixUser(42, "@alice:test", "Alice", 1, "custom:$sprite:test");
        _factory.Services.GetRequiredService<IChannelMembershipService>().Update(42, 7);
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(true);
        _factory.MatrixAppMock.Setup(service => service.RedactRoomEvent(
                "!gallery:test", "$sprite:test", It.IsAny<string>()))
            .Returns(Task.CompletedTask);
        _factory.SessionMappingMock.Setup(service => service.TryGetMappingByUserId(
                1, out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
            .Callback(() =>
            {
                userRepository.SetCompanionId(1, "bee").GetAwaiter().GetResult();
                _factory.SessionMappingMock.Object.TryUpdateCompanionId(42, "bee");
            })
            .Returns((long userId, out int sessionId, out SessionMapping? mapping) =>
            {
                sessionId = 42;
                mapping = new SessionMapping("@alice:test", "Alice", userId, "bee");
                return true;
            });

        var response = await _client.DeleteAsync("/companions/%24sprite%3Atest");

        Assert.AreEqual(HttpStatusCode.NoContent, response.StatusCode);
        Assert.AreEqual("bee", await userRepository.GetCompanionId(1));
        Assert.AreEqual("bee", _factory.SessionMappingMock.Object.GetSnapshot()[42].CompanionId);
        _factory.EventBusMock.Verify(bus => bus.BroadcastToChannelAsync(7, It.IsAny<object>()), Times.Never);
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

    [TestMethod]
    public async Task Delete_ConcurrentRequestsRedactOnlyOnce()
    {
        await InsertActiveAsync();
        var firstRedactionStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var secondRedactionStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var allowFirstRedaction = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var redactionCount = 0;
        _factory.AclAuthorizationMock.Setup(service => service.CanModerateServerAsync(1)).ReturnsAsync(true);
        _factory.MatrixAppMock.Setup(service => service.RedactRoomEvent(
                "!gallery:test", "$sprite:test", It.IsAny<string>()))
            .Returns(async () =>
            {
                if (Interlocked.Increment(ref redactionCount) == 1)
                {
                    firstRedactionStarted.TrySetResult();
                    await allowFirstRedaction.Task;
                    return;
                }

                secondRedactionStarted.TrySetResult();
            });

        var firstDelete = _client.DeleteAsync("/companions/%24sprite%3Atest");
        await firstRedactionStarted.Task;
        var secondDelete = _client.DeleteAsync("/companions/%24sprite%3Atest");

        await Task.WhenAny(secondRedactionStarted.Task, Task.Delay(TimeSpan.FromMilliseconds(250)));
        var secondRedactionRanBeforeFirstCompleted = secondRedactionStarted.Task.IsCompleted;
        allowFirstRedaction.TrySetResult();

        var responses = await Task.WhenAll(firstDelete, secondDelete);

        Assert.IsFalse(secondRedactionRanBeforeFirstCompleted);
        CollectionAssert.AreEqual(
            new[] { HttpStatusCode.NoContent, HttpStatusCode.NoContent },
            responses.Select(response => response.StatusCode).OrderBy(status => status).ToArray());
        _factory.MatrixAppMock.Verify(service => service.RedactRoomEvent(
            "!gallery:test", "$sprite:test", It.IsAny<string>()), Times.Once);
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

    private sealed class CompanionDeletionFactory : BrmbleServerFactory
    {
        public Mock<IBrmbleEventBus> EventBusMock { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services =>
            {
                var eventBus = services.FirstOrDefault(descriptor =>
                    descriptor.ServiceType == typeof(IBrmbleEventBus));
                if (eventBus is not null) services.Remove(eventBus);
                EventBusMock.Setup(bus => bus.BroadcastToChannelAsync(It.IsAny<int>(), It.IsAny<object>()))
                    .Returns(Task.CompletedTask);
                services.AddSingleton(EventBusMock.Object);
            });
        }
    }
}
