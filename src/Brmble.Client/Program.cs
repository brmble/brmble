using System.Diagnostics;
using System.Drawing;
using System.Net.Sockets;
using Microsoft.Web.WebView2.Core;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Voice;

namespace Brmble.Client;

/// <summary>
/// Main entry point for the Brmble desktop client.
/// </summary>
/// <remarks>
/// This application uses WebView2 to display a React frontend and communicates
/// with backend services via the NativeBridge.
/// </remarks>
static class Program
{
    /// <summary>
    /// The URL of the Vite development server.
    /// </summary>
    private const string DevServerUrl = "http://localhost:5173";
    
    /// <summary>
    /// The port number for the Vite development server.
    /// </summary>
    private const int DevServerPort = 5173;

    private static CoreWebView2Controller? _controller;
    private static NativeBridge? _bridge;
    private static MumbleAdapter? _mumbleClient;

    /// <summary>
    /// The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main()
    {
        try
        {
            var useDevServer = IsDevServerRunning();
            Debug.WriteLine(useDevServer
                ? "Brmble: Using Vite dev server"
                : "Brmble: Using local files");

            var hwnd = Win32Window.Create("BrmbleWindow", "Brmble", 1280, 720, WndProc);
            Win32Window.ExtendFrameIntoClientArea(hwnd);
            _ = InitWebView2Async(hwnd, useDevServer);
            Win32Window.RunMessageLoop();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[FATAL] {ex}");
        }
    }

    /// <summary>
    /// Initializes the WebView2 environment and loads the frontend.
    /// </summary>
    /// <param name="hwnd">The window handle.</param>
    /// <param name="useDevServer">Whether to use the development server.</param>
    private static async Task InitWebView2Async(IntPtr hwnd, bool useDevServer)
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync();
            _controller = await env.CreateCoreWebView2ControllerAsync(hwnd);

            Win32Window.GetClientRect(hwnd, out var rect);
            _controller.Bounds = new Rectangle(0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top);
            _controller.IsVisible = true;

            var webRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
            Debug.WriteLine($"[Brmble] Web root: {webRoot}");
            _controller.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "brmble.local", webRoot, CoreWebView2HostResourceAccessKind.Allow);

            _bridge = new NativeBridge(_controller.CoreWebView2, hwnd);
            
            _mumbleClient = new MumbleAdapter(_bridge);
            
            SetupBridgeHandlers();

            if (useDevServer)
                _controller.CoreWebView2.Navigate(DevServerUrl);
            else
                _controller.CoreWebView2.Navigate("https://brmble.local/index.html");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ERROR] InitWebView2Async: {ex}");
        }
    }

    /// <summary>
    /// Sets up message handlers for backend services.
    /// </summary>
    private static void SetupBridgeHandlers()
    {
        _mumbleClient!.RegisterHandlers(_bridge);
    }
 
    /// <summary>
    /// Checks if the Vite development server is running.
    /// </summary>
    /// <returns>True if the development server is available.</returns>
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

    /// <summary>
    /// Window procedure for handling Windows messages.
    /// </summary>
    /// <param name="hwnd">The window handle.</param>
    /// <param name="msg">The message identifier.</param>
    /// <param name="wParam">Additional message-specific information.</param>
    /// <param name="lParam">Additional message-specific information.</param>
    /// <returns>The result of the message processing.</returns>
    private static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        // Let DWM handle caption button hit-testing first
        if (Win32Window.DwmDefWindowProc(hwnd, msg, wParam, lParam, out var dwmResult) != 0)
            return dwmResult;

        switch (msg)
        {
            case Win32Window.WM_NCCALCSIZE:
                // When wParam is 1, returning 0 removes the non-client area (title bar)
                if (wParam != IntPtr.Zero)
                    return IntPtr.Zero;
                break;

            case Win32Window.WM_ACTIVATE:
                Win32Window.ExtendFrameIntoClientArea(hwnd);
                return IntPtr.Zero;

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
        }

        return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
    }
}
