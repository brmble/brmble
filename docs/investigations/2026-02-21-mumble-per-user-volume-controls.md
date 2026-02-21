# Investigation Report: Per-User Volume Controls in Mumble

**Date:** 2026-02-21  
**Purpose:** Investigate how Mumble implements per-user volume controls to inform future implementation in Brmble

---

## 1. Executive Summary

Mumble has supported per-user (local) volume adjustment since version 1.3.0. The feature allows users to adjust the volume of individual speakers independently, which is useful when different users have varying microphone volumes or when you want to hear certain users at different levels.

**Key findings:**
- Mumble implements per-user volume as a client-side multiplier applied during audio mixing
- Volume is stored per-user in a dictionary keyed by session ID
- The implementation applies a float multiplier (0.0 to infinity, typically 0.0-2.0) to PCM audio samples before playback
- Mumble's AudioOutputSpeech class handles per-user volume during the mixing phase
- Mumble also supports input volume (transmission volume) as a global setting

---

## 2. Mumble Implementation Details

### 2.1 Architecture Overview

Mumble's audio system uses Qt's audio framework with the following key classes:

| Class | Purpose |
|-------|---------|
| `AudioInput` | Captures microphone input, applies processing |
| `AudioOutput` | Main audio output manager |
| `AudioOutputSpeech` | Handles playback for individual speaking users |
| `Settings` | Stores user preferences including volume settings |

### 2.2 Per-User Volume Implementation

**Location in source:** `src/mumble/AudioOutputSpeech.cpp`

Mumble stores per-user volume as a dictionary in the Settings class:

```cpp
// In Settings.h - typically defined as:
QHash<unsigned int, float> qmUserVolumes;  // user session ID -> volume multiplier
```

The volume is applied during audio mixing. When audio is played back for a specific user, the volume multiplier is applied to the PCM samples:

```cpp
// Pseudo-code from AudioOutputSpeech
void AudioOutputSpeech::mix() {
    float volume = g.s.qmUserVolumes.value(sessionId, 1.0f);
    for (int i = 0; i < sampleCount; i++) {
        outputBuffer[i] = userBuffer[i] * volume;
    }
}
```

**Volume range:**
- 1.0 = default (no change)
- 0.0 = silent
- 2.0 = 200% volume (doubled)
- Values can exceed 2.0 for additional amplification

### 2.3 UI for Volume Adjustment

Mumble provides a dialog for per-user volume adjustment:

1. **Access method:** Right-click on a user in the user list → "Adjust volume"
2. **Dialog:** `UserLocalVolumeDialog` - a slider from 0% to 400%
3. **Persistence:** Saved in settings file (`mumble_settings.json`)

The UI allows users to:
- Set volume from 0% to 400%
- Reset to default (100%)
- See the current volume level

### 2.4 Input Volume (Transmission Volume)

Mumble also supports adjusting input (transmission) volume:

- **Location:** Settings → Audio Input → Volume
- **Purpose:** Amplify microphone input before encoding
- **Range:** 0% to 400% (via "Maximum Amplification" setting)
- **Implementation:** Applied in `AudioInput.cpp` before Opus encoding

---

## 3. Brmble Current State

### 3.1 Existing Audio Architecture

Brmble's audio system is implemented in:

| File | Purpose |
|------|---------|
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Main audio I/O orchestration |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Mumble protocol integration |
| `lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs` | Per-user decode pipeline |
| `lib/MumbleVoiceEngine/Codec/OpusDecoder.cs` | Opus decoding |

### 3.2 Current Volume Settings

**AppSettings.cs** defines volume settings (currently unused):

```csharp
public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 100,    // 0-100
    int OutputVolume = 100,   // 0-100
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null
);
```

**Status:** These values are defined in config but NOT currently applied to audio processing.

### 3.3 Current Audio Flow

```
Microphone → WaveInEvent → EncodePipeline → Opus → Network
Network → Opus → UserAudioPipeline → WaveOutEvent → Speakers
```

### 3.4 Gap Analysis

| Feature | Mumble | Brmble |
|---------|--------|--------|
| Per-user output volume | ✅ Implemented | ❌ Not implemented |
| Global input volume | ✅ Implemented | ❌ Config exists but unused |
| Global output volume | ✅ Implemented | ❌ Config exists but unused |
| Per-user volume UI | ✅ Slider dialog | ❌ Not implemented |

