namespace Brmble.Server.LiveKit;

public static class LiveKitExtensions
{
    public static IServiceCollection AddLiveKit(this IServiceCollection services)
    {
        services.AddOptions<LiveKitSettings>()
            .BindConfiguration("LiveKit");
        services.AddSingleton<LiveKitService>();
        services.AddSingleton<ScreenShareTracker>();
        return services;
    }
}
