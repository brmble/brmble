# PLC Design - Issue #236

## Overview
Implement Packet Loss Concealment (PLC) in the Brmble client to replace silence with interpolated audio when packets are lost.

## Background
The native Opus decoder already exposes PLC via `opus_decode()`. When `srcEncodedBuffer` is passed as `null`, Opus's PLC is triggered to interpolate audio for missing packets.

## Current Behavior
`UserAudioPipeline` decodes each packet as it arrives but:
- Does NOT track sequence numbers to detect gaps
- Does NOT call decoder with null to trigger PLC
- Result: lost packets = silence

## Design

### Architecture
No new components - modify `UserAudioPipeline` to track sequence numbers and trigger PLC.

### Sequence Tracking
- Track `_lastSequence` (long) - initialized to -1
- On each `FeedEncodedPacket` call, compare current sequence with last

### Dynamic Frame Sizing
- Use `OpusDecoder.GetSamples()` on first packet to auto-detect samples per frame
- Store as `_samplesPerFrame`
- Default fallback: 960 samples (20ms @ 48kHz) if first packet unavailable

### Gap Detection & PLC
```csharp
if (_lastSequence >= 0 && sequence > _lastSequence + 1)
{
    int missed = (int)(sequence - _lastSequence - 1);
    // Clamp to prevent queue explosion
    missed = Math.Min(missed, MAX_PLC_FRAMES);
    
    for (int i = 0; i < missed; i++)
    {
        var plcFrame = new byte[_samplesPerFrame * _bytesPerSample];
        _decoder.Decode(null, 0, 0, plcFrame, 0);  // PLC
        lock(_lock) _pcmQueue.Enqueue(plcFrame);
    }
}
_lastSequence = sequence;
```

### Sequence Handling
- **Out-of-order**: If sequence < lastSequence, process normally (don't skip)
- **Duplicate**: If sequence == lastSequence, skip (don't decode twice)
- **Initial**: First packet sets `_lastSequence`, no PLC triggered

### Limits & Caps
- `MAX_PLC_FRAMES = 20` - max consecutive PLC frames (400ms @ 20ms frames)
- `MAX_GAP_FRAMES = 20` - max gap to process (sanity limit)

### Constants
```csharp
private const int MAX_PLC_FRAMES = 20;
private const int MAX_GAP_FRAMES = 20;
private long _lastSequence = -1;
private int _samplesPerFrame;
```

## Testing
- Test gap detection (single packet loss)
- Test multiple consecutive lost packets
- Test sequence wraparound handling
- Test out-of-order packets
- Test duplicate packets

## Success Criteria
- Lost packets produce interpolated audio instead of silence
- No audible artifacts on single packet loss
- Burst loss (multiple packets) produces reasonable concealment
- Queue doesn't explode with excessive PLC frames
