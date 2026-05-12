using Microsoft.Web.WebView2.Core;

namespace Brmble.Client;

internal static class WebViewCacheConfig
{
    public const string VirtualHost = "brmble.local";

    // Vite content-hashes JS/CSS bundle filenames, so those are safe to cache
    // normally. index.html and overlay.html keep their names across releases,
    // and WebView2 persists its HTTP cache in the user data folder between
    // sessions. Without this, a stale cached HTML can keep referencing
    // hashed bundles that no longer exist after an update, breaking the app.
    public static void DisableHtmlCacheForVirtualHost(
        CoreWebView2 webView,
        CoreWebView2Environment env,
        string webRoot)
    {
        webView.AddWebResourceRequestedFilter(
            $"https://{VirtualHost}/*.html",
            CoreWebView2WebResourceContext.Document);

        var rootFull = Path.GetFullPath(webRoot);

        webView.WebResourceRequested += (_, args) =>
        {
            try
            {
                var uri = new Uri(args.Request.Uri);
                var relativePath = uri.AbsolutePath.TrimStart('/');
                var fullPath = Path.GetFullPath(Path.Combine(rootFull, relativePath));

                if (!fullPath.StartsWith(rootFull + Path.DirectorySeparatorChar,
                        StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }

                if (!File.Exists(fullPath))
                {
                    return;
                }

                var stream = File.OpenRead(fullPath);
                try
                {
                    args.Response = env.CreateWebResourceResponse(
                        stream,
                        200,
                        "OK",
                        "Content-Type: text/html; charset=utf-8\r\n" +
                        "Cache-Control: no-store, must-revalidate\r\n" +
                        "Pragma: no-cache\r\n" +
                        "Expires: 0");
                }
                catch
                {
                    stream.Dispose();
                    throw;
                }
            }
            catch
            {
                // Fall back to WebView2's default virtual-host handler on any error.
            }
        };
    }
}
