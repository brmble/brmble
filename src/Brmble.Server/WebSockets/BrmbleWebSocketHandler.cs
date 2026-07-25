using System.Net.WebSockets;
using Brmble.Server.Auth;
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
                context.RequestServices.GetRequiredService<IDuelSnapshotProvider>(),
                context.RequestAborted);

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

    internal static async Task InitializeAcceptedClientAsync(
        WebSocket socket,
        long userId,
        string certHash,
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        IActiveBrmbleSessions activeSessions,
        IDuelSnapshotProvider snapshots,
        CancellationToken cancellationToken)
    {
        eventBus.AddPausedClient(socket, userId);
        try
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
            await InitializeClientAsync(
                socket, eventBus, snapshots, queueSessionId, sessionMapping.GetSnapshot(), cancellationToken);
        }
        catch
        {
            eventBus.RemoveClient(socket);
            throw;
        }
    }

    internal static async Task InitializeClientAsync(
        WebSocket socket,
        IBrmbleEventBus eventBus,
        IDuelSnapshotProvider snapshots,
        long sessionId,
        IReadOnlyDictionary<int, SessionMapping> mappings,
        CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = mappings.ToDictionary(
                kvp => kvp.Key.ToString(),
                kvp => new
                {
                    matrixUserId = kvp.Value.MatrixUserId,
                    mumbleName = kvp.Value.MumbleName,
                    companionId = kvp.Value.CompanionId,
                    certHash = kvp.Value.CertHash,
                    isBrmbleClient = kvp.Value.IsBrmbleClient,
                });
            var initial = new List<object> { new { type = "sessionMappingSnapshot", mappings = snapshot } };
            if (sessionId != 0)
                initial.Add(DuelWire.ToEvent(await snapshots.GetSnapshotForSessionAsync(sessionId)));
            await eventBus.CompleteInitializationAsync(socket, initial, cancellationToken);
        }
        catch
        {
            eventBus.RemoveClient(socket);
            throw;
        }
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
