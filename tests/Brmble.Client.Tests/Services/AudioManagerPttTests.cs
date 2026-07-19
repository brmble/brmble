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
    private static FieldInfo RequireField(string name)
    {
        var field = typeof(AudioManager).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.IsNotNull(field, $"private field '{name}' not found on AudioManager — was it renamed?");
        return field;
    }

    private static bool GetPttActive(AudioManager audio)
        => (bool)RequireField("_pttActive").GetValue(audio)!;

    private static object? GetField(AudioManager audio, string name)
        => RequireField(name).GetValue(audio);

    [TestMethod]
    public void ModeSwitch_CancelsPendingSilenceTail()
    {
        // PTT release schedules a silence tail; switching transmission mode
        // before it fires must invalidate it, or the tail stops the mic the
        // new mode (e.g. Continuous) just started.
        using var audio = new AudioManager();
        audio.SetTransmissionMode(TransmissionMode.PushToTalk, key: "F1", hwnd: IntPtr.Zero);
        audio.SetPttActiveExternal(true);
        audio.SetPttActiveExternal(false); // schedules the tail

        int generationBefore = (int)GetField(audio, "_pttSilenceTailGeneration")!;
        audio.SetTransmissionMode(TransmissionMode.Continuous, key: null, hwnd: IntPtr.Zero);

        Assert.IsNull(GetField(audio, "_pttSilenceTailTimer"),
            "pending silence-tail timer must be disposed on mode switch");
        Assert.IsTrue((int)GetField(audio, "_pttSilenceTailGeneration")! > generationBefore,
            "generation must advance so an already-fired tail callback becomes a no-op");
    }

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
