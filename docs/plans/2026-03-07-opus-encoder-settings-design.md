# Design: Improve Opus Encoder Settings for Better Audio Quality

**Issue:** #235
**Date:** 2026-03-07
**Branch:** feature/improve-opus-encoder

## Background

Brmble's Opus encoder currently sets only bitrate and FEC. The application mode is hardcoded to `VOIP` regardless of bitrate, and VBR mode is left at the Opus default (VBR on). Mumble, the reference client, selects application mode based on bitrate and explicitly sets CBR.

### Current State

| Setting | Current Value | Source |
|---|---|---|
| Bitrate | 72,000 bps (hardcoded) | `AudioManager.cs:311` |
| Application mode | `OPUS_APPLICATION_VOIP` (hardcoded) | `OpusEncoder.cs:72` |
| VBR | Opus default (VBR on) | not set |
| FEC | Enabled | `EncodePipeline.cs:32` |
| Complexity | Opus default | not set |
| Signal type | Opus default | not set |

### What Mumble Actually Does (verified from source)

From `mumble-voip/mumble/src/mumble/AudioInput.cpp`:

- **Application mode** selected by bitrate:
  - `≥64kbps` + low delay allowed → `OPUS_APPLICATION_RESTRICTED_LOWDELAY`
  - `≥32kbps` → `OPUS_APPLICATION_AUDIO`
  - `<32kbps` → `OPUS_APPLICATION_VOIP`
- **VBR**: `opus_encoder_ctl(opusState, OPUS_SET_VBR(0))` — **CBR, not CVBR**
- **Complexity**: not set (Opus default)
- **Signal type**: not set

Note: The issue description states CVBR and complexity=10 — this is incorrect per Mumble's actual source.

## Design

### Approach

Option A — minimal CTL additions. Add only what is needed to match Mumble's behaviour, wire a bitrate dropdown into the settings UI.

### Section 1 — Native CTL Layer (`lib/MumbleVoiceEngine/Codec/OpusNative.cs`)

Add VBR CTL codes to the `Ctl` enum:

```csharp
SetVbrRequest = 4006,
GetVbrRequest = 4007,
```

No other CTL additions needed. Application mode is passed at encoder creation time (constructor argument), not via CTL.

### Section 2 — OpusEncoder (`lib/MumbleVoiceEngine/Codec/OpusEncoder.cs`)

1. Change constructor to accept `Application application` parameter instead of hardcoding `Application.Voip`.
2. Add `Vbr` bool property using the new CTL codes (get/set).

### Section 3 — EncodePipeline (`lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs`)

Select application mode from bitrate at construction time (matching Mumble logic):

```
bitrate >= 32000  →  Application.Audio
bitrate <  32000  →  Application.Voip
```

After construction, set `encoder.Vbr = false` (CBR).

### Section 4 — AppSettings (`src/Brmble.Client/Services/AppConfig/AppSettings.cs`)

Add `OpusBitrate` to the `AudioSettings` record:

```csharp
public record AudioSettings(
    ...
    int OpusBitrate = 72000
);
```

### Section 5 — Audio Settings UI (`src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`)

Add `opusBitrate: number` to the `AudioSettings` interface and `DEFAULT_SETTINGS`.

Add an **Encoding** section to the audio settings tab with a **Bitrate** dropdown:

| Label | Value |
|---|---|
| 24 kbps | 24000 |
| 40 kbps | 40000 |
| 56 kbps | 56000 |
| 72 kbps (default) | 72000 |
| 96 kbps | 96000 |
| 128 kbps | 128000 |

### Section 6 — AudioManager (`src/Brmble.Client/Services/Voice/AudioManager.cs`)

Pass `OpusBitrate` from settings to `EncodePipeline` constructor. Recreate the pipeline when bitrate setting changes (same pattern as other settings changes).

## Files Changed

| File | Change |
|---|---|
| `lib/MumbleVoiceEngine/Codec/OpusNative.cs` | Add `SetVbrRequest`, `GetVbrRequest` to `Ctl` enum |
| `lib/MumbleVoiceEngine/Codec/OpusEncoder.cs` | Accept `Application` in constructor; add `Vbr` property |
| `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs` | Auto-select application mode; set CBR |
| `src/Brmble.Client/Services/AppConfig/AppSettings.cs` | Add `OpusBitrate` to `AudioSettings` |
| `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` | Add bitrate dropdown |

## Out of Scope

- Complexity setting (Mumble does not set it)
- Signal type (Mumble does not set it)
- WASAPI capture migration (separate issue)
- Server `MaxBandwidth` enforcement (separate issue)
- FEC packet-loss tuning (separate issue)
