namespace Brmble.Client;

/// <summary>
/// Single source of truth for app identity values that must stay in sync with
/// the Velopack --packId / --packTitle used in the release workflow.
/// </summary>
internal static class AppIdentity
{
    /// <summary>Velopack --packId. Also the name used for shortcuts and install folder.</summary>
    public const string PackId = "Brmble";

    /// <summary>
    /// Windows AppUserModelID (CompanyName.ProductName format).
    /// Set on the running process and stamped onto .lnk shortcuts so the
    /// taskbar groups them together and respects runtime WM_SETICON updates.
    /// </summary>
    public const string AppUserModelId = "Brmble.Brmble";
}
