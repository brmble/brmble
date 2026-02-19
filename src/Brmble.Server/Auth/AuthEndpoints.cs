// src/Brmble.Server/Auth/AuthEndpoints.cs
namespace Brmble.Server.Auth;

public record AuthTokenRequest(string DisplayName);

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/token", async (
            HttpContext httpContext,
            AuthTokenRequest request,
            ICertificateHashExtractor certHashExtractor,
            AuthService authService) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (certHash is null)
                return Results.BadRequest("No client certificate presented.");

            var result = await authService.Authenticate(certHash, request.DisplayName);
            return Results.Ok(new { matrixAccessToken = result.MatrixAccessToken });
        });

        return app;
    }
}
