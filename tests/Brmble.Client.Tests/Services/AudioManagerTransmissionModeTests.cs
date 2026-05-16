using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System.Reflection;

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
    public void ChangedHwnd_BypassesGuard()
    {
        // Mute first so the body's StartMic call short-circuits on the second
        // SetTransmissionMode — without this, hwnd != Zero exits the test
        // seam and opens a real WASAPI device, which is flaky on CI.
        using var audio = new AudioManager();
        audio.SetMuted(true);

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

    [TestMethod]
    public void SuspendHotkeys_ClearsMouseShortcutRegistrationState()
    {
        using var audio = new AudioManager();
        SetPrivateField(audio, "_shortcutActionForMouse", "toggleMute");
        SetPrivateField(audio, "_shortcutKeyForMouse", "MouseRight");
        SetPrivateField(audio, "_shortcutMouseVk", AudioManager.KeyNameToVirtualKey("MouseRight"));
        SetPrivateField(audio, "_heldMouseAction", "toggleMute");

        audio.SuspendHotkeys();

        Assert.IsNull(GetPrivateField(audio, "_shortcutActionForMouse"));
        Assert.IsNull(GetPrivateField(audio, "_shortcutKeyForMouse"));
        Assert.AreEqual(0, GetPrivateField(audio, "_shortcutMouseVk"));
        Assert.IsNull(GetPrivateField(audio, "_heldMouseAction"));
    }

    [TestMethod]
    public void ClearingShortcut_ClearsExistingMouseShortcutRegistrationState()
    {
        using var audio = new AudioManager();
        SetPrivateField(audio, "_hwnd", new IntPtr(1));
        SetPrivateField(audio, "_shortcutActionForMouse", "toggleMute");
        SetPrivateField(audio, "_shortcutKeyForMouse", "MouseRight");
        SetPrivateField(audio, "_shortcutMouseVk", AudioManager.KeyNameToVirtualKey("MouseRight"));
        SetPrivateField(audio, "_heldMouseAction", "toggleMute");

        audio.SetShortcut("toggleMute", null);

        Assert.IsNull(GetPrivateField(audio, "_shortcutActionForMouse"));
        Assert.IsNull(GetPrivateField(audio, "_shortcutKeyForMouse"));
        Assert.AreEqual(0, GetPrivateField(audio, "_shortcutMouseVk"));
        Assert.IsNull(GetPrivateField(audio, "_heldMouseAction"));
    }

    // -- IsTransmissionConfigStillValid (pure helper) ---------------------
    // These tests exercise the consistency check directly, which the
    // integration tests above can't reach because hwnd=IntPtr.Zero short-
    // circuits the helper to "valid".

    private static readonly IntPtr FakeHwnd = new(0x1234);

    private static AudioManager.PttInputState State(
        IntPtr mouseHookHandle = default,
        string? shortcutAction = null,
        string? shortcutKey = null,
        int pttVk = 0,
        bool pttPollingActive = false)
        => new(mouseHookHandle, shortcutAction, shortcutKey, pttVk, pttPollingActive);

    [TestMethod]
    public void Validity_NonPttMode_AlwaysValid()
    {
        // Continuous and VoiceActivity don't own a hook/timer, so any state
        // is "still valid" — guard takes the fast path on identical args.
        Assert.IsTrue(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.Continuous, key: "F1", FakeHwnd, State()));
        Assert.IsTrue(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.VoiceActivity, key: null, FakeHwnd, State()));
    }

    [TestMethod]
    public void Validity_HwndZero_AlwaysValid()
    {
        // hwnd == Zero is the test seam; nothing was ever registered.
        Assert.IsTrue(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "XButton2", IntPtr.Zero, State()));
    }

    [TestMethod]
    public void Validity_PttNullKey_AlwaysValid()
    {
        // PTT mode without a key configured can't have anything to invalidate.
        Assert.IsTrue(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: null, FakeHwnd, State()));
    }

    [TestMethod]
    public void Validity_MouseHook_OursAndAlive_IsValid()
    {
        var state = State(
            mouseHookHandle: new IntPtr(0xABCD),
            shortcutAction: "pushToTalk",
            shortcutKey: "XButton2");

        Assert.IsTrue(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "XButton2", FakeHwnd, state));
        Assert.IsTrue(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalkPlus, key: "XButton2", FakeHwnd, state));
    }

    [TestMethod]
    public void Validity_MouseHook_StolenByShortcut_IsInvalid()
    {
        // Hook is registered but for a different action — SetShortcut stole it.
        var state = State(
            mouseHookHandle: new IntPtr(0xABCD),
            shortcutAction: "toggleMute",
            shortcutKey: "MouseLeft");

        Assert.IsFalse(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "XButton2", FakeHwnd, state));
    }

    [TestMethod]
    public void Validity_MouseHook_DifferentKey_IsInvalid()
    {
        var state = State(
            mouseHookHandle: new IntPtr(0xABCD),
            shortcutAction: "pushToTalk",
            shortcutKey: "XButton1");

        Assert.IsFalse(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "XButton2", FakeHwnd, state));
    }

    [TestMethod]
    public void Validity_MouseHook_NoHandle_IsInvalid()
    {
        // Registration failed (SetWindowsHookEx returned IntPtr.Zero).
        var state = State(
            mouseHookHandle: IntPtr.Zero,
            shortcutAction: "pushToTalk",
            shortcutKey: "XButton2");

        Assert.IsFalse(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "XButton2", FakeHwnd, state));
    }

    [TestMethod]
    public void Validity_KeyboardPtt_PollingActive_IsValid()
    {
        var f1Vk = AudioManager.KeyNameToVirtualKey("F1");
        var state = State(pttVk: f1Vk, pttPollingActive: true);

        Assert.IsTrue(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "F1", FakeHwnd, state));
    }

    [TestMethod]
    public void Validity_KeyboardPtt_PollingDead_IsInvalid()
    {
        var f1Vk = AudioManager.KeyNameToVirtualKey("F1");
        var state = State(pttVk: f1Vk, pttPollingActive: false);

        Assert.IsFalse(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "F1", FakeHwnd, state));
    }

    [TestMethod]
    public void Validity_KeyboardPtt_WrongVk_IsInvalid()
    {
        // Tracked vk doesn't match what KeyNameToVirtualKey returns for the
        // requested key — happens after a key change re-registered for a
        // different vk and someone else then steals the polling timer.
        var state = State(pttVk: 0xFE, pttPollingActive: true);

        Assert.IsFalse(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "F1", FakeHwnd, state));
    }

    [TestMethod]
    public void Validity_KeyboardPtt_UnparseableKey_IsInvalid()
    {
        // Bogus key → KeyNameToVirtualKey returns 0 → guard refuses to skip,
        // even with a "live" polling state. Reconfigure each time so a fixed
        // key binding is picked up immediately.
        var state = State(pttVk: 0, pttPollingActive: true);

        Assert.IsFalse(AudioManager.IsTransmissionConfigStillValid(
            TransmissionMode.PushToTalk, key: "ThisKeyDoesNotExist", FakeHwnd, state));
    }
}
