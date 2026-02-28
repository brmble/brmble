using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public static class MumbleExtensions
{
    public static IServiceCollection AddMumble(this IServiceCollection services)
    {
        services.AddOptions<IceSettings>()
            .BindConfiguration("Ice");
        services.AddSingleton<ISessionMappingService, SessionMappingService>();
        services.AddSingleton<IBrmbleEventBus, BrmbleEventBus>();
        services.AddSingleton<MumbleServerCallback>();
        services.AddHostedService<MumbleIceService>();
        return services;
    }
}
