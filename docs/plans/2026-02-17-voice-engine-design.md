# Voice Engine Integration Design

Integrate MumbleVoiceEngine (encode/decode pipelines, NAudio audio I/O) into the Brmble client so that users can send and receive voice.

## Current State

MumbleAdapter handles protocol + bridge but has no audio. The voice engine exists as a working implementation in the test program (`dot-net-test/MumbleSpikeTest`), using `EncodePipeline`, `UserAudioPipeline`, and NAudio `WaveInEvent`/`WaveOutEvent`.

## Architecture

```
MumbleAdapter (protocol + bridge)
  │
  ├── owns AudioManager (voice pipeline lifecycle)
  │     ├── EncodePipeline (mic PCM → Opus → voice packet)
  │     ├── WaveInEvent (mic capture, 48kHz/16-bit/mono, 20ms buffers)
  │     ├── Per-user playback:
  │     │   ├── UserAudioPipeline (Opus decode → PCM queue)
  │     │   └── WaveOutEvent (speaker, 80ms latency, 4 buffers)
  │     └── Speaking detection (timeout-based per-user)
  │
  └── EncodedVoice() override → AudioManager.FeedVoice()
      SendVoicePacket event ← AudioManager → MumbleAdapter → Connection.SendVoice()
```

### AudioManager

New class: `Services/Voice/AudioManager.cs`

Responsibilities:
- **Mic capture:** `WaveInEvent` → `EncodePipeline.SubmitPcm()` → fires `SendVoicePacket` event with encoded packet
- **Speaker playback:** `FeedVoice(userId, opusData, sequence)` → lazy-creates `UserAudioPipeline` + `WaveOutEvent` per user
- **Mute:** Stops mic recording, disposes encode pipeline. MumbleAdapter sends Mumble UserState.
- **Deafen:** Stops all playback (disposes all user pipelines/players) + mutes. MumbleAdapter sends Mumble UserState.
- **Cleanup:** `RemoveUser(userId)` disposes that user's pipeline + player
- **Speaking events:** Fires `UserStartedSpeaking(uint userId)` / `UserStoppedSpeaking(uint userId)` based on packet activity (~200ms silence timeout)

### MumbleAdapter Changes

- Override `EncodedVoice()` — **don't call base** — forward to `AudioManager.FeedVoice()`
- On `ServerSync`: create `AudioManager`, start mic (unmuted by default)
- On `Disconnect`: dispose `AudioManager`
- `ToggleMute()`: call `AudioManager.SetMuted()` + send Mumble `UserState` with self-mute
- `ToggleDeaf()`: call `AudioManager.SetDeafened()` + send Mumble `UserState` with self-deaf
- Wire `AudioManager` speaking events → bridge messages
- `UserRemove` override: call `AudioManager.RemoveUser(userId)`

## Bridge Messages

New messages:

| Direction | Message | Data |
|-----------|---------|------|
| Backend → Frontend | `voice.userSpeaking` | `{ session: uint }` |
| Backend → Frontend | `voice.userSilent` | `{ session: uint }` |

Existing mute/deafen messages unchanged.

## Data Flow

### Sending voice
```
NAudio WaveIn (audio thread) → DataAvailable
  → AudioManager.OnMicData()
  → EncodePipeline.SubmitPcm(pcm)
  → onPacketReady callback
  → SendVoicePacket event
  → MumbleAdapter: Connection.SendVoice(packet)
```

### Receiving voice
```
MumbleSharp process thread → EncodedVoice(data, userId, seq)
  → MumbleAdapter.EncodedVoice() [don't call base]
  → AudioManager.FeedVoice(userId, data, seq)
  → UserAudioPipeline.FeedEncodedPacket() (decode → queue)
  → NAudio WaveOut (audio thread) → pipeline.Read() pulls PCM
```

## Threading

| Thread | Operations |
|--------|-----------|
| MumbleSharp process thread | `EncodedVoice()` → `FeedVoice()` → Opus decode → queue |
| NAudio mic callback thread | `DataAvailable` → `SubmitPcm()` → Opus encode → `SendVoice()` |
| NAudio playback threads (per user) | `Read()` → dequeue PCM |
| UI thread | Bridge messages only (marshaled by NativeBridge) |

No new threads. Reuses NAudio audio threads and MumbleSharp process thread.

## Audio Parameters

| Parameter | Value |
|-----------|-------|
| Sample rate | 48000 Hz |
| Bit depth | 16-bit |
| Channels | 1 (mono) |
| Frame size | 960 samples (20ms) |
| Opus bitrate | 72000 bps |
| WaveIn buffer | 20ms |
| WaveOut latency | 80ms (4 × 20ms) |

## Default State

Mic starts capturing on connect (unmuted). Voice activation and push-to-talk are future work.

## Decisions

- AudioManager is a plain class owned by MumbleAdapter, not a separate IService
- Mute sends both stops mic + sends Mumble self-mute UserState (visible to other clients)
- Deafen stops all playback + implies mute
- Speaking indicators sent to frontend via bridge messages
- Refactoring MumbleVoiceEngine/MumbleSharp boundaries is acceptable if needed
