using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Brmble.Client.Bridge;
using Brmble.Client.Services.Certificate;
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.Voice;

namespace Brmble.Client;

static class Program
{
    private const string DevServerUrl = "http://localhost:5173";
    private const int DevServerPort = 5173;

    private static CoreWebView2Controller? _controller;
    private static NativeBridge? _bridge;
    private static AppConfigService? _appConfigService;
    private static CertificateService? _certService;
    private static MumbleAdapter? _mumbleClient;
    private static IntPtr _hwnd;
    private static bool _muted;
    private static bool _deafened;
    private static volatile string? _closeAction; // null = ask, "minimize", "quit"

    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Brmble", "audio.log");

    private static void Log(string msg)
    {
        try
        {
            var dir = Path.GetDirectoryName(LogPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            // Uncomment for debugging:
            // File.AppendAllText(LogPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}\n");
        }
        catch { }
    }

    [STAThread]
    static void Main()
    {
        try
        {
            DevLog.Init();

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
            _controller.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "brmble.local", webRoot, CoreWebView2HostResourceAccessKind.Allow);

            _bridge = new NativeBridge(_controller.CoreWebView2, hwnd);

            _appConfigService = new AppConfigService();
            _appConfigService.Initialize(_bridge);
            _appConfigService.OnSettingsChanged = settings => _mumbleClient?.ApplySettings(settings);
            _appConfigService.RegisterHandlers(_bridge);

            _certService = new CertificateService(_bridge);
            _certService.RegisterHandlers(_bridge);

            _mumbleClient = new MumbleAdapter(_bridge, _hwnd, _certService);
            _mumbleClient.ApplySettings(_appConfigService.GetSettings());

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

    private static void SetupBridgeHandlers()
    {
        _mumbleClient!.RegisterHandlers(_bridge!);

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

        _bridge.RegisterHandler("window.quit", _ =>
        {
            _closeAction = "quit";
            Win32Window.PostMessage(_hwnd, Win32Window.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            return Task.CompletedTask;
        });

        _bridge.RegisterHandler("window.setClosePreference", data =>
        {
            if (data.TryGetProperty("action", out var a))
                _closeAction = a.GetString();
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

        _bridge.RegisterHandler("notification.badge", data =>
        {
            var hasUnreadDMs = data.TryGetProperty("unreadDMs", out var u) && u.GetBoolean();
            var hasPendingInvite = data.TryGetProperty("pendingInvite", out var p) && p.GetBoolean();
            TrayIcon.UpdateBadge(hasUnreadDMs, hasPendingInvite);
            return Task.CompletedTask;
        });
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
        // Remove title bar but keep the resize frame on left/right/bottom as non-client area.
        // DWM renders those frames transparently via DwmExtendFrameIntoClientArea({-1,-1,-1,-1}).
        // Top is set to window top (no NC area there — top resize handled via JS bridge).
        if (msg == Win32Window.WM_NCCALCSIZE && wParam != IntPtr.Zero)
        {
            int windowTop = Marshal.ReadInt32(lParam, 4);
            Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
            Marshal.WriteInt32(lParam, 4, windowTop);
            return IntPtr.Zero;
        }

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
                if (_closeAction == "quit")
                {
                    Win32Window.DestroyWindow(hwnd);
                }
                else if (_closeAction == "minimize")
                {
                    Win32Window.ShowWindow(hwnd, Win32Window.SW_HIDE);
                }
                else if (_bridge != null)
                {
                    // Ask via WebView2 modal — fire-and-forget
                    _bridge.Send("window.showCloseDialog");
                    _bridge.Flush();
                }
                else
                {
                    // Bridge not ready yet — just quit
                    Win32Window.DestroyWindow(hwnd);
                }
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
                    case TrayIcon.IDM_CONSOLE:
                        Win32Window.AllocConsole();
                        Console.WriteLine("[Console] Debug console opened");
                        break;
                    case TrayIcon.IDM_QUIT:
                        Win32Window.DestroyWindow(hwnd);
                        break;
                }
                return IntPtr.Zero;

            case Win32Window.WM_NCHITTEST:
            {
                if (Win32Window.DwmDefWindowProc(hwnd, msg, wParam, lParam, out var dwmResult) != 0)
                    return dwmResult;
                return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
            }

            case Win32Window.WM_GETMINMAXINFO:
            {
                var info = Marshal.PtrToStructure<Win32Window.MINMAXINFO>(lParam);
                info.ptMinTrackSize = new Win32Window.POINT { X = 600, Y = 400 };
                Marshal.StructureToPtr(info, lParam, false);
                return IntPtr.Zero;
            }

            case Win32Window.WM_DESTROY:
                _mumbleClient?.Disconnect();
                TrayIcon.Destroy();
                Win32Window.PostQuitMessage(0);
                return IntPtr.Zero;

            case Win32Window.WM_HOTKEY:
                _mumbleClient?.HandleHotKey((int)wParam.ToInt64(), true);
                return IntPtr.Zero;

            case 0x0400: // WM_USER
                _bridge?.ProcessUiMessage();
                return IntPtr.Zero;
        }

        return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
    }
}
