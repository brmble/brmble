# Voice Engine Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire MumbleVoiceEngine's encode/decode pipelines and NAudio audio I/O into the Brmble client so users can send and receive voice.

**Architecture:** New `AudioManager` class owned by `MumbleAdapter` handles all NAudio + pipeline lifecycle. MumbleAdapter overrides `EncodedVoice` to forward packets to AudioManager, and wires AudioManager's `SendVoicePacket` event to `Connection.SendVoice()`. Speaking detection uses timeout-based per-user tracking.

**Tech Stack:** MumbleVoiceEngine (EncodePipeline, UserAudioPipeline), NAudio.WinMM (WaveInEvent, WaveOutEvent), MumbleSharp (BasicMumbleProtocol)

**Reference implementation:** `C:\dev\brmble\dot-net-test\MumbleSpikeTest\` — working test program with identical voice pipeline logic.

---

### Task 1: Create AudioManager class

**Files:**
- Create: `src/Brmble.Client/Services/Voice/AudioManager.cs`

AudioManager handles mic capture, speaker playback, mute/deafen state, and speaking detection. It does NOT know about MumbleSharp or the bridge — it communicates via events.

**Step 1: Create AudioManager.cs**

```csharp
using System.Diagnostics;
using MumbleVoiceEngine.Pipeline;
using NAudio.Wave;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Manages audio I/O: mic capture via EncodePipeline, per-user speaker
/// playback via UserAudioPipeline, mute/deafen state, and speaking detection.
/// </summary>
internal sealed class AudioManager : IDisposable
{
    private readonly object _lock = new();

    // Encode (mic → network)
    private EncodePipeline? _encodePipeline;
    private WaveInEvent? _waveIn;
    private bool _micStarted;

    // Decode (network → speakers)
    private readonly Dictionary<uint, UserAudioPipeline> _pipelines = new();
    private readonly Dictionary<uint, WaveOutEvent> _players = new();

    // State
    private bool _muted;
    private bool _deafened;

    // Speaking detection
    private readonly Dictionary<uint, DateTime> _lastVoicePacket = new();
    private readonly Timer _speakingTimer;
    private const int SpeakingTimeoutMs = 200;

    /// <summary>Fired when an encoded voice packet is ready to send to the server.</summary>
    public event Action<ReadOnlyMemory<byte>>? SendVoicePacket;

    /// <summary>Fired when a user starts speaking (first voice packet after silence).</summary>
    public event Action<uint>? UserStartedSpeaking;

    /// <summary>Fired when a user stops speaking (no packets for SpeakingTimeoutMs).</summary>
    public event Action<uint>? UserStoppedSpeaking;

    public bool IsMuted => _muted;
    public bool IsDeafened => _deafened;

    public AudioManager()
    {
        _speakingTimer = new Timer(CheckSpeakingState, null, 100, 100);
    }

    /// <summary>Start mic capture and encoding. No-op if already started or muted.</summary>
    public void StartMic()
    {
        if (_micStarted || _muted) return;

        _encodePipeline ??= new EncodePipeline(
            sampleRate: 48000, channels: 1, bitrate: 72000,
            onPacketReady: packet => SendVoicePacket?.Invoke(packet));

        if (_waveIn == null)
        {
            _waveIn = new WaveInEvent
            {
                DeviceNumber = -1,
                BufferMilliseconds = 20,
                WaveFormat = new WaveFormat(48000, 16, 1)
            };
            _waveIn.DataAvailable += OnMicData;
        }

        _waveIn.StartRecording();
        _micStarted = true;
        Debug.WriteLine("[Audio] Mic started");
    }

    /// <summary>Stop mic capture. No-op if not started.</summary>
    public void StopMic()
    {
        if (!_micStarted) return;

        _waveIn?.StopRecording();
        _micStarted = false;
        Debug.WriteLine("[Audio] Mic stopped");
    }

