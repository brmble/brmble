# Jitter Buffer and Output Delay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add jitter buffer and output delay sliders to Audio Settings tab, persisting to backend and applying to audio pipeline.

**Architecture:** 
- Frontend: Add two sliders to AudioSettingsTab.tsx
- Settings: Add fields to TypeScript AudioSettings interface and C# AudioSettings record
- Backend: Apply settings to UserAudioPipeline (jitter) and WaveOutEvent (output delay)

**Tech Stack:** React/TypeScript frontend, C# NAudio backend, existing bridge messaging

---

## Task 1: Add Settings Fields to TypeScript

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:17-27`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:34-42`

**Step 1: Add fields to AudioSettings interface**

```typescript
export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  maxAmplification: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  jitterBuffer: number;   // 10-60ms, default 20
  outputDelay: number;    // 10-100ms, default 50
}
```

**Step 2: Add default values to DEFAULT_SETTINGS**

```typescript
export const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 250,
  outputVolume: 250,
  maxAmplification: 100,
  transmissionMode: 'pushToTalk',
  pushToTalkKey: null,
  jitterBuffer: 20,
  outputDelay: 50,
};
```

**Step 3: Run build to verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat: add jitterBuffer and outputDelay to AudioSettings interface"
```

---

## Task 2: Add UI Sliders to Audio Settings Tab

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:173-199`

**Step 1: Add sliders in Output section**

After the Output Volume slider (around line 198), add:

```tsx
        <div className="settings-item settings-slider">
          <label>Jitter Buffer: {localSettings.jitterBuffer}ms</label>
          <span className="settings-hint">Lower reduces latency</span>
          <input
            type="range"
            min="10"
            max="60"
            value={localSettings.jitterBuffer}
            onChange={(e) => handleChange('jitterBuffer', parseInt(e.target.value, 10))}
          />
        </div>

        <div className="settings-item settings-slider">
          <label>Output Delay: {localSettings.outputDelay}ms</label>
          <span className="settings-hint">Lower reduces latency</span>
          <input
            type="range"
            min="10"
            max="100"
            value={localSettings.outputDelay}
            onChange={(e) => handleChange('outputDelay', parseInt(e.target.value, 10))}
          />
        </div>
```

**Step 2: Run build to verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat: add jitter buffer and output delay sliders to Audio Settings"
```

---

## Task 3: Add Settings Fields to C# Backend

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:3-11`

**Step 1: Add fields to AudioSettings record**

```csharp
public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int MaxAmplification = 100,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null,
    int JitterBuffer = 20,
    int OutputDelay = 50
);
```

**Step 2: Run build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat: add JitterBuffer and OutputDelay to C# AudioSettings"
```

---

## Task 4: Apply Output Delay to WaveOutEvent

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:513-517`

**Step 1: Add SetOutputDelay method to AudioManager**

Add after line ~180 (near other Set* methods):

```csharp
public void SetOutputDelay(int delayMs)
{
    _outputDelayMs = Math.Clamp(delayMs, 10, 100);
    // Update existing players
    foreach (var player in _players.Values)
    {
        player.DesiredLatency = _outputDelayMs;
    }
}

private int _outputDelayMs = 50;
```

**Step 2: Update WaveOutEvent creation to use _outputDelayMs**

Change line 515 from:
```csharp
DesiredLatency = 80,
```
to:
```csharp
DesiredLatency = _outputDelayMs,
```

**Step 3: Run build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: add SetOutputDelay method to AudioManager"
```

---

## Task 5: Apply Jitter Buffer to UserAudioPipeline

**Files:**
- Modify: `lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs`

**Step 1: Add jitter buffer delay logic**

Add fields after line ~25:
```csharp
private readonly object _lock = new();
private float _volume = 1.0f;
private int _jitterBufferMs = 20;
```

Add method after Volume property:
```csharp
public int JitterBufferMs
{
    get => _jitterBufferMs;
    set => _jitterBufferMs = Math.Clamp(value, 10, 60);
}
```

Modify FeedEncodedPacket to track enqueue time:
```csharp
// Change _pcmQueue from Queue<byte[]> to Queue<(byte[] data, DateTime enqueuedAt)>
private readonly Queue<(byte[] data, DateTime enqueuedAt)> _pcmQueue = new();

