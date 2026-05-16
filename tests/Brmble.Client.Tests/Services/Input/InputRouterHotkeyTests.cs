using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterHotkeyTests
{
    [TestMethod]
    public void SettingShortcut_DoesNotCallRegisterHotKey()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        router.SetShortcutBinding("toggleMute", "F1");
        router.SetShortcutBinding("toggleDeafen", "F2");
        router.SetPttBinding("Space");

        Assert.AreEqual(0, backend.RegisteredHotkeys.Count,
            "InputRouter must use polling, not RegisterHotKey — guards against re-introducing #99/#470 class of bugs");
    }
}
