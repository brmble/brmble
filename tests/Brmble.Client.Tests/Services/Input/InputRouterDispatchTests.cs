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
    public void StaleHoldThenRelease_AfterReinstall_DoesNotFireSpuriousPress()
    {
        // Repro: user held mouse PTT through a Disconnect → Connect cycle.
        // The new hook is installed AFTER the press, so WM_XBUTTONDOWN is
        // never observed by the new binding. The user eventually releases
        // (WM_XBUTTONUP arrives) — that must NOT fire any event, and the
        // next fresh press cycle must work normally.
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("XButton2");

        // User releases the leftover hold (hook never saw the DOWN).
        InvokeMouseHook(backend, WM_XBUTTONUP, xButton: 2);
        Assert.AreEqual(0, states.Count, "release of unseen hold must not fire");

        // Fresh press cycle works.
        InvokeMouseHook(backend, WM_XBUTTONDOWN, xButton: 2);
        CollectionAssert.AreEqual(new[] { true }, states);

        InvokeMouseHook(backend, WM_XBUTTONUP, xButton: 2);
        CollectionAssert.AreEqual(new[] { true, false }, states);
    }

    [TestMethod]
    public void ClearBinding_WhileHeld_FiresReleaseEvent()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var releases = new List<string>();
        router.ShortcutReleased += a => releases.Add(a);

        router.SetShortcutBinding("toggleMute", "MouseLeft");
        InvokeMouseHook(backend, WM_LBUTTONDOWN);
        Assert.AreEqual(0, releases.Count);

        router.SetShortcutBinding("toggleMute", null);

        CollectionAssert.AreEqual(new[] { "toggleMute" }, releases);
    }

    [TestMethod]
    public void ClearLastBinding_LeavesHookInstalled_NoCrash()
    {
        // Hook is intentionally app-lifetime to avoid the unhook/rehook race
        // that GC-collects the delegate while Windows still has in-flight
        // callbacks queued. The dispatch table becomes empty and the hook
        // becomes a no-op chain.
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        router.SetShortcutBinding("toggleMute", "MouseLeft");
        Assert.IsTrue(backend.MouseHookRegistered);

        router.SetShortcutBinding("toggleMute", null);

        Assert.IsTrue(backend.MouseHookRegistered);
    }

    [TestMethod]
    public void ClearPtt_WhileHeld_FiresPttReleased()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("XButton2");
        InvokeMouseHook(backend, 0x020B /* WM_XBUTTONDOWN */, xButton: 2);
        Assert.AreEqual(true, states[^1]);

        router.SetPttBinding(null);

        Assert.AreEqual(false, states[^1]);
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
