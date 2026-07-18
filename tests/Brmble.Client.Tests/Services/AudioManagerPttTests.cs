using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;
using System.Reflection;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// PTT press/release edge cases. A quick re-press after release (within what
/// used to be the debounce window) must never be dropped: the release has
/// already scheduled the silence tail, so a dropped re-press leaves the user
/// holding a dead key while the tail stops the mic under them.
/// </summary>
[TestClass]
public class AudioManagerPttTests
{
    private static bool GetPttActive(AudioManager audio)
        => (bool)typeof(AudioManager)
            .GetField("_pttActive", BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(audio)!;

    [TestMethod]
    public void QuickRePressAfterRelease_IsNotDropped()
    {
        using var audio = new AudioManager();
        audio.SetTransmissionMode(TransmissionMode.PushToTalk, key: "F1", hwnd: IntPtr.Zero);

        audio.SetPttActiveExternal(true);
        audio.SetPttActiveExternal(false);
        // Immediate re-press, well within the old 100ms debounce window.
        audio.SetPttActiveExternal(true);

        Assert.IsTrue(GetPttActive(audio),
            "re-press after release must set _pttActive; the silence tail from the release would otherwise stop the mic while the key is held");
    }
}
