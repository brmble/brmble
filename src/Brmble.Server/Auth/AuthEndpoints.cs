namespace Brmble.Server.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        // TODO: POST /auth/token
        //   - Extract cert hash from mTLS handshake
        //   - Call AuthService.Authenticate(certHash, displayName)
        //   - Return Matrix access token
        return app;
    }
}
