using System.Collections.Generic;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterShortcutKeyboardTests
{
    private const int VK_F1 = 0x70;
    private const int VK_F2 = 0x71;

    [TestMethod]
    public void TwoKeyboardShortcuts_Independent()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var pressed = new List<string>();
        var released = new List<string>();
        router.ShortcutPressed += a => pressed.Add(a);
        router.ShortcutReleased += (a, _) => released.Add(a);

        router.SetShortcutBinding("toggleMute", "F1");
        router.SetShortcutBinding("toggleLeaveVoice", "F2");

        backend.KeyDownStates[VK_F1] = true;
        router.TickShortcutPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute" }, pressed);

        backend.KeyDownStates[VK_F2] = true;
        router.TickShortcutPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute", "toggleLeaveVoice" }, pressed);

        backend.KeyDownStates[VK_F1] = false;
        router.TickShortcutPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute" }, released);

        backend.KeyDownStates[VK_F2] = false;
        router.TickShortcutPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute", "toggleLeaveVoice" }, released);
    }

    [TestMethod]
    public void ClearShortcutBinding_RemovesPolling()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var pressed = new List<string>();
        router.ShortcutPressed += a => pressed.Add(a);

        router.SetShortcutBinding("toggleMute", "F1");
        router.SetShortcutBinding("toggleMute", null);

        backend.KeyDownStates[VK_F1] = true;
        router.TickShortcutPollOnce();

        Assert.AreEqual(0, pressed.Count);
    }

    [TestMethod]
    public void ClearShortcutBinding_WhileHeld_FiresRelease()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var released = new List<string>();
        router.ShortcutReleased += (a, _) => released.Add(a);

        router.SetShortcutBinding("toggleMute", "F1");
        backend.KeyDownStates[VK_F1] = true;
        router.TickShortcutPollOnce();

        router.SetShortcutBinding("toggleMute", null);

        CollectionAssert.AreEqual(new[] { "toggleMute" }, released);
    }

    [TestMethod]
    public void ReleaseAllHeld_ReleasesHeldKeyboardShortcuts()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var released = new List<string>();
        router.ShortcutReleased += (a, _) => released.Add(a);

        router.SetShortcutBinding("toggleMute", "F1");
        backend.KeyDownStates[VK_F1] = true;
        router.TickShortcutPollOnce();

        router.ReleaseAllHeld();

        CollectionAssert.AreEqual(new[] { "toggleMute" }, released);
    }
}
