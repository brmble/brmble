# Hold Time Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Hold Time" slider to Audio Settings that controls how long the microphone keeps transmitting after speech stops when using Push to Talk.

**Architecture:** Frontend slider in `AudioSettingsTab.tsx` stores `voiceHoldMs` (100-2000ms, default 200) in settings. Backend receives it via `AppSettings` and applies it to `AudioManager._voiceHoldMs`, replacing the hardcoded `LocalSpeakingTimeoutMs`.

**Tech Stack:** TypeScript/React (frontend), C# (backend AudioManager)

---

## Files to Modify

| File | Change |
|------|--------|
| `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` | Add `voiceHoldMs` to interface, defaults, and slider UI |
| `src/Brmble.Client/Services/AppConfig/AppSettings.cs` | Add `VoiceHoldMs` to `AudioSettings` record |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Replace `LocalSpeakingTimeoutMs` with configurable `_voiceHoldMs` |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Call `SetVoiceHoldMs()` in `ApplySettings()` |

---

## Task 1: Update Frontend AudioSettings Interface and Defaults

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:20-31`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:37-48`

- [ ] **Step 1: Add `voiceHoldMs` to `AudioSettings` interface**

In the `AudioSettings` interface, add `voiceHoldMs: number;` to the type definition (around line 30).

- [ ] **Step 2: Add default value to `DEFAULT_SETTINGS`**

In `DEFAULT_SETTINGS`, add `voiceHoldMs: 200,` (around line 45).

---

## Task 2: Add Hold Time Slider UI

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:218-228`

- [ ] **Step 1: Add slider inside the PTT block**

After the Push to Talk Key binding button (inside the `{localSettings.transmissionMode === 'pushToTalk' && (...)}` block), add:

```tsx
<div className="settings-item settings-slider">
  <label>
    Hold Time: {localSettings.voiceHoldMs}ms{localSettings.voiceHoldMs === 200 ? ' (default)' : ''}
    <span className="tooltip-icon" data-tooltip="How long to keep transmitting after you stop speaking. Prevents cut-off when pausing between words.">?</span>
  </label>
  <input
    type="range"
    min="100"
    max="2000"
    step="10"
    value={localSettings.voiceHoldMs}
    onChange={(e) => handleChange('voiceHoldMs', parseInt(e.target.value, 10))}
  />
</div>
```

The slider should be placed right after the closing `</div>` of the Push to Talk Key item, before the closing `</>` of the transmission mode conditional block.

---

## Task 3: Update Backend AudioSettings Record

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:3-14`

- [ ] **Step 1: Add `VoiceHoldMs` to `AudioSettings` record**

Add `int VoiceHoldMs = 200,` to the `AudioSettings` record in `AppSettings.cs`:

```csharp
public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int MaxAmplification = 100,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null,
    int OpusBitrate = 72000,
    int OpusFrameSize = 20,
    string CaptureApi = "wasapi",
    int VoiceHoldMs = 200
);
```

---

## Task 4: Make Hold Time Configurable in AudioManager

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:211`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:267-268` (after SetMaxAmplification)

- [ ] **Step 1: Replace hardcoded constant with configurable field**

Change line 211 from:
```csharp
private const long LocalSpeakingTimeoutMs = 300; // 300ms silence → stop speaking
```

To a field (not const):
```csharp
private int _voiceHoldMs = 200;
```

- [ ] **Step 2: Add `SetVoiceHoldMs` method**

After `SetMaxAmplification` (around line 268), add:

```csharp
public void SetVoiceHoldMs(int ms) => _voiceHoldMs = Math.Clamp(ms, 100, 2000);
```

- [ ] **Step 3: Update usage of the constant**

Find line 1839 where `LocalSpeakingTimeoutMs` is used and change it to `_voiceHoldMs`:

```csharp
if (elapsed > _voiceHoldMs)
```

---

## Task 5: Wire Up in MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:690` (after SetCaptureApi call)

- [ ] **Step 1: Add `SetVoiceHoldMs` call in `ApplySettings`**

In `MumbleAdapter.ApplySettings()`, after the line:
```csharp
_audioManager?.SetCaptureApi(settings.Audio.CaptureApi);
```

Add:
```csharp
_audioManager?.SetVoiceHoldMs(settings.Audio.VoiceHoldMs);
```

---

## Task 6: Verify and Build

- [ ] **Step 1: Build the solution**

Run: `dotnet build`
Expected: Success with no errors

- [ ] **Step 2: Build the frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: Success with no errors

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add `voiceHoldMs` to frontend `AudioSettings` interface and defaults |
| 2 | Add slider UI in `AudioSettingsTab.tsx` (only when PTT mode selected) |
| 3 | Add `VoiceHoldMs` to backend `AudioSettings` C# record |
| 4 | Replace `LocalSpeakingTimeoutMs` with configurable `_voiceHoldMs` in AudioManager |
| 5 | Call `SetVoiceHoldMs()` in `MumbleAdapter.ApplySettings()` |
| 6 | Build and verify |
