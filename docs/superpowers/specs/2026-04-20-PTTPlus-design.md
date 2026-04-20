# PTT+ (Push-to-Talk Plus) Design

**Date:** 2026-04-20  
**Status:** Approved

## Concept

- **Always-Warm:** Mic, WebRTC APM (Audio Processing Module), and Opus encoder always run in the background
- **Software Gate:** Audio is sent to the server when the PTT key is pressed, held until released
- **No Clipping:** Filters already "know" background noise, encoder is already active

## Architecture

### Enum Addition

```csharp
public enum TransmissionMode 
{ 
    Continuous, 
    VoiceActivity, 
    PushToTalk, 
    PushToTalkPlus  // new
}
```

### Audio Flow

```
AudioManager
├── TransmissionMode: PushToTalkPlus
├── EncodePipeline: always running (same as Continuous)
├── OnMicData:
│   → Capture device → APM → Encoder
│                    ↓
│         [check _pttActive]
│                    ↓
│         SendVoicePacket → server
└── SetPttActive:
    - true: pipeline output → server (packets flow)
    - false: pipeline output → discarded
```

## Changes

1. **TransmissionMode enum:** Add `PushToTalkPlus`
2. **OnMicData:** Always call processor + encoder (no-op if muted)
3. **Software gate:** Check `_transmissionMode == PushToTalkPlus && _pttActive` before sending
4. **EncodePipeline sequence:** Continues running (no reset on key press/release)

## Behavior

| Scenario | Behavior |
|----------|----------|
| PTT+ mode, key pressed | Full quality audio from 1st ms |
| PTT+ mode, key released | 80ms silence tail → stops with gate closed |
| Switch to Continuous | Gate permanently open, existing flow |
| Switch to PTT (classic) | Existing PTT behavior |

## Test Coverage

- `AudioManager` tests: verify processing always active, gate controls correctly
- Integration: verify no clip at PTT+ key press