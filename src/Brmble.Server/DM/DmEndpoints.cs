using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.DM;

public static class DmEndpoints
{
    public static IEndpointRouteBuilder MapDmEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/dm/room", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepository,
            DmRoomRepository dmRoomRepository,
            IMatrixAppService matrixAppService,
            IOptions<MatrixSettings> matrixSettings,
            ILogger<DmRoomRepository> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var callingUser = await userRepository.GetByCertHash(certHash);
            if (callingUser is null)
                return Results.Unauthorized();

            // Parse target user from request body
            string? targetMatrixUserId;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                targetMatrixUserId = doc.RootElement.TryGetProperty("targetMatrixUserId", out var prop)
                    ? prop.GetString() : null;
            }
            catch
            {
                return Results.BadRequest(new { error = "Invalid request body" });
            }

            if (string.IsNullOrWhiteSpace(targetMatrixUserId))
                return Results.BadRequest(new { error = "targetMatrixUserId is required" });

            var targetUser = await userRepository.GetByMatrixUserId(targetMatrixUserId);
            if (targetUser is null)
                return Results.NotFound(new { error = "Target user not found" });

            if (callingUser.Id == targetUser.Id)
                return Results.BadRequest(new { error = "Cannot create a DM room with yourself" });

            // Canonicalize the pair so (A,B) and (B,A) map to the same row
            var idLow = Math.Min(callingUser.Id, targetUser.Id);
            var idHigh = Math.Max(callingUser.Id, targetUser.Id);

            // Check for existing room
            var existingRoomId = await dmRoomRepository.GetRoomIdAsync(idLow, idHigh);
            if (existingRoomId is not null)
            {
                logger.LogDebug("DM room already exists for ({Low},{High}): {RoomId}", idLow, idHigh, existingRoomId);
                return Results.Ok(new { roomId = existingRoomId });
            }

            // Extract localparts from matrix user IDs (e.g. "@42:brmble.zone" -> "42")
            var serverDomain = matrixSettings.Value.ServerDomain;
            var callingLocalpart = callingUser.MatrixUserId.TrimStart('@').Split(':')[0];
            var targetLocalpart = targetUser.MatrixUserId.TrimStart('@').Split(':')[0];

            // Create the DM room via appservice
            string roomId;
            try
            {
                roomId = await matrixAppService.CreateDMRoom(callingLocalpart, targetLocalpart);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to create DM room for ({Low},{High})", idLow, idHigh);
                return Results.StatusCode(502);
            }

            // Set m.direct account data for both users
            await SetMDirectForUser(matrixAppService, callingLocalpart, targetUser.MatrixUserId, roomId, logger);
            await SetMDirectForUser(matrixAppService, targetLocalpart, callingUser.MatrixUserId, roomId, logger);

            // Persist the mapping
            await dmRoomRepository.InsertAsync(idLow, idHigh, roomId);

            logger.LogInformation(
                "Created DM room {RoomId} for ({CallingUser},{TargetUser})",
                roomId, callingUser.MatrixUserId, targetUser.MatrixUserId);

            return Results.Ok(new { roomId });
        });

        return app;
    }

    /// <summary>
    /// Read the user's existing m.direct account data, merge the new room, and write it back.
    /// </summary>
    private static async Task SetMDirectForUser(
        IMatrixAppService matrixAppService,
        string localpart,
        string otherMatrixUserId,
        string roomId,
        ILogger logger)
    {
        try
        {
            // Read existing m.direct
            var existing = await matrixAppService.GetAccountData(localpart, "m.direct");
            var directContent = new Dictionary<string, List<string>>();

            if (existing is not null)
            {
                try
                {
                    var parsed = JsonSerializer.Deserialize<Dictionary<string, List<string>>>(existing);
                    if (parsed is not null)
                        directContent = parsed;
                }
                catch
                {
                    // Malformed m.direct — start fresh for this user
                    logger.LogWarning("Malformed m.direct for user {Localpart}, resetting", localpart);
                }
            }

            // Merge the new room
            if (!directContent.ContainsKey(otherMatrixUserId))
                directContent[otherMatrixUserId] = new List<string>();

            if (!directContent[otherMatrixUserId].Contains(roomId))
                directContent[otherMatrixUserId].Insert(0, roomId);

            // Write back
            var json = JsonSerializer.Serialize(directContent);
            await matrixAppService.SetAccountData(localpart, "m.direct", json);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to set m.direct for user {Localpart}", localpart);
        }
    }
}
