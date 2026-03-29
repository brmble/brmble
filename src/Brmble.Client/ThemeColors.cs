namespace Brmble.Client;

/// <summary>
/// Maps theme IDs to their accent-primary RGB colors for native icon rendering.
/// These values must stay in sync with the --accent-primary CSS tokens in src/Brmble.Web/src/themes/.
/// </summary>
internal static class ThemeColors
{
    public static (byte R, byte G, byte B) GetAccent(string? themeName)
    {
        return themeName switch
        {
            "classic"        => (0xD4, 0x14, 0x5A), // #d4145a
            "clean"          => (0xD4, 0x14, 0x5A), // #d4145a (inherits classic)
            "blue-lagoon"    => (0x00, 0xB4, 0xD8), // #00b4d8
            "cosmopolitan"   => (0xE6, 0x39, 0x62), // #e63962
            "aperol-spritz"  => (0xE8, 0x65, 0x1A), // #e8651a
            "midori-sour"    => (0x00, 0xC8, 0x53), // #00c853
            "lemon-drop"     => (0xF5, 0xC5, 0x18), // #f5c518
            "retro-terminal" => (0x33, 0xFF, 0x00), // #33ff00
            _                => (0xD4, 0x14, 0x5A), // default to classic
        };
    }

    /// <summary>
    /// Returns the --bg-deep color for the given theme.
    /// These values must stay in sync with the CSS tokens in src/Brmble.Web/src/themes/.
    /// </summary>
    public static (byte R, byte G, byte B) GetBgDeep(string? themeName)
    {
        return themeName switch
        {
            "classic"        => (0x0F, 0x0A, 0x14), // #0f0a14
            "clean"          => (0x0F, 0x0A, 0x14), // #0f0a14 (inherits classic)
            "blue-lagoon"    => (0x0B, 0x13, 0x18), // #0b1318
            "cosmopolitan"   => (0x14, 0x0A, 0x0D), // #140a0d
            "aperol-spritz"  => (0x14, 0x0E, 0x08), // #140e08
            "midori-sour"    => (0x08, 0x12, 0x10), // #081210
            "lemon-drop"     => (0x13, 0x11, 0x08), // #131108
            "retro-terminal" => (0x00, 0x00, 0x00), // #000000
            _                => (0x0F, 0x0A, 0x14), // default to classic
        };
    }

    /// <summary>
    /// Resolves the path to a theme's brmble.ico file.
    /// Falls back to the root Resources/brmble.ico if the theme folder doesn't exist.
    /// </summary>
    public static string GetIconPath(string? themeName)
    {
        if (!string.IsNullOrEmpty(themeName))
        {
            var themed = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", themeName, "brmble.ico");
            if (File.Exists(themed)) return themed;
        }
        return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "brmble.ico");
    }
}
