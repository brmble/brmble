# Audio Device Selection Design

**Date:** 2026-05-09

**Goal:** Let users choose a specific input device and output device in Settings > Audio and in onboarding, instead of being limited to the system default devices.

---

## Overview

The settings model already persists `audio.inputDevice` and `audio.outputDevice`, but the UI only renders a single `Default` option today, and the native audio layer always opens the system default capture/playback devices.

Current behavior in this repo:

- `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` renders Input Device and Output Device selects with `[{ value: 'default', label: 'Default' }]` only.
- `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx` does the same in the audio onboarding step.
- `src/Brmble.Client/Services/AppConfig/AppSettings.cs` already persists `InputDevice` and `OutputDevice`.
- `src/Brmble.Client/Services/Voice/AudioManager.cs` hardcodes default capture:
  - WASAPI: `GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications)`
  - WaveIn: `DeviceNumber = -1`
- `src/Brmble.Client/Services/Voice/AudioManager.cs` creates output players with `new WaveOutEvent()` and never chooses a concrete playback device.

This design closes that gap and makes device selection a real end-to-end feature.

---

## Product Requirements

### User-visible behavior

Users can:

1. Choose a microphone from Settings > Audio > Input Device.
2. Choose a speaker/output device from Settings > Audio > Output Device.
3. Make the same choices during onboarding.
4. Keep using `Default` if they want the OS-selected communications device.

### Immediate apply

- Changing the input device applies immediately.
- Changing the output device applies immediately.
- The settings save immediately, matching the rest of the audio tab.

### Persistence

- Selected devices persist in config and survive restart.
- Existing users with `"default"` keep current behavior.

### Fallback behavior

If a saved device is missing at startup or unplugged later:

- Brmble falls back to `Default`.
- The session stays usable instead of failing audio startup.
- The UI shows `Default` selected after the fallback is persisted.
- A lightweight system message or toast should explain that the saved device was unavailable and Brmble switched to `Default`.

---

## Device Identity

### Stored value

Store stable native device IDs, not display names.

- Input device value: MMDevice ID for capture devices.
- Output device value: MMDevice ID for render devices.
- Reserved value: `"default"`.

Reason:

- Display names are not unique.
- IDs survive renames better than friendly labels.
- The config format already supports string values without schema changes.

### UI label

Each dropdown option should display:

- Primary label: friendly device name
- Secondary disambiguator when needed: state or interface label if two devices share the same name

If the current selected ID is not present in the latest list, the UI should temporarily show:

- `Unavailable device`

until the backend fallback updates settings to `"default"`.

---

## Architecture

### New bridge messages

Add a request/response pair for audio device enumeration:

1. Frontend sends `voice.getAudioDevices`
2. Backend replies with `voice.audioDevices`

Suggested payload:

```json
{
  "input": [
    { "id": "default", "name": "Default" },
    { "id": "{capture-device-id}", "name": "Microphone (Shure MV7)" }
  ],
  "output": [
    { "id": "default", "name": "Default" },
    { "id": "{render-device-id}", "name": "Speakers (Focusrite USB)" }
  ]
}
```

Optional future event:

- `voice.audioDevicesChanged`

This can be fired when Windows device topology changes. It is not required for v1 if we want to keep scope smaller; in v1, fetching on modal open and onboarding step mount is acceptable.

---

## Native Implementation

### 1. Enumerate devices

Add enumeration helpers in `src/Brmble.Client/Services/Voice/AudioManager.cs` or a nearby voice-specific service.

Use `MMDeviceEnumerator`:

- Capture list: `EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)`
- Render list: `EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)`

Return:

- `id`
- `friendly name`

Do not include disabled or unplugged devices in the selectable list for v1.

### 2. Apply selected input device

Add a method like:

```csharp
public void SetInputDevice(string deviceId)
```

Behavior:

- No-op if unchanged.
- If mic is running, stop mic, dispose current capture device, recreate capture on the requested device, then restart mic.
- Persist the selected ID through existing `settings.set` flow.

Capture creation rules:

- WASAPI capture:
  - `"default"` => current default communications capture endpoint
  - specific ID => `enumerator.GetDevice(deviceId)` and create `WasapiCapture(device, true, 20)`
- WaveIn fallback:
  - Prefer mapping the selected MMDevice to the corresponding `WaveInCapabilities` device number if feasible.
  - If that mapping is unreliable, document that specific input-device selection is supported only for WASAPI and force `"wasapi"` when a non-default input device is selected.

Recommendation:

- v1 should explicitly support full device selection on WASAPI.
- WaveIn can keep `"default"` only if device-ID mapping is awkward; in that case, disable or explain the limitation when `captureApi === 'waveIn'`.

### 3. Apply selected output device

Add a method like:

```csharp
public void SetOutputDevice(string deviceId)
```

Behavior:

