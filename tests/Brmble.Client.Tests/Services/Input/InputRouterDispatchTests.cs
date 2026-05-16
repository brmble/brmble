using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterDispatchTests
{
    private const int HC_ACTION = 0;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const int WM_XBUTTONUP = 0x020C;

    internal static IntPtr InvokeMouseHook(
        FakeInputBackend backend, int msg, int xButton = 0)
    {
        if (xButton == 0)
        {
            // Non-X-button messages don't read lParam.
            return backend.MouseHookProc!.Invoke(HC_ACTION, new IntPtr(msg), IntPtr.Zero);
        }

        var hookStruct = new MSLLHOOKSTRUCT { mouseData = xButton << 16 };
        var lParam = Marshal.AllocHGlobal(Marshal.SizeOf<MSLLHOOKSTRUCT>());
        try
        {
            Marshal.StructureToPtr(hookStruct, lParam, false);
            return backend.MouseHookProc!.Invoke(HC_ACTION, new IntPtr(msg), lParam);
        }
        finally
        {
            Marshal.FreeHGlobal(lParam);
        }
    }

    [TestMethod]
    public void PttOnX2AndMuteOnLeft_CoexistWithoutInterference()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        bool? pttState = null;
        string? lastPressed = null;
        router.PttStateChanged += s => pttState = s;
        router.ShortcutPressed += a => lastPressed = a;

        router.SetPttBinding("XButton2");
        router.SetShortcutBinding("toggleMute", "MouseLeft");

        InvokeMouseHook(backend, WM_XBUTTONDOWN, xButton: 2);
        Assert.AreEqual(true, pttState);
        Assert.IsNull(lastPressed);

        InvokeMouseHook(backend, WM_LBUTTONDOWN);
        Assert.AreEqual("toggleMute", lastPressed);
        Assert.AreEqual(true, pttState, "PTT state must not be disturbed by other binding");

        InvokeMouseHook(backend, WM_XBUTTONUP, xButton: 2);
        Assert.AreEqual(false, pttState);
    }
}
