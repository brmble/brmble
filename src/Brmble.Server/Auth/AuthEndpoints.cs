using System.Text.Json;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
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
            catch (MumbleNameConflictException ex)
            {
                logger.LogWarning("Name conflict during auth: {Message}", ex.Message);
                return Results.Conflict(new { error = "name_taken", message = ex.Message, name = ex.RequestedName });
            }
            catch (MumbleRegistrationException ex)
            {
                logger.LogError(ex, "Mumble registration error during auth");
                return Results.StatusCode(503);
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Auth failed: CertHash={CertHash}, RemoteIp={RemoteIp}",
                    certHash,
                    httpContext.Connection.RemoteIpAddress);
                return Results.StatusCode(500);
            }

            // Use the authoritative display name from auth (which resolves
            // the Mumble-registered name via ICE) rather than the raw
            // mumbleUsername from the request body, which may differ for
            // registered users who connected with a different name.
            var resolvedName = result.DisplayName;
            if (!string.IsNullOrEmpty(resolvedName))
                authService.TrackMumbleName(resolvedName, certHash);

            if (!string.IsNullOrEmpty(resolvedName) &&
                sessionMapping.TryGetSessionId(resolvedName, out var sid))
            {
                if (sessionMapping.TryAddMatrixUser(sid, result.MatrixUserId, resolvedName, result.UserId))
                {
                    // This user just authenticated via Brmble, so mark them as a Brmble client
                    // immediately. Authenticate() may have failed to update the mapping if
                    // TryAddMatrixUser hadn't been called yet (race with SessionMappingHandler).
                    sessionMapping.TryUpdateBrmbleStatus(sid, true);
                    await eventBus.BroadcastAsync(new
                    {
                        type = "userMappingAdded",
                        sessionId = sid,
                        matrixUserId = result.MatrixUserId,
                        mumbleName = resolvedName,
                        isBrmbleClient = true
                    });
                }
                else
                {
                    // Mapping already existed (created by SessionMappingHandler.OnUserConnected).
                    // Ensure Brmble status is up to date — Authenticate() sets _activeSessions
                    // but TryUpdateBrmbleStatus may not have been called if the mapping
                    // was created before auth completed.
                    sessionMapping.TryUpdateBrmbleStatus(sid, true);
                }
            }

            logger.LogInformation(
                "Auth succeeded: CertHash={CertHash}, MatrixUserId={MatrixUserId}, MumbleName={MumbleName}",
                certHash,
                result.MatrixUserId,
                resolvedName ?? "(none)");

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
                        kvp => new { matrixUserId = kvp.Value.MatrixUserId, mumbleName = kvp.Value.MumbleName, isBrmbleClient = kvp.Value.IsBrmbleClient }),
                registered = result.IsRegistered,
                registeredName = result.DisplayName,
                livekit = (object?)null
            });
        });

        app.MapPost("/auth/avatar-source", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepository,
            ILogger<AuthService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);

            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepository.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            string? source = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                source = doc.RootElement.TryGetProperty("source", out var prop)
                    ? prop.GetString() : null;
            }
            catch { /* empty or non-JSON body — treat as null (clear) */ }

            // Only allow known source values
            if (source is not null and not "brmble" and not "mumble")
                return Results.BadRequest(new { error = "Invalid avatar source. Must be 'brmble', 'mumble', or null." });

            await userRepository.SetAvatarSource(user.Id, source);

            logger.LogInformation(
                "Avatar source set: UserId={UserId}, Source={Source}",
                user.Id, source ?? "(cleared)");

            return Results.Ok(new { source });
        });

        return app;
    }
}
