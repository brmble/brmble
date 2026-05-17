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
    public void Suspend_WithPttHeld_ReleasesImmediately()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var ptt = new List<bool>();
        router.PttStateChanged += s => ptt.Add(s);

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);
        Assert.AreEqual(true, ptt[^1]);

        router.Suspend();

        Assert.AreEqual(false, ptt[^1]);
    }

    [TestMethod]
    public void Resume_WhenShortcutKeyStillHeld_SuppressesNextRelease()
    {
        // Repro PR #542 review: PttKeyCapture cancels recording on keydown
        // and resumes BEFORE the user releases the key. Without this fix
        // the matching release fires ShortcutReleased(action, forced:false)
        // and MumbleAdapter dispatches the bound action immediately after
        // recording ends — e.g. recording a new mute hotkey would toggle
        // mute on release.
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var pressed = new List<string>();
        var released = new List<(string action, bool forced)>();
        router.ShortcutPressed += a => pressed.Add(a);
        router.ShortcutReleased += (a, f) => released.Add((a, f));

        router.SetShortcutBinding("toggleMute", "F1");
        router.Suspend();

        // User holds F1 during capture, resume fires while still held.
        backend.KeyDownStates[VK_F1] = true;
        router.Resume();

        // Release after resume — must NOT fire ShortcutReleased.
        backend.KeyDownStates[VK_F1] = false;
        router.TickShortcutPollOnce();
        Assert.AreEqual(0, released.Count, "first release after resume must be suppressed");

        // Subsequent fresh press → release cycle works normally.
        backend.KeyDownStates[VK_F1] = true;
        router.TickShortcutPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute" }, pressed);

        backend.KeyDownStates[VK_F1] = false;
        router.TickShortcutPollOnce();
        Assert.AreEqual(1, released.Count);
        Assert.AreEqual(("toggleMute", false), released[0]);
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
