# Audio Device Selection Implementation Plan

**Goal:** Implement real input/output device selection in Settings > Audio and onboarding, replacing the current `Default`-only dropdowns with real device lists and wiring the saved selections into the native audio stack.

**Architecture:** Add a backend audio-device enumeration bridge (`voice.getAudioDevices` / `voice.audioDevices`), load device options in the React settings and onboarding flows, and teach `AudioManager` / `MumbleAdapter` to apply `inputDevice` and `outputDevice` from persisted settings. Build the feature in slices: enumeration first, input-device switching second, output-device switching third, then fallback handling and test coverage.

**Tech Stack:** C# (.NET), NAudio, React/TypeScript, MSTest / frontend tests

---

### [x] Task 1: Add backend audio-device enumeration

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/` (new or existing voice service tests)

**Step 1: Add a lightweight DTO for audio device options**

Add a simple shape for bridge responses:

```csharp
public sealed record AudioDeviceOption(string Id, string Name);
```

and a response shape like:

```csharp
public sealed record AudioDevicesPayload(
    IReadOnlyList<AudioDeviceOption> Input,
    IReadOnlyList<AudioDeviceOption> Output
);
```

**Step 2: Enumerate active capture and render endpoints**

In `AudioManager.cs`, add methods that use `MMDeviceEnumerator`:

- capture: `EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active)`
- render: `EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active)`

Each list should:

- prepend `{ Id = "default", Name = "Default (System)" }`
- include active devices with stable MMDevice IDs and friendly names

**Step 3: Expose enumeration through the bridge**

In `MumbleAdapter.RegisterHandlers`, add:

```csharp
bridge.RegisterHandler("voice.getAudioDevices", _ =>
{
    var payload = _audioManager?.GetAudioDevices();
    _bridge?.Send("voice.audioDevices", payload);
    return Task.CompletedTask;
});
```

**Step 4: Add backend tests**

Add tests that validate:

- returned payload includes `default` first
- capture and render lists are shaped correctly
- enumeration failures degrade safely instead of crashing the bridge handler

**Step 5: Verify manually**

Run the client and confirm the new bridge message returns real devices even before the UI uses them.

---

### [x] Task 2: Load device lists into Settings > Audio

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx` only if shared state/helpers are needed
- Test: `src/Brmble.Web/src/components/SettingsModal/` tests

**Step 1: Add frontend device option types**

In `AudioSettingsTab.tsx`, add a local type like:

```ts
type AudioDeviceOption = { id: string; name: string };
```

**Step 2: Request devices when the tab mounts**

Use the existing bridge pattern:

- subscribe to `voice.audioDevices`
- send `voice.getAudioDevices`
- clean up the listener on unmount

Store separate `inputDevices` and `outputDevices` lists in component state.

**Step 3: Replace hardcoded dropdown options**

Replace:

```ts
options={[{ value: 'default', label: 'Default' }]}
```

with mapped options from backend payload:

```ts
options={inputDevices.map(d => ({ value: d.id, label: d.name }))}
```

and the equivalent for output.

**Step 4: Handle loading/error fallback**

While loading:

- disable the selects or show only `Default (System)`

If enumeration fails:

- keep the form usable with `Default (System)` only
- do not block the modal

**Step 5: Add frontend tests**

Cover:

- device list rendering from `voice.audioDevices`
- changing input/output selection updates `AudioSettings`
- fallback UI still shows a valid select when enumeration is unavailable

---

### [x] Task 3: Load device lists into onboarding

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx`
- Test: onboarding-related tests if present

**Step 1: Reuse the same bridge flow in onboarding**

On the audio step:

- request `voice.getAudioDevices`
- subscribe to `voice.audioDevices`
- store local input/output option lists

**Step 2: Replace onboarding’s hardcoded `Default` options**

Update both onboarding selects to use the real enumerated device lists.

**Step 3: Keep saved onboarding state unchanged**

No settings-schema change is needed. Keep writing:

- `audio.inputDevice`
- `audio.outputDevice`

through the existing `settings.set` path.

**Step 4: Verify parity**

Confirm onboarding and settings show the same devices and labels in the same order.

---

### [x] Task 4: Apply input-device selection in `AudioManager`

Status: completed

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/AudioManager*`

**Step 1: Add input-device state to `AudioManager`**

Add a field like:

```csharp
private string _inputDeviceId = "default";
```

**Step 2: Add `SetInputDevice(string deviceId)`**

Behavior:

- no-op if unchanged
- if mic is active, stop mic
- dispose/recreate the current capture device
- restart mic if it was previously active
- save the chosen device ID in the manager state

**Step 3: Update capture creation logic**

In `StartMicLocked`, replace hardcoded default selection:

- WASAPI:
  - `"default"` => `GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications)`
  - specific ID => `GetDevice(deviceId)`
- WaveIn:
  - for v1, either map to device number if reliable or keep `default`-only behavior

**Step 4: Wire persisted settings through `ApplySettings`**

In `MumbleAdapter.ApplySettings`, after existing transmission/volume/capture settings, call:

