using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;
using Brmble.Server.Games.Duels;

namespace Brmble.Server.WebSockets;

public static class BrmbleWebSocketHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

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
        if (sessionMapping.TryGetMappingByUserId(user.Id, out var currentSessionId, out var currentMapping))
        {
            activeSessions.TrackMumbleName(currentMapping!.MumbleName, hash, active: true);
            sessionMapping.TryUpdateBrmbleStatus(currentSessionId, true);
            sessionMapping.TryUpdateCertHash(currentSessionId, hash);
            await eventBus.BroadcastAsync(CreateUserMappingAddedPayload(currentSessionId, currentMapping, hash));
        }

        eventBus.AddClient(ws, user.Id);

        try
        {
            if (sessionMapping.TryGetSessionByUserId(user.Id, out var queueSessionId))
                await SendQueueSnapshotAsync(
                    ws,
                    context.RequestServices.GetRequiredService<IDuelSnapshotProvider>(),
                    queueSessionId,
                    context.RequestAborted);

            // Send initial snapshot
            var snapshot = sessionMapping.GetSnapshot()
                .ToDictionary(
                    kvp => kvp.Key.ToString(),
                    kvp => new
                    {
                        matrixUserId = kvp.Value.MatrixUserId,
                        mumbleName = kvp.Value.MumbleName,
                        companionId = kvp.Value.CompanionId,
                        certHash = kvp.Value.CertHash,
                        isBrmbleClient = kvp.Value.IsBrmbleClient
                    });
            var snapshotJson = JsonSerializer.Serialize(new { type = "sessionMappingSnapshot", mappings = snapshot }, JsonOptions);
            var snapshotBytes = Encoding.UTF8.GetBytes(snapshotJson);
            await ws.SendAsync(snapshotBytes, WebSocketMessageType.Text, true, context.RequestAborted);

            // Read loop until close
            var buffer = new byte[1024];
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, context.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                    break;
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

    internal static async Task SendQueueSnapshotAsync(
        WebSocket socket,
        IDuelSnapshotProvider snapshots,
        long sessionId,
        CancellationToken cancellationToken)
    {
        var payload = DuelWire.ToEvent(await snapshots.GetSnapshotForSessionAsync(sessionId));
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, DuelWire.JsonOptions));
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }

    internal static object CreateUserMappingAddedPayload(int sessionId, SessionMapping mapping, string certHash) => new
    {
        type = "userMappingAdded",
        sessionId,
        matrixUserId = mapping.MatrixUserId,
        mumbleName = mapping.MumbleName,
        certHash,
        isBrmbleClient = true
    };
}