public void FeedEncodedPacket(byte[] opusData, long sequence)
{
    var samples = OpusDecoder.GetSamples(opusData, 0, opusData.Length, _sampleRate);
    if (samples <= 0) return;

    var decoded = new byte[samples * _bytesPerSample];
    _decoder.Decode(opusData, 0, opusData.Length, decoded, 0);

    lock (_lock)
    {
        _pcmQueue.Enqueue((decoded, DateTime.UtcNow));
    }
}
```

Modify Read to wait for jitter delay:
```csharp
// In the while loop, change TryDequeue to check timestamp
while (written < count)
{
    if (!_pcmQueue.TryPeek(out var queued))
    {
        // No data - fill with silence
        Array.Clear(buffer, offset + written, count - written);
        written = count;
        break;
    }

    // Check if frame has been in queue long enough
    var elapsed = (DateTime.UtcNow - queued.enqueuedAt).TotalMilliseconds;
    if (elapsed < _jitterBufferMs)
    {
        // Not enough time elapsed - return silence for now
        // This will cause Read to be called again shortly
        Array.Clear(buffer, offset + written, count - written);
        written = count;
        break;
    }

    // Dequeue and process
    _pcmQueue.TryDequeue(out var frame);
    // ... rest of frame processing
}
```

**Step 2: Run build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: BUILD SUCCEEDED (lib is compiled as part of Client)

**Step 3: Commit**

```bash
git add lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs
git commit -m "feat: add jitter buffer delay to UserAudioPipeline"
```

---

## Task 6: Wire Up Settings in MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:565-583`

**Step 1: Add SetJitterBuffer and SetOutputDelay methods to AudioManager**

In AudioManager.cs, add after SetOutputVolume:
```csharp
public void SetJitterBuffer(int jitterMs)
{
    lock (_lock)
    {
        foreach (var pipeline in _pipelines.Values)
        {
            pipeline.JitterBufferMs = jitterMs;
        }
    }
}
```

**Step 2: Call these methods in ApplySettings**

In MumbleAdapter.cs ApplySettings method, add:
```csharp
_audioManager?.SetJitterBuffer(settings.Audio.JitterBuffer);
_audioManager?.SetOutputDelay(settings.Audio.OutputDelay);
```

**Step 3: Run build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: wire up jitter buffer and output delay settings"
```

---

## Task 7: Handle New Users with Current Settings

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Pass jitter buffer to new UserAudioPipeline**

In AudioManager.cs where UserAudioPipeline is created (~line 509), use the stored jitter buffer value:
```csharp
pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
pipeline.JitterBufferMs = _jitterBufferMs;
pipeline.Volume = userVolume;
```

**Step 2: Run build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: apply current jitter buffer to new audio pipelines"
```

---

## Task 8: Full Integration Test

**Step 1: Build everything**

Run: `dotnet build`
Expected: BUILD SUCCEEDED

**Step 2: Run frontend build**

Run: `cd src/Brmble.Web && npm run build`
Expected: BUILD SUCCEEDED

**Step 3: Commit final changes**

```bash
git add .
git commit -m "feat: add jitter buffer and output delay settings to audio"
```

---

## Summary of Files Modified

| File | Changes |
|------|---------|
| `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` | Interface, defaults, sliders |
| `src/Brmble.Client/Services/AppConfig/AppSettings.cs` | Record fields |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | SetOutputDelay, SetJitterBuffer, apply to new pipelines |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | ApplySettings calls |
| `lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs` | Jitter delay logic |
