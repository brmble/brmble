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
        Assert.IsNotNull(error?.Reason);
        orchestrator.Verify(x => x.RespondToOfferAsync(9, It.Is<long>(id => id > 0), true), Times.Once);
    }

    [TestMethod]
    public async Task Queue_ReturnsCurrentSessionsWireSnapshot()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var provider = new Mock<IDuelSnapshotProvider>();
        provider.Setup(x => x.GetSnapshotForSessionAsync(55)).ReturnsAsync(new DuelQueueSnapshot(
            1, 2, 3, 7, DateTimeOffset.UtcNow, 0, null, null, []));
        await using var factory = CreateFactory(orchestrator, snapshots: provider);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.GetAsync("/games/queue");
        var json = await response.Content.ReadAsStringAsync();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        StringAssert.Contains(json, "\"schemaVersion\":1");
        StringAssert.Contains(json, "\"generation\":2");
        provider.Verify(x => x.GetSnapshotForSessionAsync(55), Times.Once);
    }

    [TestMethod]
    public async Task Queue_WithoutCurrentSession_ReturnsBadRequest()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        await using var factory = CreateFactory(orchestrator, hasSession: false);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.GetAsync("/games/queue");

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task Forfeit_PendingOfferOwner_CancelsWithoutRunnerForfeit()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
        orchestrator.Setup(x => x.CancelOfferAsync(9, It.IsAny<long>()))
            .ReturnsAsync(new DuelCommandResult(true, 9, null, null, DuelRejectReason.None));
        await using var factory = CreateFactory(orchestrator, router);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/forfeit", new { matchId = 9 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        router.Verify(x => x.ForfeitAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<string>()), Times.Never);
    }

    [TestMethod]
    public async Task Forfeit_StaleOfferFallsBackToAuthenticatedUsersMatchingActiveMatch()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
        orchestrator.Setup(x => x.CancelOfferAsync(12, It.IsAny<long>()))
            .ReturnsAsync(new DuelCommandResult(false, null, null, "stale", DuelRejectReason.StaleOffer));
        router.Setup(x => x.TryGetActiveMatch(It.IsAny<long>(), out It.Ref<ActiveMatchReference>.IsAny))
            .Returns((long _, out ActiveMatchReference match) =>
            {
                match = new ActiveMatchReference(12, 4, 1, "discrete");
                return true;
            });
        await using var factory = CreateFactory(orchestrator, router);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/forfeit", new { matchId = 12 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        router.Verify(x => x.ForfeitAsync(12, It.Is<long>(id => id > 0), "forfeit"), Times.Once);
    }

    [TestMethod]
    public async Task Forfeit_ForeignMatchId_IsRejectedWithoutRunnerMutation()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
        orchestrator.Setup(x => x.CancelOfferAsync(99, It.IsAny<long>()))
            .ReturnsAsync(new DuelCommandResult(false, null, null, "not participant", DuelRejectReason.NotParticipant));
        router.Setup(x => x.TryGetActiveMatch(It.IsAny<long>(), out It.Ref<ActiveMatchReference>.IsAny))
            .Returns((long _, out ActiveMatchReference match) =>
            {
                match = new ActiveMatchReference(12, 4, 1, "discrete");
                return true;
            });
        await using var factory = CreateFactory(orchestrator, router);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/forfeit", new { matchId = 99 });
        var error = await response.Content.ReadFromJsonAsync<GameErrorWire>();

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.AreEqual("notParticipant", error?.Reason);
        router.Verify(x => x.ForfeitAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<string>()), Times.Never);
    }

    private static WebApplicationFactory<Program> CreateFactory(
        Mock<IDuelOrchestrator> orchestrator,
        Mock<IDuelMatchRunnerRouter>? router = null,
        bool hasSession = true,
        Mock<IDuelSnapshotProvider>? snapshots = null)
    {
        var factory = new BrmbleServerFactory();
        factory.SessionMappingMock
            .Setup(x => x.TryGetSessionByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny))
            .Returns((long _, out int session) => { session = 55; return hasSession; });
        return factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IDuelOrchestrator>();
            services.AddSingleton(orchestrator.Object);
            services.RemoveAll<IDuelSnapshotProvider>();
            services.AddSingleton<IDuelSnapshotProvider>(snapshots?.Object ?? orchestrator.Object);
            if (router is not null)
            {
                services.RemoveAll<IDuelMatchRunnerRouter>();
                services.AddSingleton(router.Object);
            }
        }));
    }
}
