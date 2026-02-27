namespace Brmble.Server.Middleware;

public class ConnectionLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ConnectionLoggingMiddleware> _logger;

    public ConnectionLoggingMiddleware(RequestDelegate next, ILogger<ConnectionLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    private static readonly HashSet<string> SkippedPaths = ["/health"];

    private static readonly string[] ProxiedPrefixes = ["/_matrix/", "/livekit/"];

    public async Task InvokeAsync(HttpContext context)
    {
        if (SkippedPaths.Contains(context.Request.Path))
        {
            await _next(context);
            return;
        }

        var connection = context.Connection;
        var clientCert = connection.ClientCertificate;
        var path = context.Request.Path.Value ?? "";
        var isProxiedRoute = ProxiedPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase));

        if (clientCert is not null)
        {
            _logger.LogInformation(
                "Request {Method} {Path} from {RemoteIp}:{RemotePort} — client cert present: Subject={Subject}, Thumbprint={Thumbprint}, NotAfter={NotAfter}",
                context.Request.Method,
                context.Request.Path,
                connection.RemoteIpAddress,
                connection.RemotePort,
                clientCert.Subject,
                clientCert.Thumbprint,
                clientCert.NotAfter);
        }
        else if (!isProxiedRoute)
        {
            _logger.LogWarning(
                "Request {Method} {Path} from {RemoteIp}:{RemotePort} — no client certificate presented",
                context.Request.Method,
                context.Request.Path,
                connection.RemoteIpAddress,
                connection.RemotePort);
        }

        await _next(context);
    }
}
