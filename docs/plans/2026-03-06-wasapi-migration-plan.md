# WASAPI Audio Capture Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace WaveInEvent with WASAPI for microphone capture and add device selection support

**Architecture:** Replace WaveInEvent with WasapiCapture from NAudio.CoreAudioApi. Add device enumeration using MMDeviceEnumerator. Maintain same audio processing pipeline (AGC, volume, speech enhancement).

**Tech Stack:** C#, NAudio.CoreAudioApi, React/TypeScript frontend

---

## Task 1: Add NAudio.CoreAudioApi package

**Files:**
- Modify: `src/Brmble.Client/Brmble.Client.csproj`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Add NAudio.CoreAudioApi package reference**

```xml
<PackageReference Include="NAudio.CoreAudioApi" Version="2.1.0" />
```

Add to `src/Brmble.Client/Brmble.Client.csproj` alongside existing NAudio.WinMM reference.

**Step 2: Commit**

```bash
git add src/Brmble.Client/Brmble.Client.csproj
git commit -m "feat: add NAudio.CoreAudioApi package for WASAPI"
```

---

## Task 2: Replace WaveInEvent with WasapiCapture

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:310-330`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:136`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:387-466`

**Step 1: Change the field type**

In AudioManager.cs, change line 136:
```csharp
// FROM:
private WaveInEvent? _waveIn;

// TO:
private WasapiCapture? _waveIn;
```

**Step 2: Update StartMic to create WasapiCapture**

Replace lines 314-325 (StartMic method):
```csharp
if (_waveIn == null)
{
    _waveIn = new WasapiCapture
    {
        ShareMode = AudioClientShareMode.Shared
    };
    _waveIn.DataAvailable += OnMicData;
    _waveIn.RecordingStopped += (s, e) =>
    {
        if (e.Exception != null)
        {
            AudioLog.Write($"[Audio] WASAPI recording stopped with error: {e.Exception.Message}");
        }
    };
}

_waveIn.StartRecording();
```

**Step 3: Add float to int16 conversion in OnMicData**

Replace the OnMicData signature and add conversion at the start:

```csharp
private void OnMicData(object? sender, WaveInEventArgs e)
{
    // WasapiCapture returns float samples - convert to int16 for existing pipeline
    var buffer = e.Buffer;
    var bytesRecorded = e.BytesRecorded;
    
    // If float format (WasapiCapture), convert to int16
    if (_waveIn is WasapiCapture wasapi && wasapi.WaveFormat.Encoding == WaveFormatEncoding.IeeeFloat)
    {
        var floatBuffer = new float[bytesRecorded / 4];
        Buffer.BlockCopy(buffer, 0, floatBuffer, 0, bytesRecorded);
        
        // Convert float [-1, 1] to int16
        var int16Buffer = new byte[bytesRecorded];
        for (int i = 0; i < floatBuffer.Length; i++)
        {
            var sample = (short)Math.Clamp(floatBuffer[i] * 32768f, short.MinValue, short.MaxValue);
            int16Buffer[i * 2] = (byte)(sample & 0xFF);
            int16Buffer[i * 2 + 1] = (byte)((sample >> 8) & 0xFF);
        }
        buffer = int16Buffer;
        bytesRecorded = int16Buffer.Length;
    }
    
    // Rest of existing OnMicData logic...
    if (_muted) return;
    // ... (existing code from line 389 onwards)
}
```

**Step 4: Update StopMic to use WasapiCapture.StopRecording**

The existing StopMic should work, but verify it calls StopRecording() which works for both.

**Step 5: Run client build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: migrate WaveInEvent to WasapiCapture"
```

---

## Task 3: Add device enumeration methods

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`
- Modify: `src/Brmble.Client/Bridge/VoiceService.cs` (or similar bridge file)

**Step 1: Add device enumeration to AudioManager**

Add new methods to AudioManager.cs:

```csharp
/// <summary>
/// Gets list of available audio input devices.
/// </summary>
public static IReadOnlyList<AudioDeviceInfo> GetInputDevices()
{
    var devices = new List<AudioDeviceInfo>();
    try
    {
        using var enumerator = new MMDeviceEnumerator();
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            devices.Add(new AudioDeviceInfo(device.ID, device.FriendlyName));
        }
    }
    catch (Exception ex)
    {
        AudioLog.Write($"[Audio] Failed to enumerate input devices: {ex.Message}");
    }
    return devices;
}