    private void OnMicData(object? sender, WaveInEventArgs e)
    {
        if (_muted) return;
        _encodePipeline?.SubmitPcm(new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded));
    }

    /// <summary>
    /// Feed an incoming voice packet for a user. Decodes Opus and queues PCM
    /// for speaker playback. Creates per-user pipeline lazily.
    /// Called from MumbleSharp process thread.
    /// </summary>
    public void FeedVoice(uint userId, byte[] opusData, long sequence)
    {
        if (_deafened) return;

        lock (_lock)
        {
            if (!_pipelines.TryGetValue(userId, out var pipeline))
            {
                pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
                _pipelines[userId] = pipeline;

                var player = new WaveOutEvent
                {
                    DesiredLatency = 80,
                    NumberOfBuffers = 4
                };
                player.Init(pipeline);
                player.Play();
                _players[userId] = player;

                Debug.WriteLine($"[Audio] Playback started for user {userId}");
            }

            pipeline.FeedEncodedPacket(opusData, sequence);

            // Speaking detection: fire event on first packet after silence
            var now = DateTime.UtcNow;
            if (!_lastVoicePacket.ContainsKey(userId))
                UserStartedSpeaking?.Invoke(userId);
            _lastVoicePacket[userId] = now;
        }
    }

    /// <summary>Clean up a user's audio pipeline when they disconnect.</summary>
    public void RemoveUser(uint userId)
    {
        lock (_lock)
        {
            if (_players.Remove(userId, out var player))
            {
                player.Stop();
                player.Dispose();
            }
            if (_pipelines.Remove(userId, out var pipeline))
                pipeline.Dispose();
            if (_lastVoicePacket.Remove(userId))
                UserStoppedSpeaking?.Invoke(userId);
        }
    }

    /// <summary>Set mute state. Stops/starts mic capture accordingly.</summary>
    public void SetMuted(bool muted)
    {
        _muted = muted;
        if (muted)
            StopMic();
        else
            StartMic();
    }

    /// <summary>Set deafen state. Stops all playback when deafened.</summary>
    public void SetDeafened(bool deafened)
    {
        _deafened = deafened;
        if (deafened)
        {
            lock (_lock)
            {
                foreach (var player in _players.Values)
                {
                    player.Stop();
                    player.Dispose();
                }
                foreach (var pipeline in _pipelines.Values)
                    pipeline.Dispose();
                _players.Clear();
                _pipelines.Clear();

                // Fire stopped speaking for all tracked users
                foreach (var userId in _lastVoicePacket.Keys)
                    UserStoppedSpeaking?.Invoke(userId);
                _lastVoicePacket.Clear();
            }
        }
    }

    private void CheckSpeakingState(object? state)
    {
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            var stopped = new List<uint>();
            foreach (var (userId, lastPacket) in _lastVoicePacket)
            {
                if ((now - lastPacket).TotalMilliseconds > SpeakingTimeoutMs)
                    stopped.Add(userId);
            }
            foreach (var userId in stopped)
            {
                _lastVoicePacket.Remove(userId);
                UserStoppedSpeaking?.Invoke(userId);
            }
        }
    }

    public void Dispose()
    {
        _speakingTimer.Dispose();
        StopMic();
        _waveIn?.Dispose();
        _waveIn = null;
        _encodePipeline?.Dispose();
        _encodePipeline = null;

        lock (_lock)
        {
            foreach (var player in _players.Values)
            {
                player.Stop();
                player.Dispose();
            }
            foreach (var pipeline in _pipelines.Values)
                pipeline.Dispose();
            _players.Clear();
            _pipelines.Clear();
            _lastVoicePacket.Clear();
        }
    }
}
```

**Step 2: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: add AudioManager for voice pipeline lifecycle"
```

---

### Task 2: Wire AudioManager into MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

Wire AudioManager into MumbleAdapter: override `EncodedVoice`, create/dispose AudioManager on connect/disconnect, route voice packets both directions.

**Step 1: Add AudioManager field and using**

Add to the top of `MumbleAdapter.cs` (after existing usings, line 9):

```csharp
using MumbleVoiceEngine.Pipeline;
```

Add field after `_processTask` (line 24):

```csharp
    private AudioManager? _audioManager;
```

**Step 2: Override EncodedVoice**

Add after the `Reject` override (after line 444):

```csharp
    /// <summary>
    /// Called when voice data is received from another user.
    /// Forwards to AudioManager for decoding and playback.
    /// </summary>
    public override void EncodedVoice(byte[] data, uint userId, long sequence,
        IVoiceCodec codec, SpeechTarget target)
    {
        // DON'T call base — we use our own decode pipeline instead of
        // MumbleSharp's AudioDecodingBuffer (fixed 350ms buffer, poor quality)
        _audioManager?.FeedVoice(userId, data, sequence);
    }
```

**Step 3: Create AudioManager in ServerSync, start mic**

In `ServerSync` method (line 295), after the existing `_bridge?.Send("voice.connected", ...)` call (after line 321), add:

