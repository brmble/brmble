using Brmble.Audio;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests;

[TestClass]
public class WebRtcVadSmokeTests
{
    [TestMethod]
    public void Constructor_loads_native_library_and_initialises()
    {
        using var vad = new WebRtcVad(VadAggressiveness.Aggressive);
        Assert.AreEqual(VadAggressiveness.Aggressive, vad.Mode);
    }

    [TestMethod]
    public void IsSpeech_returns_false_on_silence()
    {
        using var vad = new WebRtcVad(VadAggressiveness.Aggressive);
        var silence = new short[480];
        Assert.IsFalse(vad.IsSpeech(silence));
    }

    [TestMethod]
    public void Mode_can_be_changed_after_construction()
    {
        using var vad = new WebRtcVad(VadAggressiveness.Quality);
        vad.Mode = VadAggressiveness.VeryAggressive;
        Assert.AreEqual(VadAggressiveness.VeryAggressive, vad.Mode);
    }

    [TestMethod]
    public void IsSpeech_returns_true_on_synthetic_speech_band_signal()
    {
        // A 1 kHz sine at moderate level lands inside the speech band and is
        // typically classified as speech by libfvad in Aggressive mode.
        using var vad = new WebRtcVad(VadAggressiveness.Aggressive);
        var frame = new short[480];
        for (int i = 0; i < frame.Length; i++)
            frame[i] = (short)(8000 * Math.Sin(2 * Math.PI * 1000 * i / 48000.0));

        Assert.IsTrue(vad.IsSpeech(frame));
    }
}
