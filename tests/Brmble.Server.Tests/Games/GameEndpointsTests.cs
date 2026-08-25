using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Brmble.Server.Events;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Spectators;
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
    public async Task Respond_MatchIdOnly_IsRejectedWithoutOrchestratorCall()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/respond", new { matchId = 9, accept = false });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        orchestrator.Verify(x => x.RespondToOfferAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<bool>()), Times.Never);
    }

    [DataTestMethod]
    [DataRow("{\"accept\":true}")]
    [DataRow("{\"offerId\":0,\"accept\":true}")]
    public async Task Respond_AmbiguousOrNonPositiveId_ReturnsBadRequestWithoutCall(string json)
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsync("/games/respond", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        var error = await response.Content.ReadFromJsonAsync<GameErrorWire>();

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.AreEqual("invalidConfiguration", error?.Reason);
        orchestrator.Verify(x => x.RespondToOfferAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<bool>()), Times.Never);
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
    public async Task CancelOffer_Owner_CallsCancelWithStableAuthenticatedUser()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        orchestrator.Setup(x => x.CancelOfferAsync(9, It.IsAny<long>()))
            .ReturnsAsync(new DuelCommandResult(true, 9, null, null, DuelRejectReason.None));
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/offers/cancel", new { offerId = 9 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        orchestrator.Verify(x => x.CancelOfferAsync(9, It.Is<long>(id => id > 0)), Times.Once);
    }

    [DataTestMethod]
    [DataRow(DuelRejectReason.NotParticipant, "notParticipant")]
    [DataRow(DuelRejectReason.StaleOffer, "staleOffer")]
    public async Task CancelOffer_Failure_ReturnsExhaustiveWireReason(DuelRejectReason reason, string expectedReason)
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        orchestrator.Setup(x => x.CancelOfferAsync(12, It.IsAny<long>()))
            .ReturnsAsync(new DuelCommandResult(false, null, null, "rejected", reason));
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/offers/cancel", new { offerId = 12 });
        var error = await response.Content.ReadFromJsonAsync<GameErrorWire>();

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.AreEqual(expectedReason, error?.Reason);
    }

    [TestMethod]
    public async Task Forfeit_ForeignMatchId_IsRejectedWithoutRunnerMutation()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
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
        orchestrator.Verify(x => x.CancelOfferAsync(It.IsAny<long>(), It.IsAny<long>()), Times.Never);
        router.Verify(x => x.ForfeitAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<string>()), Times.Never);
    }

    [TestMethod]
    public async Task Forfeit_MatchingActiveMatch_ForfeitsAsStableAuthenticatedUser()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
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

    [DataTestMethod]
    [DataRow(true, ReadyResponse.Accept)]
    [DataRow(false, ReadyResponse.Decline)]
    public async Task Ready_MapsReadyBooleanToResponseAndStableUser(bool ready, ReadyResponse expected)
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        orchestrator.Setup(x => x.RespondReadyAsync(20, It.IsAny<long>(), expected))
            .ReturnsAsync(new DuelCommandResult(true, null, 20, null, DuelRejectReason.None));
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/ready", new { reservationId = 20, ready });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        orchestrator.Verify(x => x.RespondReadyAsync(20, It.Is<long>(id => id > 0), expected), Times.Once);
    }

    [TestMethod]
    public async Task Ready_MissingReady_ReturnsBadRequestWithoutCall()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/ready", new { reservationId = 20 });
        var error = await response.Content.ReadFromJsonAsync<GameErrorWire>();

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.AreEqual("invalidConfiguration", error?.Reason);
        orchestrator.Verify(x => x.RespondReadyAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<ReadyResponse>()), Times.Never);
    }

    [DataTestMethod]
    [DataRow("/games/offers/cancel", "{\"offerId\":0}")]
    [DataRow("/games/ready", "{\"reservationId\":0,\"ready\":false}")]
    [DataRow("/games/rematch", "{\"sourceMatchId\":0}")]
    public async Task NewCommand_NonPositiveId_ReturnsBadRequestWithoutCall(string path, string json)
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsync(path, new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        orchestrator.Verify(x => x.CancelOfferAsync(It.IsAny<long>(), It.IsAny<long>()), Times.Never);
        orchestrator.Verify(x => x.RespondReadyAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<ReadyResponse>()), Times.Never);
        orchestrator.Verify(x => x.RequestRematchAsync(It.IsAny<long>(), It.IsAny<long>()), Times.Never);
    }

    [TestMethod]
    public async Task Rematch_UsesStableAuthenticatedUser()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        orchestrator.Setup(x => x.RequestRematchAsync(30, It.IsAny<long>()))
            .ReturnsAsync(new DuelCommandResult(true, 31, null, null, DuelRejectReason.None));
        await using var factory = CreateFactory(orchestrator);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/rematch", new { sourceMatchId = 30 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        orchestrator.Verify(x => x.RequestRematchAsync(30, It.Is<long>(id => id > 0)), Times.Once);
    }

    [TestMethod]
    public async Task CancelOffer_WithoutCertificate_IsUnauthorized()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        await using var factory = CreateFactory(orchestrator, certHash: null);
        var response = await factory.CreateClient().PostAsJsonAsync("/games/offers/cancel", new { offerId = 9 });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        orchestrator.Verify(x => x.CancelOfferAsync(It.IsAny<long>(), It.IsAny<long>()), Times.Never);
    }

    [DataTestMethod]
    [DataRow("/games/offers/cancel", "{\"offerId\":9}")]
    [DataRow("/games/ready", "{\"reservationId\":20,\"ready\":true}")]
    [DataRow("/games/rematch", "{\"sourceMatchId\":30}")]
    public async Task PresenceRequiredCommand_WithoutCurrentSession_ReturnsBadRequestWithoutCall(string path, string json)
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        await using var factory = CreateFactory(orchestrator, hasSession: false);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsync(path, new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        orchestrator.Verify(x => x.CancelOfferAsync(It.IsAny<long>(), It.IsAny<long>()), Times.Never);
        orchestrator.Verify(x => x.RespondReadyAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<ReadyResponse>()), Times.Never);
        orchestrator.Verify(x => x.RequestRematchAsync(It.IsAny<long>(), It.IsAny<long>()), Times.Never);
    }

    private static WebApplicationFactory<Program> CreateSpectatorFactory(
        Mock<ISpectatorCoordinator> spectators,
        bool hasSession = true,
        string? certHash = "testcerthash123")
    {
        var factory = new BrmbleServerFactory(certHash);
        factory.SessionMappingMock
            .Setup(x => x.TryGetSessionByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny))
            .Returns((long _, out int session) => { session = 55; return hasSession; });
        return factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<ISpectatorCoordinator>();
            services.AddSingleton(spectators.Object);
        }));
    }

    [TestMethod]
    public async Task SpectatorSubscribe_IdleChannel_ReturnsNullMatch()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        spectators.Setup(x => x.SubscribeAsync(55, It.IsAny<long>(), 7))
            .ReturnsAsync(new SpectatorSubscribeResult(true, null, SpectatorSubscribeReason.None));
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual(7, doc.RootElement.GetProperty("channelId").GetInt32());
        Assert.AreEqual(JsonValueKind.Null, doc.RootElement.GetProperty("match").ValueKind);
    }

    [TestMethod]
    public async Task SpectatorSubscribe_LiveChannel_ReturnsTheSnapshot()
    {
        var snapshot = new SpectatorSnapshot(
            1, 91, 7, "deathroll", "1v1", 1,
            [new DuelPlayerSnapshot(100, 10, "Qy"), new DuelPlayerSnapshot(200, 20, "Broan")],
            4, DateTimeOffset.UnixEpoch,
            new DeathrollSpectatorView("deathroll", [10, 20], 10, 50, 73, false, null));
        var spectators = new Mock<ISpectatorCoordinator>();
        spectators.Setup(x => x.SubscribeAsync(55, It.IsAny<long>(), 7))
            .ReturnsAsync(new SpectatorSubscribeResult(true, snapshot, SpectatorSubscribeReason.None));
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var match = doc.RootElement.GetProperty("match");
        Assert.AreEqual(91, match.GetProperty("matchId").GetInt64());
        Assert.AreEqual("deathroll", match.GetProperty("view").GetProperty("kind").GetString());
    }

    [TestMethod]
    public async Task SpectatorSubscribe_CrossChannel_RejectsWithStructuredReason()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        spectators.Setup(x => x.SubscribeAsync(55, It.IsAny<long>(), 8))
            .ReturnsAsync(new SpectatorSubscribeResult(false, null, SpectatorSubscribeReason.NotSameChannel));
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 8 });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual("notSameChannel", doc.RootElement.GetProperty("reason").GetString());
    }

    [TestMethod]
    public async Task SpectatorSubscribe_WithNoLiveSession_RejectsWithNotPresent()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators, hasSession: false);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual("notPresent", doc.RootElement.GetProperty("reason").GetString());
        spectators.Verify(x => x.SubscribeAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<int>()), Times.Never);
    }

    [TestMethod]
    public async Task SpectatorSubscribe_Unauthenticated_Returns401()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators, certHash: null);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task SpectatorUnsubscribe_Succeeds()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/unsubscribe", new { });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.IsTrue(doc.RootElement.GetProperty("unsubscribed").GetBoolean());
        spectators.Verify(x => x.UnsubscribeAsync(55, It.IsAny<long>()), Times.Once);
    }

    [TestMethod]
    public async Task SpectatorSubscribe_CoordinatorReportsNotPresent_RejectsWithNotPresent()
    {
        // Reachable when the session mapping exists but presence disagrees, so this is
        // the coordinator's own NotPresent, not the endpoint's pre-check.
        var spectators = new Mock<ISpectatorCoordinator>();
        spectators.Setup(x => x.SubscribeAsync(55, It.IsAny<long>(), 7))
            .ReturnsAsync(new SpectatorSubscribeResult(false, null, SpectatorSubscribeReason.NotPresent));
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual("notPresent", doc.RootElement.GetProperty("reason").GetString());
        spectators.Verify(x => x.SubscribeAsync(55, It.IsAny<long>(), 7), Times.Once);
    }

    [TestMethod]
    public async Task SpectatorUnsubscribe_WithNoLiveSession_SucceedsWithoutCoordinatorCall()
    {
        // Deliberately asymmetric with subscribe's 400 notPresent: unsubscribing when
        // you are already gone is not a failure.
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators, hasSession: false);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/unsubscribe", new { });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.IsTrue(doc.RootElement.GetProperty("unsubscribed").GetBoolean());
        spectators.Verify(x => x.UnsubscribeAsync(It.IsAny<long>(), It.IsAny<long>()), Times.Never);
    }

    [TestMethod]
    public async Task SpectatorUnsubscribe_Unauthenticated_Returns401()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators, certHash: null);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/games/spectators/unsubscribe", new { });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static WebApplicationFactory<Program> CreateFactory(
        Mock<IDuelOrchestrator> orchestrator,
        Mock<IDuelMatchRunnerRouter>? router = null,
        bool hasSession = true,
        Mock<IDuelSnapshotProvider>? snapshots = null,
        string? certHash = "testcerthash123")
    {
        var factory = new BrmbleServerFactory(certHash);
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
