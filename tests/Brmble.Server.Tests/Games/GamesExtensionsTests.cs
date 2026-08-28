using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Spectators;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class GamesExtensionsTests
{
    private static IHost BuildHost()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();

        var builder = Host.CreateApplicationBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Games:RealtimePublicWebSocketUrl"] = "wss://realtime.test/games",
        });
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton(db);
        builder.Services.AddSingleton(new Mock<ISessionMappingService>().Object);
        builder.Services.AddSingleton(new Mock<IChannelMembershipService>().Object);
        builder.Services.AddSingleton(new UserRepository(db, Options.Create(new MatrixSettings
        {
            HomeserverUrl = "http://localhost",
            AppServiceToken = "test",
            ServerDomain = "test.local",
        })));
        builder.Services.AddSingleton(new Mock<IBrmbleEventBus>().Object);
        builder.Services.AddGames();
        return builder.Build();
    }

    private static int MatchCompletedSubscriberCount(DuelMatchRunnerRouter router)
    {
        var field = typeof(DuelMatchRunnerRouter).GetField(
            nameof(DuelMatchRunnerRouter.MatchCompleted),
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        Assert.IsNotNull(field, "Expected a field-like event backing field for MatchCompleted");
        var handler = (Delegate?)field.GetValue(router);
        return handler?.GetInvocationList().Length ?? 0;
    }

    [TestMethod]
    public async Task AddGames_SubscribesDuelOrchestratorToMatchCompletedAtHostStartup()
    {
        using var host = BuildHost();

        await host.StartAsync();
        try
        {
            var router = host.Services.GetRequiredService<DuelMatchRunnerRouter>();
            Assert.AreEqual(1, MatchCompletedSubscriberCount(router));
        }
        finally
        {
            await host.StopAsync();
        }
    }

    [TestMethod]
    public async Task AddGames_DisposingHostUnsubscribesDuelOrchestratorFromMatchCompleted()
    {
        var host = BuildHost();
        await host.StartAsync();
        var router = host.Services.GetRequiredService<DuelMatchRunnerRouter>();
        Assert.AreEqual(1, MatchCompletedSubscriberCount(router));

        await host.StopAsync();
        if (host is IAsyncDisposable asyncDisposable) await asyncDisposable.DisposeAsync();
        else host.Dispose();

        Assert.AreEqual(0, MatchCompletedSubscriberCount(router));
    }

    [TestMethod]
    public void AddGames_RegistersTheSpectatorServiceAsBothInterfaces()
    {
        using var host = BuildHost();

        var service = host.Services.GetRequiredService<SpectatorService>();
        var coordinator = host.Services.GetRequiredService<ISpectatorCoordinator>();
        var lifecycle = host.Services.GetRequiredService<ISpectatorLifecycle>();
        Assert.AreSame<object>(coordinator, lifecycle, "One SpectatorService instance owns both roles.");
        Assert.AreSame<object>(service, coordinator,
            "Both interfaces must resolve to the registered SpectatorService, not some other shared implementation.");
    }

    [TestMethod]
    public void AddGames_InjectsTheSpectatorCoordinatorIntoGameSessionManager()
    {
        using var host = BuildHost();

        var manager = host.Services.GetRequiredService<GameSessionManager>();

        var field = typeof(GameSessionManager).GetField(
            "_spectators",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        Assert.IsNotNull(field, "Expected GameSessionManager to hold its coordinator in a _spectators field.");
        var injected = field.GetValue(manager);

        // GameSessionManager's ISpectatorCoordinator parameter has a DEFAULT VALUE, and
        // Microsoft.Extensions.DependencyInjection honours parameter defaults for
        // unregistered services. So dropping the registration does NOT throw when the
        // manager is resolved - it silently injects null, every publish site
        // short-circuits on `_spectators is null`, and spectating dies in production
        // with the whole suite still green. Assert non-null BEFORE resolving the
        // coordinator, so removing the registration fails here, naming the real
        // consequence, rather than as a generic "no service registered" from the
        // resolve below.
        Assert.IsNotNull(injected,
            "GameSessionManager received a null ISpectatorCoordinator. Every spectator frame is " +
            "silently dropped in production and no other test notices.");

        var coordinator = host.Services.GetRequiredService<ISpectatorCoordinator>();
        Assert.AreSame<object>(coordinator, injected,
            "GameSessionManager must receive the registered ISpectatorCoordinator instance, " +
            "not a second one - a split instance publishes frames no subscriber can see.");
    }
}
