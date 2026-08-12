using System.ComponentModel.DataAnnotations;

namespace Brmble.Server.Matrix;

public class MatrixSettings
{
    [Required] public string HomeserverUrl { get; init; } = null!;
    [Required] public string AppServiceToken { get; init; } = null!;
    public string? AdminAccessToken { get; init; }
    public string ServerDomain { get; set; } = "localhost";
    /// <summary>
    /// Public URL clients use to reach Matrix via YARP proxy.
    /// If omitted, derived from the incoming request's scheme + host.
    /// </summary>
    public string? PublicHomeserverUrl { get; init; }
    [Range(5, 1440)] public int AccessTokenLifetimeMinutes { get; set; } = 60;
    [Range(1, 60)] public int AccessTokenRefreshSkewMinutes { get; set; } = 5;
    [Range(5, 300)] public int AccessTokenRevocationSweepSeconds { get; set; } = 30;
    [Range(30, 3600)] public int AccessTokenRevocationRetryBaseSeconds { get; set; } = 60;
    [Range(60, 86400)] public int AccessTokenRevocationRetryMaxSeconds { get; set; } = 900;
}
