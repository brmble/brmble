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
                ws, user.Id, hash, sessionMapping, eventBus, activeSessions,
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
                var payloads = await BuildInitialPayloadsAsync(
                    context.RequestServices.GetRequiredService<IDuelSnapshotProvider>(),
                    resyncSessionId,
                    sessionMapping.GetSnapshot(),
                    new MappingEnvelope(sessionMapping.InstanceId, sessionMapping.Revision));

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

    internal static object CreateUserMappingAddedPayload(int sessionId, SessionMapping mapping, string certHash)
    {
        var wire = CompanionWireSelection.FromPersisted(mapping.CompanionId);
        return new
        {
            type = "userMappingAdded",
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
        IActiveBrmbleSessions activeSessions,
        IDuelSnapshotProvider snapshots) =>
        eventBus.AddClientAsync(socket, userId, async () =>
        {
            if (sessionMapping.TryGetMappingByUserId(userId, out var sessionId, out var mapping))
            {
                activeSessions.TrackMumbleName(mapping!.MumbleName, certHash, active: true);
                sessionMapping.TryUpdateBrmbleStatus(sessionId, true);
                sessionMapping.TryUpdateCertHash(sessionId, certHash);
                await eventBus.BroadcastExceptAsync(
                    socket, CreateUserMappingAddedPayload(sessionId, mapping, certHash));
            }

            sessionMapping.TryGetSessionByUserId(userId, out var queueSessionId);
            return await BuildInitialPayloadsAsync(
                snapshots, queueSessionId, sessionMapping.GetSnapshot(),
                new MappingEnvelope(sessionMapping.InstanceId, sessionMapping.Revision));
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
            kvp =>
            {
                var wire = CompanionWireSelection.FromPersisted(kvp.Value.CompanionId);
                return new
                {
                    matrixUserId = kvp.Value.MatrixUserId,
                    mumbleName = kvp.Value.MumbleName,
                    companionId = wire.CompanionId,
                    customCompanionId = wire.CustomCompanionId,
                    certHash = kvp.Value.CertHash,
                    isBrmbleClient = kvp.Value.IsBrmbleClient,
                };
            });
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
