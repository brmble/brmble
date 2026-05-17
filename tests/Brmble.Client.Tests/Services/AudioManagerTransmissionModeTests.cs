using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Reflection;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// Covers the idempotency guard for SetTransmissionMode. AudioManager no longer
/// owns input plumbing (InputRouter does), so the hwnd parameter is ignored and
/// hook/polling validity tests have moved to InputRouter's own suite.
/// </summary>
[TestClass]
public class AudioManagerTransmissionModeTests
{
    private static string GetPrivateStringField(AudioManager audio, string fieldName)
        => (string)typeof(AudioManager)
            .GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(audio)!;

    private static object? GetPrivateField(AudioManager audio, string fieldName)
        => typeof(AudioManager)
            .GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic)!
            .GetValue(audio);

    private static void SetPrivateField(AudioManager audio, string fieldName, object? value)
        => typeof(AudioManager)
            .GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(audio, value);

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

    [TestMethod]
    public void SetInputDevice_NullOrWhitespace_NormalizesToDefault()
    {
        using var audio = new AudioManager();

        audio.SetInputDevice("   ");

        Assert.AreEqual("default", GetPrivateStringField(audio, "_inputDeviceId"));
    }

    [TestMethod]
    public void SetOutputDevice_NullOrWhitespace_NormalizesToDefault()
    {
        using var audio = new AudioManager();

        audio.SetOutputDevice(null);

        Assert.AreEqual("default", GetPrivateStringField(audio, "_outputDeviceId"));
    }

    [TestMethod]
    public void SetInputDevice_StoresSelectedDeviceId()
    {
        using var audio = new AudioManager();

        audio.SetInputDevice("mic-device-123");

        Assert.AreEqual("mic-device-123", GetPrivateStringField(audio, "_inputDeviceId"));
    }

    [TestMethod]
    public void SetOutputDevice_StoresSelectedDeviceId()
    {
        using var audio = new AudioManager();

        audio.SetOutputDevice("speaker-device-456");

        Assert.AreEqual("speaker-device-456", GetPrivateStringField(audio, "_outputDeviceId"));
    }
}
