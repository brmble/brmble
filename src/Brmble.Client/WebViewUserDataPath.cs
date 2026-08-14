namespace Brmble.Client;

internal static class WebViewUserDataPath
{
    public static string GetStablePath(string? localApplicationData = null)
    {
        var root = localApplicationData
            ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        return Path.GetFullPath(Path.Combine(root, "Brmble", "WebView2"));
    }

    public static IReadOnlyList<string> GetKnownLegacyPaths(string? localApplicationData = null)
    {
        var root = localApplicationData
            ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        return
        [
            Path.GetFullPath(Path.Combine(root, "Brmble", "current", "Brmble.Client.exe.WebView2")),
        ];
    }
}
