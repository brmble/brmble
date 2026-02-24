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

    public async Task InvokeAsync(HttpContext context)
    {
        var connection = context.Connection;
        var clientCert = connection.ClientCertificate;

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
        else
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
