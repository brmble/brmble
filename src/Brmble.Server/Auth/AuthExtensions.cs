namespace Brmble.Server.Auth;

public static class AuthExtensions
{
    public static IServiceCollection AddAuth(this IServiceCollection services)
    {
        services.AddSingleton<UserRepository>();
        services.AddSingleton<AuthService>();
        services.AddSingleton<IActiveBrmbleSessions>(sp => sp.GetRequiredService<AuthService>());
        services.AddSingleton<ICertificateHashExtractor, MtlsCertificateHashExtractor>();
        return services;
    }
}
