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
            IOptions<MatrixSettings> matrixSettings,
            ILogger<AuthService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);

            if (string.IsNullOrWhiteSpace(certHash))
            {
                logger.LogWarning(
                    "Auth failed: no client certificate hash — RemoteIp={RemoteIp}",
                    httpContext.Connection.RemoteIpAddress);
                return Results.Unauthorized();
            }

            logger.LogInformation(
                "Auth attempt: CertHash={CertHash}, RemoteIp={RemoteIp}",
                certHash,
                httpContext.Connection.RemoteIpAddress);

            var result = await authService.Authenticate(certHash);

            logger.LogInformation(
                "Auth succeeded: CertHash={CertHash}, MatrixUserId={MatrixUserId}",
                certHash,
                result.MatrixUserId);

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
