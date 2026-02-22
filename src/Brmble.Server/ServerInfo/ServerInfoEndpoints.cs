using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.ServerInfo;

public static class ServerInfoEndpoints
{
    public static IEndpointRouteBuilder MapServerInfoEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/server-info", (
            IOptions<ServerInfoSettings> serverInfo,
            IOptions<MatrixSettings> matrix) =>
        {
            return Results.Ok(new
            {
                mumbleHost = serverInfo.Value.MumbleHost,
                mumblePort = serverInfo.Value.MumblePort,
                matrixHomeserverUrl = matrix.Value.HomeserverUrl
            });
        });

        return app;
    }
}
