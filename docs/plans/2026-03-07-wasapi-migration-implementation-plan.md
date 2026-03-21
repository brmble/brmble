# WASAPI Audio Capture Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dev toggle in Settings > Voice to switch between WaveInEvent (legacy) and WASAPI for microphone capture.

**Architecture:** Hard toggle - no fallback. Backend uses selected capture API directly. Settings persisted in AudioSettings.

**Tech Stack:** C#, NAudio.CoreCoreApi, React/TypeScript

---

### Task 1: Add NAudio.CoreCoreApi package

**Files:**
- Modify: `src/Brmble.Client/Brmble.Client.csproj`

**Step 1: Add package reference**

Add after existing package references (line 10):
```xml
<PackageReference Include="NAudio.CoreCoreApi" Version="2.1.0" />
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Brmble.Client.csproj
git commit -m "feat: add NAudio.CoreCoreApi package for WASAPI"
```

---

### Task 2: Add CaptureApi to C# AudioSettings

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:3-11`

**Step 1: Add CaptureApi field**

Change line 10 from:
```csharp
string? PushToTalkKey = null
```

To:
```csharp
string? PushToTalkKey = null,
string CaptureApi = "waveIn"
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat: add CaptureApi setting for audio capture toggle"
```

---

### Task 3: Add SetCaptureApi method to AudioManager

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:130-140`

**Step 1: Add field and method**

Add after line 136 (after `_micStarted`):
```csharp
private string _captureApi = "waveIn";
```

Add new method after line 263 (after `ConfigureSpeechEnhancement`):
```csharp
public void SetCaptureApi(string api)
{
    _captureApi = api;
    AudioLog.Write($"[Audio] SetCaptureApi: {_captureApi}");
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: add SetCaptureApi method to AudioManager"
```

---

### Task 4: Implement WASAPI capture in StartMic

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:304-329`

**Step 1: Add using statement**

Add at top of file (after line 6):
```csharp
using NAudio.CoreCoreApi;
```

**Step 2: Replace StartMic implementation**

Replace lines 314-325 with:
```csharp
if (_waveIn == null)
{
    if (_captureApi == "wasapi")
    {
        _waveIn = new WasapiCapture
        {
            ShareMode = AudioClientShareMode.Shared
        };
        ((WasapiCapture)_waveIn).RecordingStopped += (s, e) =>
        {
            if (e.Exception != null)
            {
                AudioLog.Write($"[Audio] WASAPI recording stopped with error: {e.Exception.Message}");
            }
        };
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

_waveIn.StartRecording();
```

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: implement WASAPI capture in StartMic"
```

---

### Task 5: Handle float to int16 conversion in OnMicData

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:387-466`

**Step 1: Modify OnMicData for WASAPI float conversion**

Replace the beginning of OnMicData (lines 387-398) with:
```csharp
private void OnMicData(object? sender, WaveInEventArgs e)
{
    // WASAPI returns float32 samples - convert to int16 for existing pipeline
    byte[] processedBuffer = e.Buffer;
    if (_waveIn is WasapiCapture wasapi && wasapi.WaveFormat.Encoding == WaveFormatEncoding.IeeeFloat)
    {
        var floatBuffer = new float[e.BytesRecorded / 4];
        Buffer.BlockCopy(e.Buffer, 0, floatBuffer, 0, e.BytesRecorded);
        
        var int16Buffer = new byte[e.BytesRecorded];
        for (int i = 0; i < floatBuffer.Length; i++)
        {
            var sample = (short)Math.Clamp(floatBuffer[i] * 32768f, short.MinValue, short.MaxValue);
            int16Buffer[i * 2] = (byte)(sample & 0xFF);
            int16Buffer[i * 2 + 1] = (byte)((sample >> 8) & 0xFF);
        }
        processedBuffer = int16Buffer;
    }

    if (_muted) return;
    if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;

    // Apply AGC first (boost quiet audio, compress loud before user gain)
    if (_maxAmplification != 1.0f)
        ApplyAGC(processedBuffer, processedBuffer.Length);

    // Apply input volume (after AGC to avoid clipping on boost)
    if (_inputVolume != 1.0f)
        ApplyInputVolume(processedBuffer, processedBuffer.Length);
```

Then update the rest of the method to use `processedBuffer` instead of `e.Buffer`.

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: handle WASAPI float to int16 conversion in OnMicData"
```

---

### Task 6: Wire CaptureApi setting to AudioManager

**Files:**
- Modify: Find where AudioSettings are applied to AudioManager

**Step 1: Find where settings are applied**

Search for where AudioManager receives settings:
```bash
grep -r "AudioManager" --include="*.cs" | head -20
```

**Step 2: Add SetCaptureApi call**

Add call to `audioManager.SetCaptureApi(settings.Audio.CaptureApi)` where other AudioManager settings are configured.

**Step 3: Commit**

```bash
git add [affected file]
git commit -m "feat: wire CaptureApi setting to AudioManager"
```

---

### Task 7: Add CaptureApi to TypeScript AudioSettings

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:19-27`

**Step 1: Add captureApi to interface**

Change interface to:
```typescript
export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  maxAmplification: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  captureApi: 'waveIn' | 'wasapi';
}
```

**Step 2: Add default**

Update DEFAULT_SETTINGS:
```typescript
export const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 250,
  outputVolume: 250,
  maxAmplification: 100,
  transmissionMode: 'pushToTalk',
  pushToTalkKey: null,
  captureApi: 'waveIn',
};
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat: add captureApi to TypeScript AudioSettings"
```

---

### Task 8: Add dev toggle UI in AudioSettingsTab

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`

**Step 1: Add toggle handler**

Add to handleChange function (around line 58):
```typescript
const handleCaptureApiChange = (value: 'waveIn' | 'wasapi') => {
  handleChange('captureApi', value);
};
```

**Step 2: Add toggle UI**

Add at bottom of the settings form (before closing tag):
```tsx
{/* DEV: Audio Capture API Toggle */}
<div className="settings-section">
  <div className="settings-section-header">
    <span className="settings-dev-label">DEV</span>
    <span className="settings-section-title">Audio Capture API</span>
  </div>
  <div className="toggle-group">
    <button
      type="button"
      className={`toggle-btn ${localSettings.captureApi === 'waveIn' ? 'active' : ''}`}
      onClick={() => handleCaptureApiChange('waveIn')}
    >
      WaveIn (Legacy)
    </button>
    <button
      type="button"
      className={`toggle-btn ${localSettings.captureApi === 'wasapi' ? 'active' : ''}`}
      onClick={() => handleCaptureApiChange('wasapi')}
    >
      WASAPI
    </button>
  </div>
</div>
```

**Step 3: Add CSS for toggle**

Add to AudioSettingsTab.css:
```css
.settings-dev-label {
  background: var(--accent-danger);
  color: white;
  font-size: var(--text-2xs);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  margin-right: var(--space-sm);
  text-transform: uppercase;
}

.toggle-group {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}

.toggle-btn {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-fast);
}

.toggle-btn:hover {
  background: var(--bg-hover);
}

.toggle-btn.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: white;
}
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css
git commit -m "feat: add dev toggle UI for audio capture API"
```

---

### Task 9: Build and test

**Step 1: Build C#**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

**Step 2: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

**Step 3: Run tests**

```bash
dotnet test
```

---

## Plan Complete

Execute using subagent-driven-development skill.
