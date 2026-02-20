using System.ComponentModel.DataAnnotations;

namespace Brmble.Server.Matrix;

public class MatrixSettings
{
    [Required] public string HomeserverUrl { get; init; } = null!;
    [Required] public string AppServiceToken { get; init; } = null!;
    public string ServerDomain { get; init; } = "localhost";
}
