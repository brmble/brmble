using System;
using System.Collections.Generic;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterSuspendTests
{
    private const int VK_SPACE = 0x20;
    private const int VK_F1 = 0x70;
    private const int WM_LBUTTONDOWN = 0x0201;

    [TestMethod]
    public void WhileSuspended_NoEventsFire()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var ptt = new List<bool>();
        var pressed = new List<string>();
        router.PttStateChanged += s => ptt.Add(s);
        router.ShortcutPressed += a => pressed.Add(a);

        router.SetPttBinding("Space");
        router.SetShortcutBinding("toggleMute", "F1");

        router.Suspend();

        backend.KeyDownStates[VK_SPACE] = true;
        backend.KeyDownStates[VK_F1] = true;
        router.TickPollOnce();
        router.TickShortcutPollOnce();

        var hookProc = backend.MouseHookProc;
        if (hookProc != null) hookProc(0, new IntPtr(WM_LBUTTONDOWN), IntPtr.Zero);

        Assert.AreEqual(0, ptt.Count);
        Assert.AreEqual(0, pressed.Count);
    }

    [TestMethod]
    public void Resume_AfterSuspendedDown_DoesNotLeakHeldState()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var ptt = new List<bool>();
        router.PttStateChanged += s => ptt.Add(s);

        router.SetPttBinding("Space");

        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        Assert.AreEqual(1, ptt.Count);

        router.Suspend();
        router.Resume();

        Assert.AreEqual(2, ptt.Count);
        Assert.AreEqual(false, ptt[^1]);
    }

    [TestMethod]
    public void HandleJsPttKey_WhileSuspended_IsNoOp()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var ptt = new List<bool>();
        router.PttStateChanged += s => ptt.Add(s);

        router.SetPttBinding("Space");
        router.Suspend();

        router.HandleJsPttKey(true);

        Assert.AreEqual(0, ptt.Count);
    }
}
