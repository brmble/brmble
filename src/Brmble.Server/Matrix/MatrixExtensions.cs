using Brmble.Server.Mumble;

namespace Brmble.Server.Matrix;

public static class MatrixExtensions
{
    public static IServiceCollection AddMatrix(this IServiceCollection services)
    {
        services.AddOptions<MatrixSettings>()
            .BindConfiguration("Matrix")
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
