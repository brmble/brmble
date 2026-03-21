# Audio Capture Migration: WaveInEvent → WASAPI

**Goal:** Replace WaveInEvent with WASAPI for microphone capture, with a hard toggle for testing.

**Architecture:** Add a dev toggle in Settings > Voice to switch between `WaveInEvent` (legacy) and `WasapiCapture` (WASAPI). Persist the setting in `AudioSettings`. Backend uses the selected capture API directly — no fallback on failure.

**Tech Stack:** C#, NAudio.CoreAudioApi, React/TypeScript

---

## Background

Issue #231 requests migrating from legacy `WaveInEvent` (Windows multimedia API) to WASAPI (Windows Audio Session API) for:
- Direct hardware access (bit-perfect capture)
- Lower latency
- Better audio quality
- Feature parity with original Mumble

---

## Frontend Changes

### AudioSettings Interface

Add `captureApi` field to `AudioSettings` in `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`:

```typescript
export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  maxAmplification: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  captureApi: 'waveIn' | 'wasapi';  // NEW
}
```

Default: `'waveIn'` (maintains current behavior)

### UI Toggle

Add a "DEV" labeled section in `AudioSettingsTab.tsx` with a toggle switch:
- Label: "Audio Capture API"
- Options: "WaveIn (Legacy)" / "WASAPI"
- Position: Bottom of voice settings tab

### AppSettings (C# Backend)

Update `src/Brmble.Client/Services/AppConfig/AppSettings.cs`:

```csharp
public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int MaxAmplification = 100,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null,
    string CaptureApi = "waveIn"  // NEW
);
```

---

## Backend Changes

### Package Reference

Add `NAudio.CoreAudioApi` to `src/Brmble.Client/Brmble.Client.csproj`:

```xml
<PackageReference Include="NAudio.CoreCoreApi" Version="2.1.0" />
```

### AudioManager Changes

In `src/Brmble.Client/Services/Voice/AudioManager.cs`:

1. **Add field for capture API selection:**
   ```csharp
   private string _captureApi = "waveIn";
   ```

2. **Add method to set capture API:**
   ```csharp
   public void SetCaptureApi(string api) => _captureApi = api;
   ```

3. **Modify StartMic to select capture type:**
   ```csharp
   if (_waveIn == null)
   {
       if (_captureApi == "wasapi")
       {
           _waveIn = new WasapiCapture
           {
               ShareMode = AudioClientShareMode.Shared
           };
           // Handle RecordingStopped event for error logging
       }
       else
       {
           _waveIn = new WaveInEvent
           {
               DeviceNumber = -1,
               BufferMilliseconds = 20,
               WaveFormat = new WaveFormat(48000, 16, 1)
           };
       }
       _waveIn.DataAvailable += OnMicData;
   }
   ```

4. **Handle WASAPI float format in OnMicData:**
   - WASAPI returns float32 samples (range -1.0 to 1.0)
   - Convert to int16 for existing pipeline
   - WaveInEvent already returns int16

---

## Testing

1. Default (`waveIn`): Existing behavior unchanged
2. Toggle to `wasapi`: Should capture audio via WASAPI
3. Toggle back to `waveIn`: Should work normally

---

## Error Handling

- **Hard toggle**: No fallback. If WASAPI fails, it fails.
- Log errors to audio.log via `AudioLog.Write()`
- WASAPI RecordingStopped event logs exceptions

---

## Files Modified

| File | Change |
|------|--------|
| `src/Brmble.Client/Brmble.Client.csproj` | Add NAudio.CoreCoreApi package |
| `src/Brmble.Client/Services/AppConfig/AppSettings.cs` | Add CaptureApi field |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Implement capture API selection |
| `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` | Add toggle UI |
| `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx` | Pass captureApi to backend |