```csharp
_audioManager?.SetInputDevice(settings.Audio.InputDevice);
```

**Step 5: Add tests**

Cover:

- changing input device restarts capture once
- applying the same device is a no-op
- invalid device falls back safely

**Step 6: Manual verification**

With `captureApi = wasapi`, change microphone devices in Settings during a live session and confirm capture moves to the selected device.

---

### [x] Task 5: Add output-device switching in `AudioManager`

Status: completed

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/AudioManager*`

**Step 1: Add output-device state**

Add a field like:

```csharp
private string _outputDeviceId = "default";
```

**Step 2: Centralize player creation**

Extract the current per-user `WaveOutEvent` setup in `FeedVoice` into a helper such as:

```csharp
private WaveOutEvent CreatePlayerFor(JitterBuffer jb)
```

This makes device-aware recreation much easier.

**Step 3: Teach player creation to use the selected device**

If the current playback stack supports it reliably:

- `"default"` => `DeviceNumber = -1`
- chosen device => resolved playback device number

If not, stop here and swap playback to a WASAPI-based output path before continuing. Do not ship output selection on a brittle mapping.

**Step 4: Add `SetOutputDevice(string deviceId)`**

Behavior:

- no-op if unchanged
- stop/dispose all active players
- recreate them against the selected output device
- preserve existing jitter buffers and per-user volume state

**Step 5: Wire persisted settings through `ApplySettings`**

In `MumbleAdapter.ApplySettings`, call:

```csharp
_audioManager?.SetOutputDevice(settings.Audio.OutputDevice);
```

**Step 6: Add tests**

Cover:

- output-device change recreates active players
- jitter buffers survive the switch
- same-device apply is a no-op

**Step 7: Manual verification**

Join a voice session, change the output device, and verify playback moves to the new headset/speaker with only a short handoff interruption.

---

### [x] Task 6: Add fallback and invalid-device recovery

Status: completed

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs` only if helper methods are needed
- Modify: frontend notification surface if we want a user-visible message

**Step 1: Detect invalid saved device IDs**

When applying settings:

- validate that `InputDevice` exists or is `default`
- validate that `OutputDevice` exists or is `default`

**Step 2: Fall back to `default` safely**

If a device ID is missing:

- log the issue
- switch that device to `default`
- continue startup without failing audio

**Step 3: Persist the repaired setting**

Update config so the UI reflects the fallback on the next `settings.updated`.

If `MumbleAdapter` already has access to `IAppConfigService`, use that path rather than inventing a second persistence flow.

**Step 4: Add a lightweight user-visible message**

Optional but recommended:

- emit a bridge/system message such as `Saved audio device unavailable; switched to Default (System).`

**Step 5: Add tests**

Cover startup with missing input/output devices and confirm the config is repaired to `default`.

---

### [x] Task 7: Handle `waveIn` limitations explicitly

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`
- Test: relevant frontend/backend tests

**Step 1: Decide the supported behavior**

Choose one of these and implement it consistently:

1. Full `waveIn` mapping support
2. `waveIn` remains default-only, specific device selection is WASAPI-only

**Step 2: Reflect that in the UI**

If option 2:

- disable non-default input-device choices while `captureApi === 'waveIn'`, or
- allow selection but show explanatory copy and coerce to WASAPI

Recommendation:

- keep the product honest and explicit; do not pretend `waveIn` supports specific-device targeting if it does not

**Step 3: Add tests**

Cover whichever branch we choose so the UI and backend do not drift.

---

### [ ] Task 8: Finish test coverage and regression pass

Status: automated regression completed; manual QA checklist pending

**Files:**
- Modify: backend test files under `tests/Brmble.Client.Tests/Services/`
- Modify: frontend tests around settings/onboarding as needed

**Step 1: Backend regression pass**

Run targeted tests for:

- `AppConfigService`
- `AudioManager`
- `MumbleAdapter`

**Step 2: Frontend regression pass**

Run targeted tests for:

- `AudioSettingsTab`
- `SettingsModal`
- `OnboardingWizard`

**Step 3: Manual QA checklist**

1. Settings > Audio shows real input/output devices.
2. Onboarding audio step shows the same real devices.
3. Changing microphone during a call moves capture to the selected device.
4. Changing output during a call moves playback to the selected device.
5. Restart preserves the selected devices.
6. Unplugging the selected headset falls back cleanly to `Default (System)`.
7. `waveIn` behavior matches the decided product rule.

**Step 4: Commit in slices**

Recommended commit boundaries:

1. `feat: expose audio devices over native bridge`
2. `feat: show selectable audio devices in settings and onboarding`
3. `feat: apply selected input audio device`
4. `feat: apply selected output audio device`
5. `fix: fall back when saved audio devices are unavailable`

---

## Recommended Execution Order

For lowest risk, execute in this order:

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 7
6. Task 5
7. Task 6
8. Task 8

Reason:

- enumeration/UI work is straightforward and gives us fast feedback
- input-device support on WASAPI is the easiest real feature slice
- `waveIn` limits should be clarified before output work broadens scope
- output-device switching is the most fragile part and should happen after the safer path is already working
