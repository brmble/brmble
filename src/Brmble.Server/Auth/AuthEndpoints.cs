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
            IMatrixAppService matrixAppService,
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

            AuthResult result;
            try
            {
                result = await authService.Authenticate(certHash);
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Auth failed: CertHash={CertHash}, RemoteIp={RemoteIp}",
                    certHash,
                    httpContext.Connection.RemoteIpAddress);
                return Results.StatusCode(500);
            }

            logger.LogInformation(
                "Auth succeeded: CertHash={CertHash}, MatrixUserId={MatrixUserId}",
                certHash,
                result.MatrixUserId);

            var roomMap = channelRepository.GetAll()
                .ToDictionary(m => m.MumbleChannelId.ToString(), m => m.MatrixRoomId);

            // Ensure the user is a member of all channel rooms
            var localpart = result.MatrixUserId.Split(':')[0].TrimStart('@');
            await matrixAppService.EnsureUserInRooms(localpart, roomMap.Values);

            // Clients reach the Matrix homeserver via YARP proxy on this same server.
            // Use the public URL the client connected to (not the internal localhost URL).
            var publicHomeserverUrl = matrixSettings.Value.PublicHomeserverUrl;
            if (string.IsNullOrEmpty(publicHomeserverUrl))
            {
                var request = httpContext.Request;
                publicHomeserverUrl = $"{request.Scheme}://{request.Host}";
            }

            return Results.Ok(new
            {
                matrix = new
                {
                    homeserverUrl = publicHomeserverUrl,
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
