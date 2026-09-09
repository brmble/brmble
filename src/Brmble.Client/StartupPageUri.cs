namespace Brmble.Client;

internal enum StartupPageState
{
    Loading,
    Error
}

internal static class StartupPageUri
{
    public static string Build(bool useDevServer, string devServerUrl, StartupPageState state)
    {
        var baseUrl = useDevServer
            ? devServerUrl.TrimEnd('/')
            : $"https://{WebViewCacheConfig.VirtualHost}";

        return $"{baseUrl}/startup.html" +
            (state == StartupPageState.Error ? "?state=error" : string.Empty);
    }
}
