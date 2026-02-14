using System.Drawing;
using Microsoft.Web.WebView2.Core;

namespace Brmble.Client;

static class Program
{
    private static CoreWebView2Controller? _controller;

    [STAThread]
    static void Main()
    {
        var hwnd = Win32Window.Create("BrmbleWindow", "Brmble", 1280, 720, WndProc);
        _ = InitWebView2Async(hwnd);
        Win32Window.RunMessageLoop();
    }

    private static async Task InitWebView2Async(IntPtr hwnd)
    {
        var env = await CoreWebView2Environment.CreateAsync();
        _controller = await env.CreateCoreWebView2ControllerAsync(hwnd);

        Win32Window.GetClientRect(hwnd, out var rect);
        _controller.Bounds = new Rectangle(0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top);
        _controller.IsVisible = true;

        _controller.CoreWebView2.NavigateToString(
            "<html><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0'><h1>Brmble</h1></body></html>");
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

            default:
                return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
        }
    }
}
