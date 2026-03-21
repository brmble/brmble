# Design: Jitter Buffer and Output Delay Settings

## Overview

Add two new sliders to the Audio Settings tab in the Brmble client:
- **Jitter Buffer**: 10-60ms (network packet buffering)
- **Output Delay**: 10-100ms (audio driver buffering)

These settings allow users to balance latency vs. audio stability based on their network conditions and hardware, similar to Mumble's audio output settings.

## Architecture

### Settings Flow

```
Frontend (React)
    │
    ├── AudioSettingsTab.tsx (UI - sliders)
    │       │
    │       └── bridge.send('settings.set', { settings: newSettings })
    │               │
    ▼                │
Backend (C#)         │
    │                │
    ├── AppSettings.cs (AudioSettings record)
    │       │
    │       └── JitterBuffer: int = 20
    │       └── OutputDelay: int = 50
    │               │
    ▼                │
Audio Pipeline       │
    │                │
    ├── UserAudioPipeline.cs (jitter buffer delay)
    │       │
    └── AudioManager.cs (WaveOutEvent latency)
```

### Frontend Changes

**File**: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`

Add to `AudioSettings` interface:
```typescript
jitterBuffer: number;  // 10-60ms, default 20
outputDelay: number;   // 10-100ms, default 50
```

Add two sliders in the Output section:
- Jitter Buffer slider (10-60ms)
- Output Delay slider (10-100ms)

### Backend Changes

**File**: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

Add to `AudioSettings` record:
```csharp
int JitterBuffer = 20,
int OutputDelay = 50
```

### Audio Pipeline Implementation

**Jitter Buffer**: In `UserAudioPipeline.Read()`, implement a delay mechanism:
- Track timestamp of when frames are enqueued
- In `Read()`, wait until frame has been in queue for `jitterBuffer` ms before releasing
- Uses `DateTime.UtcNow` or `Stopwatch` for timing

**Output Delay**: In `AudioManager`, pass `DesiredLatency` to `WaveOutEvent`:
```csharp
new WaveOutEvent() { DesiredLatency = outputDelay }
```

## Default Values

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Jitter Buffer | 20ms | 10-60ms | Network packet buffering |
| Output Delay | 50ms | 10-100ms | Audio driver buffering |

## User Guidance

Based on Mumble's documentation:
- **Stable LAN**: Low values (10-20ms jitter, 10-30ms output)
- **Good Internet**: Medium values (20-40ms jitter, 40-60ms output)
- **Unstable/High Jitter**: Higher values (40-60ms jitter, 60-100ms output)

## Error Handling

- Clamp values to valid ranges on backend
- Handle audio device failures gracefully if latency is too low
- Log warnings if device doesn't support requested latency

## Testing Considerations

- Manual testing with different network conditions
- Verify audio plays correctly at min/max settings
- Test with various audio devices (different drivers may have different minimum latencies)
