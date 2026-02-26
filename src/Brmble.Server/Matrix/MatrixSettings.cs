using System.ComponentModel.DataAnnotations;

namespace Brmble.Server.Matrix;

public class MatrixSettings
{
    [Required] public string HomeserverUrl { get; init; } = null!;
    [Required] public string AppServiceToken { get; init; } = null!;
    public string ServerDomain { get; init; } = "localhost";
    /// <summary>
    /// Public URL clients use to reach Matrix via YARP proxy.
    /// If omitted, derived from the incoming request's scheme + host.
    /// </summary>
    public string? PublicHomeserverUrl { get; init; }
}
