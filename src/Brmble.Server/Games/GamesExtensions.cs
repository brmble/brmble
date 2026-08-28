using Brmble.Server.Games.Engines;
using Brmble.Server.Games.Duels;
using Brmble.Server.Auth;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using System.Threading.RateLimiting;

namespace Brmble.Server.Games;

public static class GamesExtensions
{
    public static IServiceCollection AddGames(this IServiceCollection services)
    {
        services.AddOptions<Continuous.GamesRealtimeOptions>()
            .BindConfiguration("Games")
            .ValidateOnStart();
        services.AddSingleton<IValidateOptions<Continuous.GamesRealtimeOptions>, Continuous.GamesRealtimeOptionsValidator>();
        services.AddSingleton<Continuous.RealtimeTicketStore>();
        services.Configure<RateLimiterOptions>(options =>
            options.AddPolicy("games-realtime-ticket", context =>
            {
                var certificates = context.RequestServices.GetRequiredService<ICertificateHashExtractor>();
                var partition = certificates.GetCertHash(context) ?? "missing-client-certificate";
                return RateLimitPartition.GetFixedWindowLimiter(partition, _ =>
                    new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 10,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                    });
            }));
        services.AddSingleton<IRandomSource, CryptoRandomSource>();
        services.AddSingleton<DeathrollEngine>();
        services.AddSingleton<RpsEngine>();
        services.AddSingleton<IGameEngine>(sp => sp.GetRequiredService<DeathrollEngine>());
        services.AddSingleton<IGameEngine>(sp => sp.GetRequiredService<RpsEngine>());
        services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<DeathrollEngine>());
        services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<RpsEngine>());
        services.AddSingleton<Arena.ArenaGameDefinition>();
        services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<Arena.ArenaGameDefinition>());
        services.AddSingleton<Continuous.IContinuousGameDefinition>(sp => sp.GetRequiredService<Arena.ArenaGameDefinition>());
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
        // One instance owns both roles: the coordinator (sources publish into it) and
        // the lifecycle (presence teardown calls into it). They share the registry.
        services.AddSingleton<Spectators.SpectatorService>();
        services.AddSingleton<Spectators.ISpectatorCoordinator>(sp => sp.GetRequiredService<Spectators.SpectatorService>());
        services.AddSingleton<Spectators.ISpectatorLifecycle>(sp => sp.GetRequiredService<Spectators.SpectatorService>());
        services.AddSingleton<GameSessionManager>();
        services.AddSingleton<IDuelMatchRunner>(sp => sp.GetRequiredService<GameSessionManager>());
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<Continuous.ContinuousGameCoordinator>();
        services.AddSingleton<IDuelMatchRunner>(sp => sp.GetRequiredService<Continuous.ContinuousGameCoordinator>());
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