/// <summary>
/// Gets list of available audio output devices.
/// </summary>
public static IReadOnlyList<AudioDeviceInfo> GetOutputDevices()
{
    var devices = new List<AudioDeviceInfo>();
    try
    {
        using var enumerator = new MMDeviceEnumerator();
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
        {
            devices.Add(new AudioDeviceInfo(device.ID, device.FriendlyName));
        }
    }
    catch (Exception ex)
    {
        AudioLog.Write($"[Audio] Failed to enumerate output devices: {ex.Message}");
    }
    return devices;
}
```

Add the record type at the top of the file (or in a separate file):
```csharp
public record AudioDeviceInfo(string Id, string Name);
```

**Step 2: Add SetInputDevice method**

Add to AudioManager.cs:
```csharp
private string? _selectedInputDeviceId;

public void SetInputDevice(string? deviceId)
{
    _selectedInputDeviceId = deviceId;
    // If mic is running, restart with new device
    if (_micStarted)
    {
        StopMic();
        StartMic();
    }
}
```

**Step 3: Update StartMic to use selected device**

Modify StartMic to create WasapiCapture with specific device:

```csharp
if (_waveIn == null)
{
    WasapiCapture capture;
    if (!string.IsNullOrEmpty(_selectedInputDeviceId))
    {
        using var enumerator = new MMDeviceEnumerator();
        var device = enumerator.GetDevice(_selectedInputDeviceId);
        capture = new WasapiCapture(device);
    }
    else
    {
        capture = new WasapiCapture();
    }
    
    capture.ShareMode = AudioClientShareMode.Shared;
    capture.DataAvailable += OnMicData;
    _waveIn = capture;
}
```

**Step 4: Expose device list via bridge**

Find where voice settings are communicated to frontend (check Bridge directory). Add method to return device list:

```csharp
// In the appropriate service/bridge class
public IEnumerable<AudioDeviceInfo> GetAudioInputDevices() => AudioManager.GetInputDevices();
public IEnumerable<AudioDeviceInfo> GetAudioOutputDevices() => AudioManager.GetOutputDevices();
```

**Step 5: Build and verify**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
# Add any bridge files modified
git commit -m "feat: add WASAPI device enumeration"
```

---

## Task 4: Connect frontend device dropdown to backend

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/bridge.ts`

**Step 1: Add bridge method to get devices**

In `src/Brmble.Web/src/bridge.ts`, add:

```typescript
getAudioInputDevices(): Promise<Array<{ id: string; name: string }>> {
  return this.invoke('voice.getAudioInputDevices');
}

getAudioOutputDevices(): Promise<Array<{ id: string; name: string }>> {
  return this.invoke('voice.getAudioOutputDevices');
}

setInputDevice(deviceId: string): Promise<void> {
  return this.invoke('voice.setInputDevice', deviceId);
}

setOutputDevice(deviceId: string): Promise<void> {
  return this.invoke('voice.setOutputDevice', deviceId);
}
```

**Step 2: Update AudioSettingsTab to load devices**

In `AudioSettingsTab.tsx`, add state and effect to load devices:

```typescript
const [inputDevices, setInputDevices] = useState<Array<{ id: string; name: string }>>([]);
const [outputDevices, setOutputDevices] = useState<Array<{ id: string; name: string }>>([]);

useEffect(() => {
  bridge.getAudioInputDevices().then(setInputDevices);
  bridge.getAudioOutputDevices().then(setOutputDevices);
}, []);
```

**Step 3: Update the dropdown options**

Replace the select in AudioSettingsTab:

```typescript
<select
  className="brmble-input"
  value={localSettings.inputDevice}
  onChange={(e) => {
    handleChange('inputDevice', e.target.value);
    bridge.setInputDevice(e.target.value);
  }}
>
  <option value="default">Default</option>
  {inputDevices.map(device => (
    <option key={device.id} value={device.id}>{device.name}</option>
  ))}
</select>
```

**Step 4: Same for output device**

Apply similar changes to output device dropdown.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/bridge.ts src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat: connect device selection UI to WASAPI backend"
```

---

## Task 5: Test end-to-end

**Step 1: Build and run the application**

```bash
# Build client
dotnet build src/Brmble.Client/Brmble.Client.csproj

# Build web
cd src/Brmble.Web && npm run build

# Run client
dotnet run --project src/Brmble.Client
```

**Step 2: Verify functionality**

1. Open settings - verify device dropdowns are populated
2. Select different input device - verify mic still works
3. Test voice transmission with different transmission modes
4. Verify AGC and volume still work correctly

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address test issues"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add NAudio.CoreAudioApi package |
| 2 | Replace WaveInEvent with WasapiCapture |
| 3 | Add device enumeration methods |
| 4 | Connect frontend device dropdown to backend |
| 5 | Test end-to-end |
