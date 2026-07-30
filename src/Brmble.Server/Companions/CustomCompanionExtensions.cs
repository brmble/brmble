namespace Brmble.Server.Companions;

public static class CustomCompanionExtensions
{
    public static IServiceCollection AddCustomCompanions(this IServiceCollection services)
    {
        services.AddOptions<CustomCompanionOptions>()
            .BindConfiguration("CustomCompanions");
        services.AddSingleton<CustomCompanionEventCoordinator>();
        services.AddSingleton<CustomCompanionRepository>();
        services.AddSingleton<CustomCompanionGalleryService>();
        services.AddSingleton<CustomCompanionUploadService>();
        return services;
    }
}
