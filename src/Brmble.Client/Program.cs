using System.Diagnostics;
using System.Drawing;
using System.Net.Sockets;
using Microsoft.Web.WebView2.Core;

namespace Brmble.Client;

static class Program
{
    private const string DevServerUrl = "http://localhost:5173";
    private const int DevServerPort = 5173;

    private static CoreWebView2Controller? _controller;
    private static WebViewBridge? _bridge;
    private static MumbleClient? _mumbleClient;

    [STAThread]
    static void Main()
    {
        var useDevServer = IsDevServerRunning();
        Debug.WriteLine(useDevServer
            ? "Brmble: Using Vite dev server"
            : "Brmble: Using local files");

        var hwnd = Win32Window.Create("BrmbleWindow", "Brmble", 1280, 720, WndProc);
        _ = InitWebView2Async(hwnd, useDevServer);
        Win32Window.RunMessageLoop();
    }

    private static async Task InitWebView2Async(IntPtr hwnd, bool useDevServer)
    {
        var env = await CoreWebView2Environment.CreateAsync();
        _controller = await env.CreateCoreWebView2ControllerAsync(hwnd);

        Win32Window.GetClientRect(hwnd, out var rect);
        _controller.Bounds = new Rectangle(0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top);
        _controller.IsVisible = true;

        var webRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
        _controller.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "brmble.local", webRoot, CoreWebView2HostResourceAccessKind.Allow);

        _bridge = new WebViewBridge(_controller.CoreWebView2, hwnd);
        
        _mumbleClient = new MumbleClient(_bridge);
        
        SetupBridgeHandlers();

        if (useDevServer)
            _controller.CoreWebView2.Navigate(DevServerUrl);
        else
            _controller.CoreWebView2.Navigate("https://brmble.local/index.html");
    }

    private static void SetupBridgeHandlers()
    {
        _mumbleClient!.RegisterHandlers(_bridge);
    }

    private static bool IsDevServerRunning()
    {
        try
        {
            using var tcp = new TcpClient();
            tcp.Connect("localhost", DevServerPort);
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        switch (msg)
        {
            case Win32Window.WM_SIZE:
                if (_controller != null)
                {
                    Win32Window.GetClientRect(hwnd, out var rect);
                    _controller.Bounds = new Rectangle(0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top);
                }
                return IntPtr.Zero;

            case Win32Window.WM_DESTROY:
                Win32Window.PostQuitMessage(0);
                return IntPtr.Zero;

            case 0x0400: // WM_USER
                _bridge?.ProcessUiMessage();
                return IntPtr.Zero;

            default:
                return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
        }
    }
}
