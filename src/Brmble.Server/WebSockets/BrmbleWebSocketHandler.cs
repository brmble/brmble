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
        var publisher = context.RequestServices.GetRequiredService<IMappingEventPublisher>();

        using var ws = await context.WebSockets.AcceptWebSocketAsync();
        try
        {
            await InitializeAcceptedClientAsync(
                ws, user.Id, hash, sessionMapping, eventBus, publisher, activeSessions,
                context.RequestServices.GetRequiredService<IDuelSnapshotProvider>());

            // Read loop until close. Messages are reassembled across frames. A message that
            // exceeds the cap is discarded in full rather than truncated: truncating would let a
            // client send a valid short prefix followed by megabytes of padding and still have
            // the prefix honoured, which is an amplification vector rather than a limit.
            const int MaxClientMessageBytes = 8 * 1024;
            // Rebuilding a snapshot is server-wide work, so an authenticated client cannot be
            // allowed to drive it in a loop. The read loop is sequential per socket, so one
            // request is in flight at a time; this bounds the rate as well. A client refused
            // here simply asks again after its next gap detection.
            var snapshotCooldown = TimeSpan.FromSeconds(1);
            var lastSnapshot = DateTimeOffset.MinValue;
            var buffer = new byte[1024];
            var accumulated = new MemoryStream();
            var oversized = false;
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, context.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                    break;
                }

                // Only text frames carry client messages. A binary frame is not something this
                // protocol defines, so it is dropped rather than UTF8-decoded and guessed at.
                if (result.MessageType != WebSocketMessageType.Text)
                {
                    if (result.EndOfMessage) { accumulated.SetLength(0); oversized = false; }
                    continue;
                }

                if (accumulated.Length + result.Count > MaxClientMessageBytes)
                    oversized = true;
                else
                    accumulated.Write(buffer, 0, result.Count);

                if (!result.EndOfMessage) continue;

                var json = oversized ? null : System.Text.Encoding.UTF8.GetString(accumulated.ToArray());
                accumulated.SetLength(0);
                oversized = false;

                if (json is null) continue;
                if (!TryParseClientMessage(json, out var messageType)) continue;
                if (messageType != "requestSnapshot") continue;

                var now = DateTimeOffset.UtcNow;
                if (now - lastSnapshot < snapshotCooldown) continue;
                lastSnapshot = now;

                // The mapping snapshot is captured and enqueued under the publisher's ordering
                // gate, before anything is awaited. Building it alongside the duel payload would
                // leave a window in which an event at a later revision reaches this socket first,
                // and the client would either discard the repair it was waiting for or apply the
                // event and be rolled back by the older snapshot.
                await publisher.PublishSnapshotAsync(ws, (envelope, snapshot) =>
                    CreateSessionMappingSnapshotPayload(snapshot, envelope));

                // Unrelated to mapping ordering, so it can safely follow an await.
                sessionMapping.TryGetSessionByUserId(user.Id, out var resyncSessionId);
                if (resyncSessionId != 0)
                {
                    var duels = context.RequestServices.GetRequiredService<IDuelSnapshotProvider>();
                    await eventBus.SendToClientAsync(
                        ws, DuelWire.ToEvent(await duels.GetSnapshotForSessionAsync(resyncSessionId)));
                }
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
                // One atomic, ownership-constrained claim rather than two blind updates followed
                // by an ownership check. Checking afterwards is too late: if the session was
                // recycled between the read above and this lock, the blind updates would already
                // have written this user's certificate and Brmble status into somebody else's
                // mapping, and the failed check would then suppress the announcement — corrupting
                // the projection and leaving two unannounced revision bumps behind.
                //
                // The claim also returns the post-mutation mapping, so the payload cannot carry
                // the value captured outside the lock: a companionChanged landing in between
                // would otherwise ship an older companionId under a newer revision, and every
                // client would overwrite the newer value with the stale one.
                await publisher.PublishExceptAsync(
                    socket,
                    () => sessionMapping.TryClaimBrmbleSession(sessionId, userId, certHash, out announced),
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
        var initial = new List<object> { CreateSessionMappingSnapshotPayload(mappings, envelope) };
        if (sessionId != 0)
            initial.Add(DuelWire.ToEvent(await snapshots.GetSnapshotForSessionAsync(sessionId)));
        return initial;
    }

    /// <summary>
    /// The complete statement of every session the server knows about. Shared by the bootstrap
    /// and resync paths so both describe membership identically.
    /// </summary>
    internal static object CreateSessionMappingSnapshotPayload(
        IReadOnlyDictionary<int, SessionMapping> mappings, MappingEnvelope envelope) =>
        new
        {
            type = "sessionMappingSnapshot",
            instanceId = envelope.InstanceId,
            revision = envelope.Revision,
            mappings = mappings.ToDictionary(
                kvp => kvp.Key.ToString(),
                kvp => SessionMappingWire.From(kvp.Value))
        };

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