```csharp
        // Start audio after connection is established
        _audioManager?.Dispose();
        _audioManager = new AudioManager();
        _audioManager.SendVoicePacket += packet =>
        {
            Connection?.SendVoice(new ArraySegment<byte>(packet.ToArray()));
        };
        _audioManager.UserStartedSpeaking += userId =>
        {
            _bridge?.Send("voice.userSpeaking", new { session = userId });
        };
        _audioManager.UserStoppedSpeaking += userId =>
        {
            _bridge?.Send("voice.userSilent", new { session = userId });
        };
        _audioManager.StartMic();
        Debug.WriteLine("[Mumble] AudioManager started");
```

**Step 4: Dispose AudioManager in Disconnect**

In `Disconnect` method (line 126), add before the Connection?.Close() call (before line 130):

```csharp
        _audioManager?.Dispose();
        _audioManager = null;
```

**Step 5: Clean up user audio in UserRemove**

In `UserRemove` method (line 386), add after `base.UserRemove(userRemove)` (after line 388):

```csharp
        _audioManager?.RemoveUser(userRemove.Session);
```

**Step 6: Wire ToggleMute to AudioManager**

In `ToggleMute` method (line 200), add after `LocalUser.SendMuteDeaf()` (after line 209):

```csharp
        _audioManager?.SetMuted(LocalUser.SelfMuted);
```

**Step 7: Wire ToggleDeaf to AudioManager**

In `ToggleDeaf` method (line 217), add after `LocalUser.SendMuteDeaf()` (after line 224):

```csharp
        _audioManager?.SetDeafened(LocalUser.SelfDeaf);
        _audioManager?.SetMuted(LocalUser.SelfMuted);
```

**Step 8: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 9: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: wire AudioManager into MumbleAdapter for voice send/receive"
```

---

### Task 3: Tighten process loop for voice latency

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

The current `ProcessLoop` uses `Task.Delay(10)` which adds 10ms latency per cycle. For voice, we need ~1ms. Also, it only calls `Process()` when `Connected`, but MumbleSharp needs processing during `Connecting` state too (TLS handshake, auth).

**Step 1: Replace Task-based ProcessLoop with Thread-based**

Replace the `_processTask` field (line 24) with:

```csharp
    private Thread? _processThread;
```

Replace the ProcessLoop launch in `Connect` (line 96):

```csharp
            _cts = new CancellationTokenSource();
            _processThread = new Thread(() => ProcessLoop(_cts.Token))
            {
                IsBackground = true,
                Name = "MumbleProcess"
            };
            _processThread.Start();
```

Replace the entire `ProcessLoop` method (lines 150-174) with:

```csharp
    /// <summary>
    /// Processes incoming Mumble protocol messages on a dedicated thread.
    /// Uses Thread.Sleep(1)/Yield for low-latency voice packet processing.
    /// </summary>
    private void ProcessLoop(CancellationToken ct)
    {
        Debug.WriteLine("[Mumble] ProcessLoop started");
        while (!ct.IsCancellationRequested && Connection != null
               && Connection.State != ConnectionStates.Disconnected)
        {
            try
            {
                if (Connection.Process())
                    Thread.Yield();
                else
                    Thread.Sleep(1);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Debug.WriteLine($"[Mumble] Process error: {ex}");
                _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
            }
        }
        Debug.WriteLine("[Mumble] ProcessLoop ended");
    }
```

**Step 2: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "fix: tighten process loop from 10ms to 1ms for voice latency"
```

---

### Task 4: Run tests and verify

**Step 1: Run existing MumbleVoiceEngine tests**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj -v normal`
Expected: All tests pass (these test the underlying pipeline and codec)

**Step 2: Build entire solution**

Run: `dotnet build`
Expected: Build succeeded with no errors

**Step 3: Commit (if any fixups needed)**

---

### Summary of changes

| File | Change |
|------|--------|
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | **New** — mic capture, speaker playback, mute/deafen, speaking detection |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Override `EncodedVoice`, create/dispose AudioManager, wire mute/deafen/speaking, tighten process loop |

### New bridge messages

| Message | Direction | Data | When |
|---------|-----------|------|------|
| `voice.userSpeaking` | Backend → Frontend | `{ session: uint }` | First voice packet from user after silence |
| `voice.userSilent` | Backend → Frontend | `{ session: uint }` | No voice packets from user for 200ms |

### Audio parameters (matching test program)

| Parameter | Value |
|-----------|-------|
| Sample rate | 48000 Hz |
| Bit depth | 16-bit |
| Channels | 1 (mono) |
| Opus bitrate | 72000 bps |
| WaveIn buffer | 20ms |
| WaveOut latency | 80ms (4 × 20ms) |
| Speaking timeout | 200ms |
