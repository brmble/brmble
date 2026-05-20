using System.Collections.Generic;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterJsPollDedupeTests
{
    private const int VK_SPACE = 0x20;

    [TestMethod]
    public void JsPressed_PollReleased_StaysActive()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);
        CollectionAssert.AreEqual(new[] { true }, states);

        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        router.HandleJsPttKey(false);
        CollectionAssert.AreEqual(new[] { true, false }, states);
    }

    [TestMethod]
    public void PollPressed_JsNeverFires_PollControlsState()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true, false }, states);
    }

    [TestMethod]
    public void HandleJsPttKey_NoBinding_IsNoOp()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.HandleJsPttKey(true);

        Assert.AreEqual(0, states.Count);
    }
}
