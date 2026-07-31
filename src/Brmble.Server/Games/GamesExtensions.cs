using Brmble.Server.Games.Engines;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games;

public static class GamesExtensions
{
    public static IServiceCollection AddGames(this IServiceCollection services)
    {
        services.AddSingleton<IRandomSource, CryptoRandomSource>();
        services.AddSingleton<DeathrollEngine>();
        services.AddSingleton<RpsEngine>();
        services.AddSingleton<IGameEngine>(sp => sp.GetRequiredService<DeathrollEngine>());
        services.AddSingleton<IGameEngine>(sp => sp.GetRequiredService<RpsEngine>());
        services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<DeathrollEngine>());
        services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<RpsEngine>());
        services.AddSingleton<GameDefinitionCatalog>();
        services.AddSingleton<GameRepository>();
        services.AddSingleton<IDurationSampleRepository>(sp => sp.GetRequiredService<GameRepository>());
        services.AddSingleton<DuelDurationEstimator>();
        services.AddSingleton<CompletedMatchPersistenceQueue>();
        services.AddSingleton<ICompletedMatchSink>(sp => sp.GetRequiredService<CompletedMatchPersistenceQueue>());
        services.AddHostedService(sp => sp.GetRequiredService<CompletedMatchPersistenceQueue>());
        services.AddSingleton<GameStatsService>();
        services.AddSingleton<IGamePresence, SessionMappingGamePresence>();
        services.AddSingleton<IGameEventPublisher, EventBusGameEventPublisher>();
        services.AddSingleton<GameSessionManager>();
        services.AddSingleton<IDuelMatchRunner>(sp => sp.GetRequiredService<GameSessionManager>());
        services.AddSingleton<DuelMatchRunnerRouter>();
        services.AddSingleton<IDuelMatchRunnerRouter>(sp => sp.GetRequiredService<DuelMatchRunnerRouter>());
        services.AddSingleton<DuelOrchestrator>();
        services.AddSingleton<IDuelOrchestrator>(sp => sp.GetRequiredService<DuelOrchestrator>());
        services.AddSingleton<IDuelSnapshotProvider>(sp => sp.GetRequiredService<DuelOrchestrator>());
        // DuelOrchestrator subscribes to IDuelMatchRunnerRouter.MatchCompleted in its constructor.
        // DI singletons are lazy, so without an explicit warm-up the subscription would only be
        // established on the first resolve (today: transitively via the MumbleServerCallback
        // singleton), and any match completing before that would be dropped silently.
        services.AddHostedService<DuelOrchestratorWarmup>();
        return services;
    }
}

/// <summary>
/// Forces construction of <see cref="DuelOrchestrator"/> at host startup so that its
/// MatchCompleted subscription is established deterministically.
/// </summary>
internal sealed class DuelOrchestratorWarmup : IHostedService
{
    public DuelOrchestratorWarmup(DuelOrchestrator orchestrator) => _ = orchestrator;

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
