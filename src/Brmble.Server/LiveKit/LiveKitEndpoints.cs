namespace Brmble.Server.LiveKit;

public static class LiveKitEndpoints
{
    public static IEndpointRouteBuilder MapLiveKitEndpoints(this IEndpointRouteBuilder app)
    {
        // TODO: POST /livekit/token
        //   - Extract cert hash from mTLS handshake
        //   - Call LiveKitService.GenerateToken(certHash, roomName, permissions)
        //   - Return JWT to client
        return app;
    }
}
