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

            _appConfigService = new AppConfigService();
            _closeAction = _appConfigService.GetClosePreference();
            var savedWindow = _appConfigService.GetWindowState();

            int wx = Win32Window.CW_USEDEFAULT, wy = Win32Window.CW_USEDEFAULT;
            int ww = 1280, wh = 720;
            bool restoreMaximized = false;

            if (savedWindow != null)
            {
                var center = new Win32Window.POINT
                {
                    X = savedWindow.X + savedWindow.Width / 2,
                    Y = savedWindow.Y + savedWindow.Height / 2
                };
                var monitor = Win32Window.MonitorFromPoint(center, Win32Window.MONITOR_DEFAULTTONULL);
                if (monitor != IntPtr.Zero)
                {
                    wx = savedWindow.X;
                    wy = savedWindow.Y;
                    ww = savedWindow.Width;
                    wh = savedWindow.Height;
                    restoreMaximized = savedWindow.IsMaximized;
                }
            }

            _hwnd = Win32Window.Create("BrmbleWindow", "Brmble", wx, wy, ww, wh, WndProc);
            if (restoreMaximized)
                Win32Window.ShowWindow(_hwnd, Win32Window.SW_MAXIMIZE);
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

            // Accept self-signed server certificates so the matrix-js-sdk can
            // reach the Brmble API server (which uses a self-signed TLS cert).
            _controller.CoreWebView2.ServerCertificateErrorDetected += (_, args) =>
            {
                args.Action = CoreWebView2ServerCertificateErrorAction.AlwaysAllow;
            };

            // Suppress the client certificate prompt for Matrix SDK requests.
            // The Brmble server uses AllowCertificate mode, but only /auth/token
            // needs a cert (handled by BouncyCastle). All other requests work without one.
            _controller.CoreWebView2.ClientCertificateRequested += (_, args) =>
            {
                args.Handled = true; // Don't show prompt, don't send a cert
            };

            var webRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "web");
            _controller.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "brmble.local", webRoot, CoreWebView2HostResourceAccessKind.Allow);

            _bridge = new NativeBridge(_controller.CoreWebView2, hwnd);

            _appConfigService!.Initialize(_bridge);
            _appConfigService!.OnSettingsChanged = settings => _mumbleClient?.ApplySettings(settings);
            _appConfigService!.RegisterHandlers(_bridge);

            _certService = new CertificateService(_bridge);
            _certService.RegisterHandlers(_bridge);

            _mumbleClient = new MumbleAdapter(_bridge, _hwnd, _certService, _appConfigService);
            _mumbleClient.ApplySettings(_appConfigService!.GetSettings());
            _mumbleClient.OnApiUrlDiscovered = discoveredUrl =>
            {
                var servers = _appConfigService!.GetServers().ToList();
                if (!servers.Any()) return;

                var serverId = _mumbleClient.ActiveServerId;
                var entry = serverId is not null
                    ? servers.FirstOrDefault(s => s.Id == serverId)
                    : servers.Count == 1
                        ? servers[0]
                        : servers.FirstOrDefault(s => string.IsNullOrEmpty(s.ApiUrl));

                if (entry is null) return;
                _appConfigService.UpdateServer(entry with { ApiUrl = discoveredUrl });
            };

            SetupBridgeHandlers();

            // Auto-connect after frontend loads (one-shot: unsubscribe after first success)
            EventHandler<Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs> onNavCompleted = null!;
            onNavCompleted = (s, e) =>
            {
                if (e.IsSuccess)
                {
                    _controller.CoreWebView2.NavigationCompleted -= onNavCompleted;
                    TryAutoConnect();
                }
            };
            _controller.CoreWebView2.NavigationCompleted += onNavCompleted;

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
            {
                _closeAction = a.GetString();
                _appConfigService!.SaveClosePreference(_closeAction);
            }
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
 
    private static void TryAutoConnect()
    {
        var settings = _appConfigService!.GetSettings();
        if (!settings.AutoConnectEnabled) return;

        // Resolve target server
        var targetId = settings.AutoConnectServerId ?? _appConfigService.GetLastConnectedServerId();
        if (targetId is null) return;

        var servers = _appConfigService.GetServers();
        var server = servers.FirstOrDefault(s => s.Id == targetId);
        if (server is null) return;

        // Trigger connection via bridge — same path as manual connect
        _bridge!.Send("voice.autoConnect", new
        {
            id = server.Id,
            label = server.Label,
            apiUrl = server.ApiUrl,
            host = server.Host,
            port = server.Port,
            username = server.Username,
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
                if (_appConfigService != null)
                {
                    var placement = new Win32Window.WINDOWPLACEMENT
                    {
                        length = (uint)Marshal.SizeOf<Win32Window.WINDOWPLACEMENT>()
                    };
                    Win32Window.GetWindowPlacement(hwnd, ref placement);
                    _appConfigService.SaveWindowState(new WindowState(
                        X: placement.rcNormalPosition.Left,
                        Y: placement.rcNormalPosition.Top,
                        Width: placement.rcNormalPosition.Right - placement.rcNormalPosition.Left,
                        Height: placement.rcNormalPosition.Bottom - placement.rcNormalPosition.Top,
                        IsMaximized: placement.showCmd == Win32Window.SW_SHOWMAXIMIZED
                    ));
                }
                _mumbleClient?.Disconnect();
                TrayIcon.Destroy();
                Win32Window.PostQuitMessage(0);
                return IntPtr.Zero;

            case Win32Window.WM_HOTKEY:
                _mumbleClient?.HandleHotKey((int)wParam.ToInt64(), true);
                return IntPtr.Zero;

            case Win32Window.WM_INPUT:
                _mumbleClient?.HandleRawInput(wParam, lParam);
                return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);

            case 0x0400: // WM_USER
                _bridge?.ProcessUiMessage();
                return IntPtr.Zero;
        }

        return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
    }
}
