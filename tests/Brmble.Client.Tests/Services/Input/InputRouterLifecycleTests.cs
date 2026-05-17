using System.Collections.Generic;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterLifecycleTests
{
    private const int VK_SPACE = 0x20;

    [TestMethod]
    public void TickPollOnce_AfterRebind_DoesNotFireSpuriousReleaseForOldKey()
    {
        // PR #542 review: timer callbacks queued before StopPttPolling can
        // still run; if _pttVk is still set to the old key when they do,
        // they observe a stale edge transition and fire PttStateChanged.
        // The fix clears _pttVk under the lock before stopping the timer.
        const int VK_F1 = 0x70;
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("F1");
        backend.KeyDownStates[VK_F1] = true;
        router.TickPollOnce();
        Assert.AreEqual(1, states.Count); // initial press

        // Now rebind to null while key is still physically down. Simulates a
        // queued tick running after the rebind: TickPollOnce reads _pttVk
        // under the lock, sees 0, bails out — no spurious event.
        router.SetPttBinding(null);
        // After SetPttBinding(null), expect a forced release event AND no
        // further events from any late-running poll tick.
        int countAfterRebind = states.Count;
        router.TickPollOnce();
        Assert.AreEqual(countAfterRebind, states.Count, "late TickPollOnce must observe cleared _pttVk and bail");
    }

    [TestMethod]
    public void ReleaseAllHeld_WithKeyboardPttStillHeld_DoesNotRetriggerOnNextPoll()
    {
        // PR #542 review: ReleaseAllHeld previously hard-set
        // _pttKeyWasDown=false. If the user was still physically holding
        // the PTT key when ReleaseAllHeld fired (e.g. mid-channel-change),
        // the next poll tick saw isDown=true && !_pttKeyWasDown and fired
        // a fresh press — re-activating PTT without a release→press cycle.
        // Fix samples GetAsyncKeyState and primes _pttKeyWasDown to true,
        // so the still-held key reads as "no edge" and stays a no-op.
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        Assert.AreEqual(true, states[^1]);

        // Lifecycle transition while user still holds Space.
        router.ReleaseAllHeld();
        Assert.AreEqual(false, states[^1]); // forced release fired

        // Next poll tick — must NOT re-trigger.
        int countAfterRelease = states.Count;
        router.TickPollOnce();
        Assert.AreEqual(countAfterRelease, states.Count, "still-held key must not re-trigger PTT after ReleaseAllHeld");

        // Release physically — also a no-op (state is already released).
        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        Assert.AreEqual(countAfterRelease, states.Count);

        // Fresh press cycle works.
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        Assert.AreEqual(true, states[^1]);
    }

    [TestMethod]
    public void ReleaseAllHeld_FiresShortcutReleasedWithForcedFlag()
    {
        // Lifecycle releases must be flagged forced=true so subscribers
        // (MumbleAdapter) skip the user-facing toggle action — otherwise
        // disconnecting while holding a shortcut would mute/leave-voice/etc.
        // as an unintended side effect (PR #542 review feedback).
        const int VK_F1 = 0x70;
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var observed = new List<(string action, bool forced)>();
        router.ShortcutReleased += (a, f) => observed.Add((a, f));

        router.SetShortcutBinding("toggleMute", "F1");
        backend.KeyDownStates[VK_F1] = true;
        router.TickShortcutPollOnce();

        router.ReleaseAllHeld();

        Assert.AreEqual(1, observed.Count);
        Assert.AreEqual(("toggleMute", true), observed[0]);
    }

    [TestMethod]
    public void PhysicalRelease_FiresShortcutReleasedWithForcedFalse()
    {
        const int VK_F1 = 0x70;
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var observed = new List<(string action, bool forced)>();
        router.ShortcutReleased += (a, f) => observed.Add((a, f));

        router.SetShortcutBinding("toggleMute", "F1");
        backend.KeyDownStates[VK_F1] = true;
        router.TickShortcutPollOnce();
        backend.KeyDownStates[VK_F1] = false;
        router.TickShortcutPollOnce();

        Assert.AreEqual(1, observed.Count);
        Assert.AreEqual(("toggleMute", false), observed[0]);
    }

    [TestMethod]
    public void ReleaseAllHeld_AfterKeyboardPttDown_FiresRelease()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        Assert.AreEqual(true, states[^1]);

        router.ReleaseAllHeld();

        Assert.AreEqual(false, states[^1]);
    }

    [TestMethod]
    public void ReleaseAllHeld_AfterJsPttDown_FiresRelease()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);
        Assert.AreEqual(true, states[^1]);

        router.ReleaseAllHeld();

        Assert.AreEqual(false, states[^1]);
    }

    [TestMethod]
    public void ReleaseAllHeld_TwiceInARow_IsIdempotent()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);
        int countAfterFirst = states.Count;

        router.ReleaseAllHeld();
        router.ReleaseAllHeld();

        Assert.AreEqual(countAfterFirst + 1, states.Count);
    }

    [TestMethod]
    public void ReleaseAllHeld_EmitsForcedJsResetSignal()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        int forcedCount = 0;
        router.JsForceReleaseRequested += () => forcedCount++;

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);

        router.ReleaseAllHeld();

        Assert.AreEqual(1, forcedCount);
    }

    [TestMethod]
    public void ReleaseAllHeld_AfterMousePttDown_FiresRelease()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("XButton2");
        InputRouterDispatchTests.InvokeMouseHook(backend, 0x020B /* WM_XBUTTONDOWN */, xButton: 2);
        Assert.AreEqual(true, states[^1]);

        router.ReleaseAllHeld();

        Assert.AreEqual(false, states[^1]);
    }
}
