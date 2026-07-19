using Brmble.Server.Games.Engines;

namespace Brmble.Server.Games;

public static class GamesExtensions
{
    public static IServiceCollection AddGames(this IServiceCollection services)
    {
        services.AddSingleton<IRandomSource, CryptoRandomSource>();
        services.AddSingleton<IGameEngine, DeathrollEngine>();
        services.AddSingleton<GameRepository>();
        services.AddSingleton<GameStatsService>();
        services.AddSingleton<IGamePresence, SessionMappingGamePresence>();
        services.AddSingleton<IGameEventPublisher, EventBusGameEventPublisher>();
        services.AddSingleton<IGameAnnouncer, MatrixGameAnnouncer>();
        services.AddSingleton<GameSessionManager>();
        return services;
    }
}
