using System.Net.WebSockets;
using Brmble.Server.Auth;
using Brmble.Server.Events;

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
        if (sessionMapping.TryGetMappingByUserId(user.Id, out var currentSessionId, out var currentMapping))
        {
            activeSessions.TrackMumbleName(currentMapping!.MumbleName, hash, active: true);
            sessionMapping.TryUpdateBrmbleStatus(currentSessionId, true);
            sessionMapping.TryUpdateCertHash(currentSessionId, hash);
            await eventBus.BroadcastAsync(CreateUserMappingAddedPayload(currentSessionId, currentMapping, hash));
        }

        try
        {
            // Register the client and queue its snapshot atomically, so a concurrent
            // broadcast cannot be delivered ahead of the snapshot it amends.
            await eventBus.AddClientAsync(ws, user.Id, () =>
            {
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
                return new { type = "sessionMappingSnapshot", mappings = snapshot };
            });

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
