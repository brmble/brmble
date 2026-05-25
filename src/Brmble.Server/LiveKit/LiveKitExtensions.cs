namespace Brmble.Server.LiveKit;

public static class LiveKitExtensions
{
    public static IServiceCollection AddLiveKit(this IServiceCollection services)
    {
        services.AddOptions<LiveKitSettings>()
            .BindConfiguration("LiveKit");
        services.AddSingleton<ILiveKitRoomClient, LiveKitRoomClient>();
        services.AddSingleton<LiveKitService>();
        services.AddSingleton<ILiveKitRoomQuery>(sp => sp.GetRequiredService<LiveKitService>());
        services.AddSingleton<ILiveKitParticipantRemover>(sp => sp.GetRequiredService<LiveKitService>());
        services.AddSingleton<ILiveKitParticipantRevocationScheduler, LiveKitParticipantRevocationScheduler>();
        services.AddSingleton<LiveKitParticipantTracker>();
        services.AddSingleton<ScreenShareTracker>();
        services.AddSingleton<IUserIdMapper, SessionMappingUserIdMapper>();
        services.AddHostedService<ScreenShareReconciliationService>();
        return services;
    }
}
