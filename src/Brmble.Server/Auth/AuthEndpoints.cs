using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/token", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            AuthService authService,
            ChannelRepository channelRepository,
            IOptions<MatrixSettings> matrixSettings) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var result = await authService.Authenticate(certHash);

            var roomMap = channelRepository.GetAll()
                .ToDictionary(m => m.MumbleChannelId.ToString(), m => m.MatrixRoomId);

            return Results.Ok(new
            {
                matrix = new
                {
                    homeserverUrl = matrixSettings.Value.HomeserverUrl,
                    accessToken = result.MatrixAccessToken,
                    userId = result.MatrixUserId,
                    roomMap
                },
                livekit = (object?)null
            });
        });

        return app;
    }
}
