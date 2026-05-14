using System.Net;
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;
using Brmble.Server.Tests.Integration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthEndpointsCompanionTests : IDisposable
{
    private readonly CompanionAuthFactory _factory = new();
    private readonly HttpClient _client;

    public AuthEndpointsCompanionTests()
    {
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task PostAuthCompanion_PersistsAndBroadcastsChannelScopedUpdate()
    {
        var tokenResponse = await _client.PostAsync("/auth/token", null);
        tokenResponse.EnsureSuccessStatusCode();

        var channelMembership = _factory.Services.GetRequiredService<IChannelMembershipService>();
        channelMembership.Update(42, 7);

        _factory.SessionMappingMock
            .Setup(m => m.TryGetSessionByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny))
            .Returns((long _, out int sid) =>
            {
                sid = 42;
                return true;
            });
        _factory.SessionMappingMock
            .Setup(m => m.TryUpdateCompanionId(42, "floppy"))
            .Returns(true);

        var response = await _client.PostAsync(
            "/auth/companion",
            new StringContent(JsonSerializer.Serialize(new { companionId = "floppy" }), Encoding.UTF8, "application/json"));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        _factory.SessionMappingMock.Verify(m => m.TryUpdateCompanionId(42, "floppy"), Times.Once);
        _factory.EventBusMock.Verify(b => b.BroadcastToChannelAsync(7, It.Is<object>(payload =>
            JsonSerializer.Serialize(payload).Contains("\"type\":\"companionChanged\""))), Times.Once);
    }

    private sealed class CompanionAuthFactory : BrmbleServerFactory
    {
        public Mock<ISessionMappingService> SessionMappingMock { get; } = new();
        public Mock<IBrmbleEventBus> EventBusMock { get; } = new();

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services =>
            {
                var mappingDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(ISessionMappingService));
                if (mappingDescriptor is not null) services.Remove(mappingDescriptor);

                var eventBusDescriptor = services.FirstOrDefault(d => d.ServiceType == typeof(IBrmbleEventBus));
                if (eventBusDescriptor is not null) services.Remove(eventBusDescriptor);

                SessionMappingMock.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>());
                SessionMappingMock.Setup(m => m.TryGetSessionId(It.IsAny<string>(), out It.Ref<int>.IsAny)).Returns(false);
                SessionMappingMock.Setup(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<long>(), It.IsAny<string>())).Returns(false);
                SessionMappingMock.Setup(m => m.TryUpdateBrmbleStatus(It.IsAny<int>(), It.IsAny<bool>())).Returns(true);

                EventBusMock.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
                EventBusMock.Setup(b => b.BroadcastToChannelAsync(It.IsAny<int>(), It.IsAny<object>())).Returns(Task.CompletedTask);

                services.AddSingleton(SessionMappingMock.Object);
                services.AddSingleton(EventBusMock.Object);
            });
        }
    }
}
