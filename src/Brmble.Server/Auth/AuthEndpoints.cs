using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/token", async (
            AuthTokenRequest request,
            AuthService authService,
            ChannelRepository channelRepository,
            IOptions<MatrixSettings> matrixSettings) =>
        {
            if (string.IsNullOrWhiteSpace(request.CertHash))
                return Results.BadRequest("certHash is required.");

            var result = await authService.Authenticate(request.CertHash);

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

    private record AuthTokenRequest(string? CertHash);
}
