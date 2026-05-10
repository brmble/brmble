using System.Diagnostics;
using System.Drawing;
using Microsoft.Web.WebView2.Core;

namespace Brmble.Client.Overlay;

internal sealed class CompanionOverlayHost : IDisposable
{
    private readonly CoreWebView2Environment _environment;
    private readonly CompanionOverlayRelay _relay;
    private readonly IntPtr _mainWindow;
    private readonly bool _useDevServer;
    private readonly string _webRoot;
    private CoreWebView2Controller? _controller;
    private IntPtr _overlayWindow;
    private bool _visible;

    public CompanionOverlayHost(
        CoreWebView2Environment environment,
        CompanionOverlayRelay relay,
        IntPtr mainWindow,
        bool useDevServer,
        string webRoot)
    {
        _environment = environment;
        _relay = relay;
        _mainWindow = mainWindow;
        _useDevServer = useDevServer;
        _webRoot = webRoot;
    }

    public bool IsVisible => _visible;

    public async Task InitializeAsync()
    {
        _overlayWindow = Win32Window.CreateOverlay(
            "BrmbleOverlayWindow",
            "Brmble Companion Overlay",
            _mainWindow,
            OverlayWndProc);

        _controller = await _environment.CreateCoreWebView2ControllerAsync(_overlayWindow);
        _controller.DefaultBackgroundColor = Color.Transparent;
        _controller.Bounds = GetOverlayBounds();
        _controller.IsVisible = false;
        _controller.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _controller.CoreWebView2.Settings.AreDevToolsEnabled = _useDevServer;
        _controller.CoreWebView2.Settings.IsStatusBarEnabled = false;

        if (!_useDevServer)
        {
            _controller.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "brmble.local",
                _webRoot,
                CoreWebView2HostResourceAccessKind.Allow);
        }

        _controller.CoreWebView2.NavigationStarting += (_, args) =>
        {
            if (string.IsNullOrEmpty(args.Uri))
            {
                return;
            }

            if (_useDevServer)
            {
                if (args.Uri.StartsWith("http://localhost:5173", StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
            else if (args.Uri.StartsWith("https://brmble.local", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            args.Cancel = true;
        };

        _relay.AttachSink(HandlePayload);

        if (_useDevServer)
        {
            _controller.CoreWebView2.Navigate("http://localhost:5173/overlay.html");
        }
        else
        {
            _controller.CoreWebView2.Navigate("https://brmble.local/overlay.html");
        }

        ApplyVisibility();
    }

    public void SetEnabled(bool enabled)
    {
        _visible = enabled;
        ApplyVisibility();
    }

    public void SyncToMainWindow()
    {
        if (_overlayWindow == IntPtr.Zero)
        {
            return;
        }

        var workArea = Win32Window.GetMonitorWorkArea(_mainWindow);
        Win32Window.SetWindowPos(
            _overlayWindow,
            new IntPtr(-1),
            workArea.Left,
            workArea.Top,
            workArea.Right - workArea.Left,
            workArea.Bottom - workArea.Top,
            0x0010);

        if (_controller is not null)
        {
            _controller.Bounds = GetOverlayBounds();
        }
    }

    private void HandlePayload(string payload)
    {
        try
        {
            _controller?.CoreWebView2.PostWebMessageAsJson(payload);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Overlay] Failed to post sync payload: {ex.Message}");
        }
    }

    private void ApplyVisibility()
    {
        if (_overlayWindow == IntPtr.Zero || _controller is null)
        {
            return;
        }

        if (_visible)
        {
            SyncToMainWindow();
            _controller.IsVisible = true;
            Win32Window.ShowWindow(_overlayWindow, Win32Window.SW_SHOW);
        }
        else
        {
            _controller.IsVisible = false;
            Win32Window.ShowWindow(_overlayWindow, Win32Window.SW_HIDE);
        }
    }

    private Rectangle GetOverlayBounds()
    {
        Win32Window.GetClientRect(_overlayWindow, out var rect);
        return new Rectangle(0, 0, Math.Max(0, rect.Right - rect.Left), Math.Max(0, rect.Bottom - rect.Top));
    }

    private static IntPtr OverlayWndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == Win32Window.WM_NCHITTEST)
        {
            return new IntPtr(-1);
        }

        return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
    }

    public void Dispose()
    {
        _relay.DetachSink();
        _controller?.Close();
        _controller = null;

        if (_overlayWindow != IntPtr.Zero)
        {
            Win32Window.DestroyWindow(_overlayWindow);
            _overlayWindow = IntPtr.Zero;
        }
    }
}
