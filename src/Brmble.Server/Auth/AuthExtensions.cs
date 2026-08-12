namespace Brmble.Server.Auth;

public static class AuthExtensions
{
    public static IServiceCollection AddAuth(this IServiceCollection services)
    {
        services.AddSingleton<UserRepository>();
        services.AddSingleton<AuthService>();
        services.AddSingleton<IActiveBrmbleSessions>(sp => sp.GetRequiredService<AuthService>());
        services.AddSingleton<ICertificateHashExtractor, MtlsCertificateHashExtractor>();
        services.AddSingleton(TimeProvider.System);
        // Legacy Matrix token migration is activated in Program.cs only after the
        // live AuthService/UserRepository token path is switched to MatrixTokenStore.
        services.AddSingleton<MatrixTokenStore>();
        return services;
    }
}
