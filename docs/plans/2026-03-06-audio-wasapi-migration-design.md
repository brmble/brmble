# Audio Capture Migration: WaveInEvent → WASAPI

## Overview

Replace `WaveInEvent` with `WasapiCapture` for microphone input, and add device selection support.

## Architecture

### Current (WaveInEvent)

```
WaveInEvent (device -1 = default)
    → OnMicData callback (byte[] PCM 16-bit)
    → AGC/Volume/Speech Enhancement
    → EncodePipeline
```

### Proposed (WASAPI)

```
WasapiCapture (selected device)
    → DataAvailable (float[] samples)
    → Convert float→int16
    → AGC/Volume/Speech Enhancement  
    → EncodePipeline
```

## Key Changes

### 1. Replace WaveInEvent with WasapiCapture

- NAudio's `WasapiCapture` from `NAudio.CoreAudioApi`
- Uses shared mode (same as Mumble) - works without exclusive access
- Returns IEEE float samples, convert to int16 for existing pipeline
- Requires adding `NAudio.CoreAudioApi` package reference

### 2. Add Device Enumeration

- Use `MMDeviceEnumerator` to list available input devices
- Store device ID in settings (currently no device selection UI)
- Frontend needs new UI for device dropdown

### 3. Maintain Same Processing Chain

- AGC, input volume, speech enhancement unchanged
- Encode pipeline unchanged
- Buffer handling stays at 20ms frames

## Components to Modify

| File | Change |
|------|--------|
| `src/Brmble.Client/Brmble.Client.csproj` | Add NAudio.CoreAudioApi package |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Replace WaveInEvent with WasapiCapture |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Add device enumeration methods |
| Frontend settings | Add device selection dropdown |
| Settings model | Add `inputDeviceId` setting |

## Error Handling

- Fall back gracefully if WASAPI fails (log and continue)
- Handle device disconnection gracefully
- WASAPI requires COM initialization (already done in client)

## Testing

- Verify mic capture works with default device
- Verify device selection works
- Verify AGC/volume/speech enhancement still work with float→int16 conversion
