using System.Net.WebSockets;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Companions;
using Brmble.Server.Events;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.WebSockets;

public static class BrmbleWebSocketHandler
{
    public static async Task HandleAsync(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = 400;
            return;
        }

        var cert = context.Connection.ClientCertificate;
        if (cert is null)
        {
            context.Response.StatusCode = 401;
            return;
        }

        var userRepo = context.RequestServices.GetRequiredService<UserRepository>();
        var hash = CertificateHasher.HashDer(cert.RawData);
        var user = await userRepo.GetByCertHash(hash);
        if (user is null)
        {
            context.Response.StatusCode = 401;
            return;
        }

        var sessionMapping = context.RequestServices.GetRequiredService<ISessionMappingService>();
        var eventBus = context.RequestServices.GetRequiredService<IBrmbleEventBus>();
        var activeSessions = context.RequestServices.GetRequiredService<IActiveBrmbleSessions>();

        using var ws = await context.WebSockets.AcceptWebSocketAsync();
        try
        {
            await InitializeAcceptedClientAsync(
                ws, user.Id, hash, sessionMapping, eventBus,
                context.RequestServices.GetRequiredService<IMappingEventPublisher>(),
                activeSessions,
                context.RequestServices.GetRequiredService<IDuelSnapshotProvider>());

            // Read loop until close. Messages are reassembled across frames; anything larger
            // than the cap is discarded rather than buffered, so a client cannot exhaust memory.
            const int MaxClientMessageBytes = 8 * 1024;
            var buffer = new byte[1024];
            var accumulated = new MemoryStream();
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, context.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                    break;
                }

                if (accumulated.Length + result.Count <= MaxClientMessageBytes)
                    accumulated.Write(buffer, 0, result.Count);

                if (!result.EndOfMessage) continue;

                var json = System.Text.Encoding.UTF8.GetString(accumulated.ToArray());
                accumulated.SetLength(0);

                if (!TryParseClientMessage(json, out var messageType)) continue;
                if (messageType != "requestSnapshot") continue;

                sessionMapping.TryGetSessionByUserId(user.Id, out var resyncSessionId);
                // Read the revision before the snapshot, never after. If a mutation lands in
                // between, the snapshot then under-claims: the client re-applies an event it
                // already reflects, which is idempotent. Reading it after would over-claim, and
                // the client would discard the intervening events as duplicates forever.
                var resyncEnvelope = new MappingEnvelope(
                    sessionMapping.InstanceId, sessionMapping.Revision);
                var payloads = await BuildInitialPayloadsAsync(
                    context.RequestServices.GetRequiredService<IDuelSnapshotProvider>(),
                    resyncSessionId,
                    sessionMapping.GetSnapshot(),
                    resyncEnvelope);

