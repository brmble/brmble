using System.Diagnostics;
using System.Drawing;
using System.Net.Sockets;
using Microsoft.Web.WebView2.Core;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Serverlist;
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
    private static ServerlistService? _serverlistService;
    private static MumbleAdapter? _mumbleClient;
    private static IntPtr _hwnd;
    private static bool _muted;
    private static bool _deafened;

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

            _hwnd = Win32Window.Create("BrmbleWindow", "Brmble", 1280, 720, WndProc);
            Win32Window.ExtendFrameIntoClientArea(_hwnd);
            Win32Window.ForceFrameChange(_hwnd);
            TrayIcon.Create(_hwnd);
            _ = InitWebView2Async(_hwnd, useDevServer);
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

            // Enable CSS app-region: drag/no-drag for window dragging
            _controller.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = true;

            var webRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
            Debug.WriteLine($"[Brmble] Web root: {webRoot}");
            _controller.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "brmble.local", webRoot, CoreWebView2HostResourceAccessKind.Allow);

            _bridge = new NativeBridge(_controller.CoreWebView2, hwnd);

            _serverlistService = new ServerlistService();
            _serverlistService.Initialize(_bridge);
            _serverlistService.RegisterHandlers(_bridge);

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

        _bridge!.RegisterHandler("window.minimize", _ =>
        {
            Win32Window.ShowWindow(_hwnd, Win32Window.SW_MINIMIZE);
            return Task.CompletedTask;
        });

        _bridge.RegisterHandler("window.maximize", _ =>
        {
            if (Win32Window.IsZoomed(_hwnd))
                Win32Window.ShowWindow(_hwnd, Win32Window.SW_RESTORE);
            else
                Win32Window.ShowWindow(_hwnd, Win32Window.SW_MAXIMIZE);
            return Task.CompletedTask;
        });

        _bridge.RegisterHandler("window.close", _ =>
        {
            Win32Window.PostMessage(_hwnd, Win32Window.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            return Task.CompletedTask;
        });

        _bridge.RegisterHandler("voice.selfMuteChanged", data =>
        {
            if (data.TryGetProperty("muted", out var m))
            {
                _muted = m.GetBoolean();
                TrayIcon.UpdateState(_muted, _deafened);
            }
            return Task.CompletedTask;
        });

        _bridge.RegisterHandler("voice.selfDeafChanged", data =>
        {
            if (data.TryGetProperty("deafened", out var d))
            {
                _deafened = d.GetBoolean();
                TrayIcon.UpdateState(_muted, _deafened);
            }
            return Task.CompletedTask;
        });
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
        // Remove the non-client area (title bar) — client area fills entire window
        if (msg == Win32Window.WM_NCCALCSIZE && wParam != IntPtr.Zero)
            return IntPtr.Zero;

        switch (msg)
        {
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

            case Win32Window.WM_CLOSE:
                Win32Window.ShowWindow(hwnd, Win32Window.SW_HIDE);
                return IntPtr.Zero;

            case TrayIcon.WM_TRAYICON:
                var trayMsg = (uint)(lParam.ToInt64() & 0xFFFF);
                if (trayMsg == Win32Window.WM_RBUTTONUP)
                    TrayIcon.ShowContextMenu(hwnd);
                else if (trayMsg == Win32Window.WM_LBUTTONDBLCLK)
                {
                    Win32Window.ShowWindow(hwnd, Win32Window.SW_RESTORE);
                    Win32Window.SetForegroundWindow(hwnd);
                }
                return IntPtr.Zero;

            case Win32Window.WM_COMMAND:
                var menuId = (int)(wParam.ToInt64() & 0xFFFF);
                switch (menuId)
                {
                    case TrayIcon.IDM_SHOW:
                        Win32Window.ShowWindow(hwnd, Win32Window.SW_RESTORE);
                        Win32Window.SetForegroundWindow(hwnd);
                        break;
                    case TrayIcon.IDM_MUTE:
                        _mumbleClient?.ToggleMute();
                        _muted = !_muted;
                        if (!_muted) _deafened = false; // unmute also undeafens
                        TrayIcon.UpdateState(_muted, _deafened);
                        break;
                    case TrayIcon.IDM_DEAFEN:
                        _mumbleClient?.ToggleDeaf();
                        _deafened = !_deafened;
                        _muted = _deafened; // deafen implies mute
                        TrayIcon.UpdateState(_muted, _deafened);
                        break;
                    case TrayIcon.IDM_QUIT:
                        Win32Window.DestroyWindow(hwnd);
                        break;
                }
                return IntPtr.Zero;

            case Win32Window.WM_DESTROY:
                TrayIcon.Destroy();
                Win32Window.PostQuitMessage(0);
                return IntPtr.Zero;

            case 0x0400: // WM_USER
                _bridge?.ProcessUiMessage();
                return IntPtr.Zero;
        }

        return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
    }
}
