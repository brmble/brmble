using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// Covers the idempotency guard added in #470 follow-up. Tests use
/// hwnd = IntPtr.Zero so SetTransmissionMode skips Win32 hook/hotkey
/// registration; that path is documented as the test seam in
/// AudioManager.SetTransmissionMode's XML doc.
/// </summary>
[TestClass]
public class AudioManagerTransmissionModeTests
{
    [TestMethod]
    public void FirstCall_AppliesConfiguration()
    {
        using var audio = new AudioManager();

        audio.SetTransmissionMode(TransmissionMode.VoiceActivity, key: null, hwnd: IntPtr.Zero);

        Assert.AreEqual(TransmissionMode.VoiceActivity, audio.TransmissionMode);
        Assert.AreEqual(1, audio.TransmissionApplyCount);
    }

    [TestMethod]
    public void IdenticalSecondCall_IsNoOp()
    {
        using var audio = new AudioManager();

        audio.SetTransmissionMode(TransmissionMode.VoiceActivity, key: null, hwnd: IntPtr.Zero);
        audio.SetTransmissionMode(TransmissionMode.VoiceActivity, key: null, hwnd: IntPtr.Zero);
        audio.SetTransmissionMode(TransmissionMode.VoiceActivity, key: null, hwnd: IntPtr.Zero);

        Assert.AreEqual(1, audio.TransmissionApplyCount, "guard must skip identical repeats");
    }

    [TestMethod]
    public void ChangedMode_BypassesGuard()
    {
        using var audio = new AudioManager();

        audio.SetTransmissionMode(TransmissionMode.VoiceActivity, key: null, hwnd: IntPtr.Zero);
        audio.SetTransmissionMode(TransmissionMode.Continuous, key: null, hwnd: IntPtr.Zero);

        Assert.AreEqual(TransmissionMode.Continuous, audio.TransmissionMode);
        Assert.AreEqual(2, audio.TransmissionApplyCount);
    }

    [TestMethod]
    public void ChangedKey_BypassesGuard()
    {
        using var audio = new AudioManager();

        audio.SetTransmissionMode(TransmissionMode.PushToTalk, key: "F1", hwnd: IntPtr.Zero);
        audio.SetTransmissionMode(TransmissionMode.PushToTalk, key: "F2", hwnd: IntPtr.Zero);

        Assert.AreEqual(2, audio.TransmissionApplyCount);
    }

    [TestMethod]
    public void NullVsNonNullKey_BypassesGuard()
    {
        using var audio = new AudioManager();

        audio.SetTransmissionMode(TransmissionMode.PushToTalk, key: null, hwnd: IntPtr.Zero);
        audio.SetTransmissionMode(TransmissionMode.PushToTalk, key: "F1", hwnd: IntPtr.Zero);

        Assert.AreEqual(2, audio.TransmissionApplyCount);
    }

    [TestMethod]
    public void ChangedHwnd_BypassesGuard()
    {
        using var audio = new AudioManager();

        audio.SetTransmissionMode(TransmissionMode.Continuous, key: null, hwnd: IntPtr.Zero);
        audio.SetTransmissionMode(TransmissionMode.Continuous, key: null, hwnd: new IntPtr(1));

        Assert.AreEqual(2, audio.TransmissionApplyCount);
    }

    [TestMethod]
    public void DefaultMode_StillRunsOnFirstCall()
    {
        // _transmissionMode defaults to Continuous; the guard must NOT skip
        // the very first call even though `mode == _transmissionMode`.
        using var audio = new AudioManager();

        audio.SetTransmissionMode(TransmissionMode.Continuous, key: null, hwnd: IntPtr.Zero);

        Assert.AreEqual(1, audio.TransmissionApplyCount);
    }

    [TestMethod]
    public void RepeatedDefaultMode_StaysIdempotentAfterFirstCall()
    {
        using var audio = new AudioManager();

        for (int i = 0; i < 50; i++)
        {
            audio.SetTransmissionMode(TransmissionMode.Continuous, key: null, hwnd: IntPtr.Zero);
        }

        Assert.AreEqual(1, audio.TransmissionApplyCount);
    }
}