                foreach (var payload in payloads)
                    await eventBus.SendToClientAsync(ws, payload);
            }
        }
        catch (WebSocketException) { /* client disconnected */ }
        catch (OperationCanceledException) { /* server shutting down */ }
        finally
        {
            eventBus.RemoveClient(ws);
            if (!eventBus.HasConnectedClient(user.Id))
                activeSessions.Deactivate(hash);
        }
    }

    internal static object CreateUserMappingAddedPayload(
        int sessionId, SessionMapping mapping, string certHash, MappingEnvelope envelope)
    {
        var wire = CompanionWireSelection.FromPersisted(mapping.CompanionId);
        return new
        {
            type = "userMappingAdded",
            instanceId = envelope.InstanceId,
            revision = envelope.Revision,
            sessionId,
            matrixUserId = mapping.MatrixUserId,
            mumbleName = mapping.MumbleName,
            companionId = wire.CompanionId,
            customCompanionId = wire.CustomCompanionId,
            certHash,
            isBrmbleClient = true
        };
    }
    /// <summary>
    /// Registers an accepted socket and hands it its initial payloads. The mapping mutation
    /// and its announcement run inside the registration window, so the joining client is
    /// already visible to broadcasts and misses nothing that happens while its snapshots are
    /// being built. It is excluded from the announcement itself because its own snapshot
    /// already carries that mapping.
    /// </summary>
    internal static Task InitializeAcceptedClientAsync(
        WebSocket socket,
        long userId,
        string certHash,
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        IMappingEventPublisher publisher,
        IActiveBrmbleSessions activeSessions,
        IDuelSnapshotProvider snapshots) =>
        eventBus.AddClientAsync(socket, userId, async () =>
        {
            if (sessionMapping.TryGetMappingByUserId(userId, out var sessionId, out var mapping))
            {
                activeSessions.TrackMumbleName(mapping!.MumbleName, certHash, active: true);

                SessionMapping? announced = null;
                // Mutations run inside the publisher's lock so the stamped revision is provably
                // the one they produced; a concurrent registration would otherwise let two
                // payloads claim the same revision.
                await publisher.PublishExceptAsync(
                    socket,
                    () =>
                    {
                        var changed = sessionMapping.TryUpdateBrmbleStatus(sessionId, true);
                        changed |= sessionMapping.TryUpdateCertHash(sessionId, certHash);

                        // Nothing moved, so the mapping was removed between the read above and
                        // this lock. Announcing anyway would emit a userMappingAdded for a
                        // mapping that no longer exists, stamped with a revision this operation
                        // did not produce and which another payload already owns.
                        if (!changed) return false;

                        // Re-read under the lock rather than announcing the value captured
                        // above. A companionChanged landing in between would otherwise be
                        // undone: the payload would carry the older companionId under this
                        // operation's newer revision, so every client would overwrite the newer
                        // value with the stale one. Requiring the same session id also rejects
                        // a mapping recycled to a different user mid-flight.
                        return sessionMapping.TryGetMappingByUserId(
                                   userId, out var currentSessionId, out announced)
                               && currentSessionId == sessionId
                               && announced is not null;
                    },
                    envelope => CreateUserMappingAddedPayload(sessionId, announced!, certHash, envelope));
            }

            sessionMapping.TryGetSessionByUserId(userId, out var queueSessionId);
            // Revision before snapshot: see the note on the resync path. Under-claiming is
            // self-correcting, over-claiming silently drops the intervening events.
            var bootstrapEnvelope = new MappingEnvelope(
                sessionMapping.InstanceId, sessionMapping.Revision);
            return await BuildInitialPayloadsAsync(
                snapshots, queueSessionId, sessionMapping.GetSnapshot(), bootstrapEnvelope);
        });

    /// <summary>
    /// Builds the payloads a freshly registered client needs before it can interpret any
    /// subsequent event: the session mapping snapshot, plus the duel queue snapshot when the
    /// user has a Mumble session.
    /// </summary>
    internal static async Task<IReadOnlyList<object>> BuildInitialPayloadsAsync(
        IDuelSnapshotProvider snapshots,
        long sessionId,
        IReadOnlyDictionary<int, SessionMapping> mappings,
        MappingEnvelope envelope)
    {
        var snapshot = mappings.ToDictionary(
            kvp => kvp.Key.ToString(),
            kvp => SessionMappingWire.From(kvp.Value));
        var initial = new List<object>
        {
            new
            {
                type = "sessionMappingSnapshot",
                instanceId = envelope.InstanceId,
                revision = envelope.Revision,
                mappings = snapshot
            }
        };
        if (sessionId != 0)
            initial.Add(DuelWire.ToEvent(await snapshots.GetSnapshotForSessionAsync(sessionId)));
        return initial;
    }

    /// <summary>
    /// Parses a client-to-server frame. Returns false for anything unparseable rather than
    /// throwing: a malformed frame must never take the socket down.
    /// </summary>
    internal static bool TryParseClientMessage(string json, out string type)
    {
        type = string.Empty;
        if (string.IsNullOrWhiteSpace(json)) return false;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty("type", out var typeProperty)) return false;
            if (typeProperty.ValueKind != JsonValueKind.String) return false;
            type = typeProperty.GetString() ?? string.Empty;
            return type.Length > 0;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