- No-op if unchanged.
- Recreate active playback devices using the selected output endpoint.
- Existing per-user `WaveOutEvent` players must be stopped/disposed and recreated against the new device while preserving their `JitterBuffer`s.

Implementation note:

Today each remote user gets its own `WaveOutEvent` in `FeedVoice`. That means output-device switching must recreate every active player when the output device changes.

For `WaveOutEvent`, set:

- `DeviceNumber = -1` for `"default"`
- concrete `DeviceNumber` for a chosen device

This requires a render-device mapping from MMDevice ID to WaveOut device number. If mapping cannot be made reliable with the current playback stack, switch playback to a device-selectable API such as WASAPI output before shipping the feature.

Recommendation:

- Treat output-device selection as the forcing function to choose one stable playback path.
- If `WaveOutEvent` cannot reliably target MMDevice IDs, move playback to WASAPI output so stored output IDs map directly to the playback endpoint.

### 4. Startup validation

When `ApplySettings` runs in `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, it should also apply:

- `settings.Audio.InputDevice`
- `settings.Audio.OutputDevice`

If either device ID is invalid:

- fall back to `"default"`
- update saved settings through `AppConfigService`
- log the fallback in `audio.log`

---

## Frontend Implementation

### Settings modal

Update `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`:

- Load device lists on mount.
- Keep separate option arrays for input and output.
- Replace the hardcoded `Default`-only options with bridge-provided options.

Suggested shape:

```ts
type AudioDeviceOption = { id: string; name: string };
```

Map to existing `Select` options:

```ts
{ value: device.id, label: device.name }
```

### Onboarding

Update `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx` the same way so onboarding and settings stay consistent.

### Loading and empty states

- While devices are loading: disable dropdowns or show a loading placeholder.
- If enumeration fails: show `Default` only and surface a non-blocking error.

---

## UX Details

### Dropdown ordering

Recommended order:

1. `Default`
2. Active physical/virtual devices in backend enumeration order

### Copy

- `Default` should be labeled `Default (System)`
- Tooltip/help text:
  - Input: `Uses the microphone Brmble listens to for voice chat.`
  - Output: `Uses the speaker or headset Brmble plays voice chat through.`

### Device disappearance

If a selected USB headset is unplugged during a call:

- Input switch: fall back to default mic and keep transmitting once the new capture device starts.
- Output switch: recreate playback on the default output device with minimal interruption.

Brief audio interruption during device handoff is acceptable for v1.

---

## Testing

### Backend tests

Add tests around:

- Enumerating devices returns `Default` plus active endpoints.
- Invalid saved input device falls back to `default`.
- Invalid saved output device falls back to `default`.
- Changing input device while mic is running restarts capture exactly once.
- Changing output device recreates active players and preserves jitter buffers.

### Frontend tests

Add tests for:

- Settings audio tab renders device lists from `voice.audioDevices`.
- Onboarding audio step renders device lists from `voice.audioDevices`.
- Selecting an input device sends `settings.set` with `audio.inputDevice`.
- Selecting an output device sends `settings.set` with `audio.outputDevice`.
- Missing selected device shows safe fallback behavior.

### Manual QA

1. Open Settings > Audio and verify real devices appear.
2. Change input device and verify mic capture moves to the new device.
3. Change output device during an active voice session and verify playback moves.
4. Restart app and confirm selections persist.
5. Unplug the selected headset and verify Brmble falls back to `Default`.
6. Repeat with `captureApi = wasapi`.
7. Verify behavior or limitation messaging for `captureApi = waveIn`.

---

## Risks

### Output-device targeting with current playback stack

This is the main implementation risk.

The current code creates per-user `WaveOutEvent` players and does not currently track a selected render endpoint. If `WaveOutEvent` cannot be mapped cleanly from MMDevice IDs to device numbers, output-device selection will be brittle.

Mitigation:

- Validate device targeting early.
- If necessary, switch playback to a WASAPI-based output path as part of this feature.

### WaveIn-specific input selection

Specific device selection may be awkward when using legacy `WaveInEvent`.

Mitigation:

- Support full input-device selection only on WASAPI in v1.
- Keep `WaveIn` as a legacy/default-only path if necessary.

---

## Rollout Recommendation

Ship in two slices if we want lower risk:

1. Input-device selection first
2. Output-device selection second

Reason:

- Input selection is already close because WASAPI capture uses MMDevice directly.
- Output selection touches active playback reconstruction and is more sensitive during live calls.

If we do both together, output-device feasibility should be prototyped first.

---

## Summary

This feature is mostly a wiring gap, not a settings-schema gap:

- config already stores device strings
- UI already has the right fields
- backend audio already owns device creation

The missing pieces are:

- enumerate real devices
- expose them over the bridge
- apply `inputDevice` and `outputDevice` in `AudioManager`
- handle device loss safely
- keep onboarding and settings in sync
