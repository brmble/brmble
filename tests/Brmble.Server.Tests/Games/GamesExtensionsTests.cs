using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Events;
using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.DependencyInjection;
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
}
