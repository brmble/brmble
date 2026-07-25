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
        services.AddSingleton<GameStatsService>();
        services.AddSingleton<IGamePresence, SessionMappingGamePresence>();
        services.AddSingleton<IGameEventPublisher, EventBusGameEventPublisher>();
        services.AddSingleton<GameSessionManager>();
        return services;
    }
}
