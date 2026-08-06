using System.Text.Json;
using Brmble.Server.DM;
using Brmble.Server.Companions;
using Brmble.Server.Events;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Brmble.Server.Messages;
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
            DmRoomRepository dmRoomRepository,
            UserRepository userRepository,
            IOptions<MatrixSettings> matrixSettings,
            IOptions<CustomCompanionOptions> customCompanionOptions,
            CustomCompanionGalleryService customCompanionGalleryService,
            IAclAuthorizationService aclAuthorization,
            ISessionMappingService sessionMapping,
            IMappingEventPublisher publisher,
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
                authService.TrackMumbleName(resolvedName, certHash, active: true);

            if (!string.IsNullOrEmpty(resolvedName) &&
                sessionMapping.TryGetSessionId(resolvedName, out var sid))
            {
                var companionId = await userRepository.GetCompanionId(result.UserId);
                var mappingAdded = false;
                // Mutations run inside the publisher's lock so the stamped revision is provably
                // the one they produced. Reading .Revision after mutating unsynchronised lets a
                // concurrent registration bump in between, and two payloads then claim one
                // revision — a client applies the first and discards the second as a duplicate.
                await publisher.PublishAsync(
                    () =>
                    {
                        mappingAdded = sessionMapping.TryAddMatrixUser(
                            sid, result.MatrixUserId, resolvedName, result.UserId, companionId);

                        // This user just authenticated via Brmble, so mark them as a Brmble
                        // client immediately. Authenticate() may have failed to update the
                        // mapping if TryAddMatrixUser hadn't been called yet (race with
                        // SessionMappingHandler).
                        //
                        // Ownership-constrained: `sid` came from a name lookup made outside this
                        // lock, so the session may since have been recycled to a different user.
                        // Updating by raw session id would write this user's certificate and
                        // status into that user's mapping and then announce it as their own.
                        return sessionMapping.TryClaimBrmbleSession(
                            sid, result.UserId, certHash, out _);
                    },
                    envelope =>
                    {
                        var wire = CompanionWireSelection.FromPersisted(companionId);
                        // A new mapping is announced as userMappingAdded; an existing one only
                        // changed its Brmble status, so it is announced as an activation.
                        // Either way the bumps above are announced rather than silent.
                        return mappingAdded
                            ? new
                            {
                                type = "userMappingAdded",
                                instanceId = envelope.InstanceId,
                                baseRevision = envelope.BaseRevision,
                                revision = envelope.Revision,
                                sessionId = sid,
                                matrixUserId = result.MatrixUserId,
                                mumbleName = resolvedName,
                                companionId = wire.CompanionId,
                                customCompanionId = wire.CustomCompanionId,
                                certHash,
                                isBrmbleClient = true
                            }
                            : (object)new
                            {
                                type = "brmbleClientActivated",
                                instanceId = envelope.InstanceId,
                                baseRevision = envelope.BaseRevision,
                                revision = envelope.Revision,
                                sessionId = sid
                            };
                    });
            }

            logger.LogInformation(
                "Auth succeeded: CertHash={CertHash}, MatrixUserId={MatrixUserId}, MumbleName={MumbleName}",
                certHash,
                result.MatrixUserId,
                resolvedName ?? "(none)");

            var roomMap = (await channelRepository.GetAllAsync())
                .ToDictionary(m => m.MumbleChannelId.ToString(), m => m.MatrixRoomId);

            var dmRooms = await dmRoomRepository.GetAllForUserAsync(result.UserId);
            var dmRoomMap = dmRooms.ToDictionary(r => r.OtherMatrixUserId, r => r.MatrixRoomId);

            var allUsers = await userRepository.GetAllAsync();
            // Group by display name and pick the most recently created user to handle duplicates
            var userMappings = allUsers
                .GroupBy(u => u.DisplayName)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(u => u.Id).First().MatrixUserId);

            // Ensure user is in all rooms, then sync display name
            await matrixAppService.EnsureUserInRooms(result.Localpart, roomMap.Values);
            var canModerateServer =
                await aclAuthorization.CanModerateServerAsync(result.UserId);
            CustomCompanionCapability? customCompanions = null;
            try
            {
                var galleryRoomId = await customCompanionGalleryService.GetOrCreateRoomIdAsync(
                    httpContext.RequestAborted);
                if (await matrixAppService.EnsureUserInRoom(result.Localpart, galleryRoomId))
                {
                    customCompanions = new(
                        Enabled: true,
                        SchemaVersion: 1,
                        GalleryRoomId: galleryRoomId,
                        TrustedSender: $"@brmble:{matrixSettings.Value.ServerDomain}",
                        CanModerate: canModerateServer,
                        SelectedCompanionId: await userRepository.GetCompanionId(result.UserId),
                        MaxActivePerUser: customCompanionOptions.Value.MaxActivePerUser,
                        MaxActiveTotal: customCompanionOptions.Value.MaxActiveTotal);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Custom companion gallery unavailable for {UserId}", result.UserId);
            }
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

            var passwordProtectedChannelIds = await httpContext.RequestServices
                .GetRequiredService<IAclSnapshotRepository>()
                .GetPasswordProtectedChannelIdsAsync();

            var matrixPayload = new Dictionary<string, object?>
            {
                ["homeserverUrl"] = publicHomeserverUrl,
                ["accessToken"] = result.MatrixAccessToken,
                ["userId"] = result.MatrixUserId,
                ["botUserId"] = $"@brmble:{matrixSettings.Value.ServerDomain}",
                ["roomMap"] = roomMap,
                ["dmRoomMap"] = dmRoomMap,
                ["messageDeletion"] = new
                {
                    canModerate = canModerateServer,
                    maxAgeMs = (long)MessageDeletionPolicy.DeletionWindow.TotalMilliseconds
                }
            };
            if (customCompanions is not null)
                matrixPayload["customCompanions"] = customCompanions;

            return Results.Ok(new
            {
                matrix = matrixPayload,
                userMappings,
                // Same envelope the WebSocket snapshot carries: this is the bootstrap
                // transport for the identical data, so it must be orderable too.
                // Keep revision above sessionMappings — initialisers evaluate in source order,
                // and a snapshot must never claim a revision newer than the data it holds.
                instanceId = sessionMapping.InstanceId,
                revision = sessionMapping.Revision,
                sessionMappings = sessionMapping.GetSnapshot()
                    .ToDictionary(
                        kvp => kvp.Key.ToString(),
                        kvp => SessionMappingWire.From(kvp.Value)),
                registered = result.IsRegistered,
                registeredName = result.DisplayName,
                passwordProtectedChannelIds,
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

        app.MapPost("/auth/companion", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepository,
            CustomCompanionEventCoordinator customCompanionEventCoordinator,
            CustomCompanionRepository customCompanionRepository,
            ISessionMappingService sessionMapping,
            IMappingEventPublisher publisher,
            ILogger<AuthService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepository.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            string? companionId = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                companionId = doc.RootElement.TryGetProperty("companionId", out var prop)
                    ? prop.GetString()
                    : null;
            }
            catch { /* empty or non-JSON body */ }

            if (CustomCompanionId.TryParse(companionId, out var eventId))
            {
                using (await customCompanionEventCoordinator.AcquireAsync(
                           eventId, httpContext.RequestAborted))
                {
                    if (await customCompanionRepository.GetActiveByEventIdAsync(eventId) is null)
                        return Results.BadRequest(new { error = "Invalid companion ID" });

                    return await PersistCompanionSelectionAsync(
                        user, companionId!, userRepository, sessionMapping,
                        publisher, logger);
                }
            }

            if (!UserRepository.TryNormalizeCompanionId(companionId, out var normalized))
                return Results.BadRequest(new { error = "Invalid companion ID" });

            return await PersistCompanionSelectionAsync(
                user, normalized, userRepository, sessionMapping,
                publisher, logger);
        });

        return app;
    }

    private static async Task<IResult> PersistCompanionSelectionAsync(
        User user,
        string companionId,
        UserRepository userRepository,
        ISessionMappingService sessionMapping,
        IMappingEventPublisher publisher,
        ILogger<AuthService> logger)
    {
        await userRepository.SetCompanionId(user.Id, companionId);

        // Resolve through TryGetMappingByUserId rather than TryGetSessionByUserId: the
        // userId→session index can outlive or disagree with the session→mapping table, so a
        // bare session lookup can point at a session with no mapping, or one that has since
        // been recycled to a different user. Announcing either would publish a change that
        // did not happen — or attribute it to somebody else. The update is then done with a
        // CAS on the owning userId, so a recycle racing between the lookup and the write
        // cannot land on the new owner's mapping either.
        var sessionId = 0;
        // Broadcast server-wide: clients keep a server-wide user list, and channel-scoped
        // delivery left everyone outside the user's channel with a stale selection until
        // their next reconnect (nothing re-delivers it on channel move).
        await publisher.PublishAsync(
            () => sessionMapping.TryGetMappingByUserId(user.Id, out sessionId, out _)
                  && sessionMapping.TryUpdateCompanionIdIfOwnedBy(sessionId, user.Id, companionId),
            envelope =>
            {
                var wire = CompanionWireSelection.FromPersisted(companionId);
                return new
                {
                    type = "companionChanged",
                    instanceId = envelope.InstanceId,
                    baseRevision = envelope.BaseRevision,
                    revision = envelope.Revision,
                    sessionId,
                    matrixUserId = user.MatrixUserId,
                    companionId = wire.CompanionId,
                    customCompanionId = wire.CustomCompanionId
                };
            });

        logger.LogInformation(
            "Companion updated: UserId={UserId}, CompanionId={CompanionId}",
            user.Id, companionId);
        var responseWire = CompanionWireSelection.FromPersisted(companionId);
        return Results.Ok(new
        {
            companionId = responseWire.CompanionId,
            customCompanionId = responseWire.CustomCompanionId
        });
    }
}
