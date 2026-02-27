namespace Brmble.Server.Mumble;

public static class MumbleExtensions
{
    public static IServiceCollection AddMumble(this IServiceCollection services)
    {
        services.AddOptions<IceSettings>()
            .BindConfiguration("Ice");
        services.AddSingleton<MumbleServerCallback>();
        services.AddHostedService<MumbleIceService>();
        return services;
    }
}
