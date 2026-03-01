using System.Text.Json;
using Brmble.Server.Events;
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
            UserRepository userRepository,
            IOptions<MatrixSettings> matrixSettings,
            ISessionMappingService sessionMapping,
            IBrmbleEventBus eventBus,
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

            // Read optional Mumble username from request body BEFORE Authenticate
            // so the name is available when creating a new user record.
            string? mumbleUsername = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                mumbleUsername = doc.RootElement.TryGetProperty("mumbleUsername", out var prop)
                    ? prop.GetString() : null;
            }
            catch { /* empty or non-JSON body — OK */ }

            AuthResult result;
            try
            {
                result = await authService.Authenticate(certHash, mumbleUsername);
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Auth failed: CertHash={CertHash}, RemoteIp={RemoteIp}",
                    certHash,
                    httpContext.Connection.RemoteIpAddress);
                return Results.StatusCode(500);
            }

            if (!string.IsNullOrEmpty(mumbleUsername))
                authService.TrackMumbleName(mumbleUsername);

            if (!string.IsNullOrEmpty(mumbleUsername) &&
                sessionMapping.TryGetSessionId(mumbleUsername, out var sid))
            {
                if (sessionMapping.TryAddMatrixUser(sid, result.MatrixUserId, mumbleUsername))
                {
                    await eventBus.BroadcastAsync(new
                    {
                        type = "userMappingAdded",
                        sessionId = sid,
                        matrixUserId = result.MatrixUserId,
                        mumbleName = mumbleUsername
                    });
                }
            }

            logger.LogInformation(
                "Auth succeeded: CertHash={CertHash}, MatrixUserId={MatrixUserId}, MumbleName={MumbleName}",
                certHash,
                result.MatrixUserId,
                mumbleUsername ?? "(none)");

            var roomMap = (await channelRepository.GetAllAsync())
                .ToDictionary(m => m.MumbleChannelId.ToString(), m => m.MatrixRoomId);

            var allUsers = await userRepository.GetAllAsync();
            // Group by display name and pick the most recently created user to handle duplicates
            var userMappings = allUsers
                .GroupBy(u => u.DisplayName)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(u => u.Id).First().MatrixUserId);

            // Ensure user is in all rooms, then sync display name
            await matrixAppService.EnsureUserInRooms(result.Localpart, roomMap.Values);
            try
            {
                await matrixAppService.SetDisplayName(result.Localpart, result.DisplayName);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to sync display name for {UserId}", result.MatrixUserId);
            }

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
                userMappings,
                sessionMappings = sessionMapping.GetSnapshot()
                    .ToDictionary(
                        kvp => kvp.Key.ToString(),
                        kvp => new { matrixUserId = kvp.Value.MatrixUserId, mumbleName = kvp.Value.MumbleName }),
                livekit = (object?)null
            });
        });

        return app;
    }
}
