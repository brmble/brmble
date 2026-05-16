using System.Collections.Generic;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterKeyboardPttTests
{
    private const int VK_SPACE = 0x20;

    [TestMethod]
    public void Polling_DownAndUp_FiresPttEvents()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");

        router.TickPollOnce();
        Assert.AreEqual(0, states.Count);

        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true, false }, states);
    }

    [TestMethod]
    public void SetPttBinding_WhenKeyAlreadyDown_SuppressesInitialPress()
    {
        // Repro: user held PTT through Disconnect → Connect, so the fresh
        // InputRouter starts polling with the key still physically held.
        // The first tick must NOT fire PttStateChanged(true) for that
        // stale hold — only a release-then-press cycle should activate PTT.
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        backend.KeyDownStates[VK_SPACE] = true;
        router.SetPttBinding("Space");

        router.TickPollOnce();
        Assert.AreEqual(0, states.Count, "must not fire press for key held before binding");

        // User releases physically — internal flag transitions but combined
        // state stays false (no event).
        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        Assert.AreEqual(0, states.Count);

        // Fresh press now fires normally.
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);
    }

    [TestMethod]
    public void SetPttBindingToKeyboardKey_DoesNotInstallMouseHook()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        router.SetPttBinding("Space");

        Assert.IsFalse(backend.MouseHookRegistered);
    }
}
