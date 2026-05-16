using System.Collections.Generic;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterLifecycleTests
{
    private const int VK_SPACE = 0x20;

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
