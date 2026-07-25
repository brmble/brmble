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
        return services;
    }
}
