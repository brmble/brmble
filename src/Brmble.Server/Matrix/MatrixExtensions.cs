using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public static class MatrixExtensions
{
    public static IServiceCollection AddMatrix(this IServiceCollection services)
    {
        services.AddOptions<MatrixSettings>()
            .BindConfiguration("Matrix")
            .PostConfigure(settings =>
            {
                // Fall back to MATRIX_SERVER_NAME (used by entrypoint for Conduwuit config)
                if (settings.ServerDomain == "localhost")
                    settings.ServerDomain = Environment.GetEnvironmentVariable("MATRIX_SERVER_NAME") ?? settings.ServerDomain;
            })
            .ValidateDataAnnotations()
            .ValidateOnStart();

        services.AddHttpClient();
        services.AddSingleton<ChannelRepository>();
        services.AddSingleton<IMatrixAppService, MatrixAppService>();
        services.AddSingleton<MatrixService>();
        services.AddSingleton<IMumbleEventHandler, MatrixEventHandler>();
        return services;
    }
}
