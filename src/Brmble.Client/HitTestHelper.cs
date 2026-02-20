namespace Brmble.Client;

/// <summary>
/// Pure hit-test calculation for resize border detection.
/// Extracted for testability — no Win32 dependencies.
/// </summary>
public static class HitTestHelper
{
    public const int HtClient      = 1;
    public const int HtLeft        = 10;
    public const int HtRight       = 11;
    public const int HtTop         = 12;
    public const int HtTopLeft     = 13;
    public const int HtTopRight    = 14;
    public const int HtBottom      = 15;
    public const int HtBottomLeft  = 16;
    public const int HtBottomRight = 17;

    /// <summary>
    /// Returns a WM_NCHITTEST hit code for cursor position (x, y) inside a
    /// client rect of given width/height, using the specified border width (px).
    /// </summary>
    public static int Calculate(int x, int y, int width, int height, int borderWidth)
    {
        bool left   = x < borderWidth;
        bool right  = x >= width - borderWidth;
        bool top    = y < borderWidth;
        bool bottom = y >= height - borderWidth;

        if (top    && left)  return HtTopLeft;
        if (top    && right) return HtTopRight;
        if (bottom && left)  return HtBottomLeft;
        if (bottom && right) return HtBottomRight;
        if (top)             return HtTop;
        if (bottom)          return HtBottom;
        if (left)            return HtLeft;
        if (right)           return HtRight;
        return HtClient;
    }
}
