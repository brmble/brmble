namespace Brmble.Client.Services.Voice.Input;

/// <summary>
/// Logical mouse button identity for the dispatch table. Bridge between
/// the user-facing key name (e.g. "MouseLeft", "XButton2") and Win32 hook
/// message routing.
/// </summary>
public enum MouseButton
{
    Left,
    Right,
    Middle,
    X1,
    X2,
}

public static class MouseButtonExtensions
{
    /// <summary>
    /// Maps a key name from settings to a MouseButton. Returns null for
    /// non-mouse key names.
    /// </summary>
    public static MouseButton? FromKeyName(string? key) => key switch
    {
        "MouseLeft" => MouseButton.Left,
        "MouseRight" => MouseButton.Right,
        "MouseMiddle" => MouseButton.Middle,
        "XButton1" or "MouseXButton1" => MouseButton.X1,
        "XButton2" or "MouseXButton2" => MouseButton.X2,
        _ => null,
    };
}
