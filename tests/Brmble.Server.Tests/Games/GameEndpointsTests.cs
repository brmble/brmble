using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Events;
using Brmble.Server.Games.Duels;
using Brmble.Server.Tests.Integration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class GameEndpointsTests
{
    [TestMethod]
    public async Task Invite_ResolvesAuthenticatedSessionAndPreservesNumericOptions()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        orchestrator.Setup(x => x.CreateChallengeAsync(55, 77, "rps", It.IsAny<IReadOnlyDictionary<string, object?>?>()))
            .ReturnsAsync(new DuelCommandResult(true, 9, null, null, DuelRejectReason.None));
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/invite", new
        {
            targetSessionId = 77,
            gameType = "rps",
            options = new { bestOf = 5 },
        });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        orchestrator.Verify(x => x.CreateChallengeAsync(55, 77, "rps",
            It.Is<IReadOnlyDictionary<string, object?>?>(options =>
                options != null && Convert.ToInt32(options["bestOf"]) == 5)), Times.Once);
    }

    [TestMethod]
    public async Task Respond_UsesStableAuthenticatedUserAndReturnsWireReason()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        orchestrator.Setup(x => x.RespondToOfferAsync(9, It.IsAny<long>(), true))
            .ReturnsAsync(new DuelCommandResult(false, null, null, "already committed", DuelRejectReason.AlreadyCommitted));
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/respond", new { offerId = 9, accept = true });
        var error = await response.Content.ReadFromJsonAsync<GameErrorWire>();

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.AreEqual("alreadyCommitted", error?.Reason);
        orchestrator.Verify(x => x.RespondToOfferAsync(9, It.Is<long>(id => id > 0), true), Times.Once);
    }

    private static WebApplicationFactory<Program> CreateFactory(Mock<IDuelOrchestrator> orchestrator)
    {
        var factory = new BrmbleServerFactory();
        factory.SessionMappingMock
            .Setup(x => x.TryGetSessionByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny))
            .Returns((long _, out int session) => { session = 55; return true; });
        return factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IDuelOrchestrator>();
            services.AddSingleton(orchestrator.Object);
        }));
    }
}