---

## 4. Implementation Recommendations for Brmble

### 4.1 Per-User Output Volume

To implement per-user volume control in Brmble:

**1. Data Structure (C#):**
```csharp
// In AudioManager or new VolumeManager class
private readonly Dictionary<uint, float> _userVolumes = new();
// Default volume is 1.0f (100%)
```

**2. Volume Application Point:**
- Apply in `UserAudioPipeline` after Opus decode, before WaveOut playback
- Or apply in `AudioManager.FeedVoice()` before creating pipeline

**3. Volume Calculation:**
```csharp
// Apply volume to PCM samples (16-bit signed)
for (int i = 0; i < sampleCount; i++)
{
    short sample = pcmBuffer[i];
    float adjusted = sample * userVolume;
    // Clamp to prevent clipping
    adjusted = Math.Clamp(adjusted, short.MinValue, short.MaxValue);
    pcmBuffer[i] = (short)adjusted;
}
```

**4. API for Frontend:**
```csharp
// In VoiceService interface
void SetUserVolume(uint sessionId, float volume);  // volume: 0.0 to 2.0
float GetUserVolume(uint sessionId);
```

**5. Bridge Messages:**
```json
// JavaScript → C#
{ "type": "voice.setUserVolume", "sessionId": 123, "volume": 1.5 }

// C# → JavaScript (acknowledgment)
{ "type": "voice.userVolumeSet", "sessionId": 123, "volume": 1.5 }
```

### 4.2 Global Input/Output Volume

**1. Input Volume (transmission):**
- Apply in `OnMicData()` before submitting to `EncodePipeline`
- Multiply PCM samples by input volume factor

**2. Output Volume (master volume):**
- Apply in `AudioManager` when mixing all user audio
- Or apply per-user and average

**3. Volume Factor Calculation:**
```csharp
// Convert percentage (0-100) to multiplier
float volumeFactor = percentage / 100.0f;

// Or for dB-like behavior (if desired)
// float volumeFactor = (float)Math.Pow(10.0, (db / 20.0));
```

### 4.3 Frontend Implementation

**Volume Slider Component:**
- Range: 0% to 200% (or 400% for power users)
- Default: 100%
- Visual feedback: Show percentage next to slider

**User Context Menu:**
- Right-click on user → "Adjust volume" → Opens slider

**Persistence:**
- Store per-user volumes in AppSettings
- Keyed by session ID or user ID

---

## 5. Technical Considerations

### 5.1 Thread Safety
- Audio processing happens on different threads (NAudio callbacks)
- Volume changes must be thread-safe using locks or `Interlocked`

### 5.2 Performance
- Volume multiplication is cheap (single float multiply per sample)
- Can be done in-place on PCM buffer

### 5.3 Audio Quality
- Reducing volume below 100% is lossless
- Increasing above 100% may cause clipping - consider soft limiting
- Consider applying volume before dithering (if used)

### 5.4 Mumble Protocol
- Per-user volume is CLIENT-SIDE ONLY
- Not transmitted to server
- Not visible to other users
- Survives reconnect but not server change

---

## 6. References

- Mumble GitHub: https://github.com/mumble-voip/mumble
- Per-user volume PRs: #2284, #2518 (merged in 1.3.0)
- Mumble Audio Settings Documentation: https://www.mumble.info/documentation/user/audio-settings/
- Mumble 1.3.0 Release Notes: https://www.mumble.info/blog/mumble-1.3.0-release-announcement/

---

## 7. Summary

Mumble implements per-user volume control as a simple client-side PCM multiplier. The implementation is straightforward:

1. Store volume per user session in a dictionary
2. Apply multiplier during audio mixing (decode phase)
3. Provide UI slider for adjustment
4. Persist in settings

Brmble can implement similar functionality by:
1. Adding volume tracking to `AudioManager`
2. Applying volume in `UserAudioPipeline` after decode
3. Exposing via VoiceService interface
4. Adding frontend UI components

The existing `InputVolume`/`OutputVolume` config values can be reused for global volume control, but must be wired to the audio processing code.
