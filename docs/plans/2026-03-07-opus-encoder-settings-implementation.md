# Opus Encoder Settings Implementation Plan

**Goal:** Match Mumble's Opus encoder configuration — correct application mode per bitrate, CBR mode, and a user-configurable bitrate dropdown in the audio settings UI.

**Architecture:** Surgical CTL additions to `OpusNative.cs` and `OpusEncoder.cs`, application-mode selection logic in `EncodePipeline`, a new `OpusBitrate` field in `AppSettings`, and a bitrate dropdown in `AudioSettingsTab.tsx`. `AudioManager` reads bitrate from settings.

**Tech Stack:** C# (.NET), MSTest, React/TypeScript

---

### Task 1: Add VBR CTL codes to `OpusNative.cs`

**Files:**
- Modify: `lib/MumbleVoiceEngine/Codec/OpusNative.cs:106-112`
- Test: `tests/MumbleVoiceEngine.Tests/Codec/OpusCodecTest.cs`

**Step 1: Write a failing test for the Vbr property**

Add to `OpusCodecTest.cs`:

```csharp
[TestMethod]
public void Encoder_VbrProperty_CanBeSetToFalse()
{
    using var encoder = new OpusEncoder(48000, 1);
    encoder.Vbr = false;
    Assert.IsFalse(encoder.Vbr);
}

[TestMethod]
public void Encoder_VbrProperty_CanBeSetToTrue()
{
    using var encoder = new OpusEncoder(48000, 1);
    encoder.Vbr = true;
    Assert.IsTrue(encoder.Vbr);
}
```

**Step 2: Run to confirm failure**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Encoder_VbrProperty"
```

Expected: FAIL — `OpusEncoder` has no `Vbr` property.

**Step 3: Add CTL codes to the `Ctl` enum in `OpusNative.cs`**

In `lib/MumbleVoiceEngine/Codec/OpusNative.cs`, add to the `Ctl` enum after line 111:

```csharp
SetVbrRequest = 4006,
GetVbrRequest = 4007,
```

Full enum after change:
```csharp
public enum Ctl
{
    SetBitrateRequest = 4002,
    GetBitrateRequest = 4003,
    SetVbrRequest = 4006,
    GetVbrRequest = 4007,
    SetInbandFecRequest = 4012,
    GetInbandFecRequest = 4013
}
```

**Step 4: Add `Vbr` property to `OpusEncoder.cs`**

In `lib/MumbleVoiceEngine/Codec/OpusEncoder.cs`, add after the `EnableForwardErrorCorrection` property (after line 194):

```csharp
/// <summary>
/// Gets or sets whether Variable Bitrate encoding is enabled.
/// Set to false for CBR (Constant Bitrate), matching Mumble's behaviour.
/// </summary>
public bool Vbr
{
    get
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        int vbr;
        var ret = NativeMethods.opus_encoder_ctl_out(_encoder, NativeMethods.Ctl.GetVbrRequest, out vbr);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
        return vbr > 0;
    }
    set
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        var ret = NativeMethods.opus_encoder_ctl(_encoder, NativeMethods.Ctl.SetVbrRequest, Convert.ToInt32(value));
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
    }
}
```

**Step 5: Run tests to confirm pass**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Encoder_VbrProperty"
```

Expected: PASS

**Step 6: Commit**

```bash
git add lib/MumbleVoiceEngine/Codec/OpusNative.cs lib/MumbleVoiceEngine/Codec/OpusEncoder.cs tests/MumbleVoiceEngine.Tests/Codec/OpusCodecTest.cs
git commit -m "feat: add Vbr property to OpusEncoder with VBR CTL codes"
```

---

### Task 2: Accept `Application` in `OpusEncoder` constructor

**Files:**
- Modify: `lib/MumbleVoiceEngine/Codec/OpusEncoder.cs:60-77`
- Test: `tests/MumbleVoiceEngine.Tests/Codec/OpusCodecTest.cs`

**Step 1: Write a failing test**

Add to `OpusCodecTest.cs`:

```csharp
[TestMethod]
public void Encoder_AudioApplicationMode_CanCreateAndEncode()
{
    using var encoder = new OpusEncoder(48000, 1, MumbleVoiceEngine.Codec.Application.Audio)
    {
        Bitrate = 72000
    };
    var pcm = new byte[960 * 2];
    var encoded = new byte[4000];
    int len = encoder.Encode(pcm, 0, encoded, 0, 960);
    Assert.IsTrue(len > 0);
}
```

**Step 2: Run to confirm failure**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Encoder_AudioApplicationMode"
```

Expected: FAIL — constructor doesn't accept `Application` parameter.

**Step 3: Update `OpusEncoder` constructor to accept `Application`**

Change the constructor signature in `lib/MumbleVoiceEngine/Codec/OpusEncoder.cs` at line 60:

```csharp
public OpusEncoder(int srcSamplingRate, int srcChannelCount, Application application = Application.Voip)
```

Change line 72 from:
```csharp
var encoder = NativeMethods.opus_encoder_create(srcSamplingRate, srcChannelCount, (int)Application.Voip, out error);
```
to:
```csharp
var encoder = NativeMethods.opus_encoder_create(srcSamplingRate, srcChannelCount, (int)application, out error);
```

**Step 4: Run all Codec + Pipeline tests to confirm nothing broken**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj
```

Expected: All PASS (existing tests use the default `Application.Voip`, which is unchanged).

**Step 5: Commit**

```bash
git add lib/MumbleVoiceEngine/Codec/OpusEncoder.cs tests/MumbleVoiceEngine.Tests/Codec/OpusCodecTest.cs
git commit -m "feat: accept Application mode in OpusEncoder constructor"
```

---

### Task 3: Auto-select application mode and set CBR in `EncodePipeline`

**Files:**
- Modify: `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs:21-33`
- Test: `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs`

**Step 1: Write a failing test**

Add to `EncodePipelineTest.cs`:

```csharp
[TestMethod]
public void Pipeline_HighBitrate_UsesAudioApplicationMode()
{
    // At 72kbps (>= 32kbps), the pipeline should use Application.Audio.
    // We can't directly inspect the application mode, but we verify
    // the pipeline creates successfully and produces valid packets.
    var packets = new List<byte[]>();
    using var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: p => packets.Add(p.ToArray()));

    pipeline.SubmitPcm(new byte[960 * 2]);
    Assert.AreEqual(1, packets.Count);
}

[TestMethod]
public void Pipeline_LowBitrate_UsesVoipApplicationMode()
{
    // At 24kbps (< 32kbps), the pipeline should use Application.Voip.
    var packets = new List<byte[]>();
    using var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 24000,
        onPacketReady: p => packets.Add(p.ToArray()));

    pipeline.SubmitPcm(new byte[960 * 2]);
    Assert.AreEqual(1, packets.Count);
}
```

**Step 2: Run to confirm they currently pass (no logic change yet)**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Pipeline_HighBitrate|Pipeline_LowBitrate"
```

These will pass already. These are regression guards. Move to the implementation.

**Step 3: Update `EncodePipeline` constructor**

Replace the encoder construction block in `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs` lines 29-33:

```csharp
var application = bitrate >= 32000 ? Application.Audio : Application.Voip;
_encoder = new OpusEncoder(sampleRate, channels, application)
{
    Bitrate = bitrate,
    EnableForwardErrorCorrection = true,
    Vbr = false  // CBR, matching Mumble behaviour
};
```

Add the missing using at top of file if not already present:
```csharp
using MumbleVoiceEngine.Codec;
```

**Step 4: Run all pipeline and codec tests**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs
git commit -m "feat: auto-select Opus application mode by bitrate, set CBR"
```

---

### Task 4: Add `OpusBitrate` to `AppSettings`

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`
- Test: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

**Step 1: Check the existing AppConfig test to understand the test pattern**

Read `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs` to understand how settings are tested.

**Step 2: Add `OpusBitrate` to `AudioSettings` record**

In `src/Brmble.Client/Services/AppConfig/AppSettings.cs`, change:

```csharp
public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int MaxAmplification = 100,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null
);
```

to:

```csharp
public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int MaxAmplification = 100,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null,
    int OpusBitrate = 72000
);
```

**Step 3: Build to verify no compile errors**

```
dotnet build
```

Expected: Build succeeds. The new parameter has a default so no call sites break.

**Step 4: Run client tests**

```
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat: add OpusBitrate to AudioSettings with default 72000"
```

---

### Task 5: Wire `OpusBitrate` through `AudioManager`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:310-312`

**Step 1: Find where `AudioSettings` is consumed in `AudioManager`**

The `_encodePipeline` is created at line 310:
```csharp
_encodePipeline ??= new EncodePipeline(
    sampleRate: 48000, channels: 1, bitrate: 72000,
    onPacketReady: packet => SendVoicePacket?.Invoke(packet));
```

**Step 2: Understand how settings reach `AudioManager`**

Search for how `AudioManager` receives settings — look for a field or constructor parameter that holds `AudioSettings`. Read around line 127-200 of `AudioManager.cs` to find the settings field name.

**Step 3: Replace hardcoded 72000 with settings value**

Find the field that holds `AudioSettings` (likely `_settings` or similar). Replace line 311:

```csharp
_encodePipeline ??= new EncodePipeline(
    sampleRate: 48000, channels: 1, bitrate: _audioSettings.OpusBitrate,
    onPacketReady: packet => SendVoicePacket?.Invoke(packet));
```

> **Note:** Use the actual field name found in Step 2. If `AudioManager` doesn't currently hold an `AudioSettings` reference, check how other settings (e.g. `_maxAmplification`) are set — they're likely set via a public `Apply(AudioSettings)` method or constructor.

**Step 4: Handle bitrate changes — recreate pipeline**

Find the method that applies new settings (search for `Apply` or where `_maxAmplification` is set). When `OpusBitrate` changes, the pipeline must be recreated because Opus application mode is set at construction time. Add:

```csharp
if (_audioSettings.OpusBitrate != newSettings.OpusBitrate)
{
    _encodePipeline?.Dispose();
    _encodePipeline = null;
    // Pipeline will be recreated on next StartMic() call
}
```

**Step 5: Build**

```
dotnet build
```

Expected: Succeeds.

**Step 6: Run all tests**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: All PASS.

**Step 7: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: read OpusBitrate from AudioSettings in AudioManager"
```

---

### Task 6: Add bitrate dropdown to `AudioSettingsTab.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`

**Step 1: Add `opusBitrate` to the TypeScript interface and defaults**

In `AudioSettingsTab.tsx`, update the `AudioSettings` interface:

```typescript
export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  maxAmplification: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  opusBitrate: number;
}
```

Update `DEFAULT_SETTINGS`:

```typescript
export const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 250,
  outputVolume: 250,
  maxAmplification: 100,
  transmissionMode: 'pushToTalk',
  pushToTalkKey: null,
  opusBitrate: 72000,
};
```

**Step 2: Add the Encoding section to the JSX**

In the `return` block of `AudioSettingsTab`, add a new section after the Transmission section (after the closing `</div>` of the Transmission section, before the final `</div>`):

```tsx
{/* Encoding Section */}
<div className="settings-section">
  <h3 className="heading-section settings-section-title">Encoding</h3>
  <div className="settings-item">
    <label>Bitrate</label>
    <div className="select-wrapper">
      <select
        className="brmble-input"
        value={localSettings.opusBitrate}
        onChange={(e) => handleChange('opusBitrate', parseInt(e.target.value, 10))}
      >
        <option value={24000}>24 kbps</option>
        <option value={40000}>40 kbps</option>
        <option value={56000}>56 kbps</option>
        <option value={72000}>72 kbps (default)</option>
        <option value={96000}>96 kbps</option>
        <option value={128000}>128 kbps</option>
      </select>
    </div>
  </div>
</div>
```

**Step 3: Build the frontend**

```
cd src/Brmble.Web && npm run build
```

Expected: Builds without TypeScript errors.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat: add Opus bitrate dropdown to audio settings UI"
```

---

### Task 7: Final verification

**Step 1: Run all tests**

```
dotnet test
```

Expected: All test projects pass.

**Step 2: Build client**

```
dotnet build
```

Expected: Succeeds with no errors.

**Step 3: Build frontend**

```
cd src/Brmble.Web && npm run build
```

Expected: Succeeds with no TypeScript errors.

**Step 4: Commit if any fixups needed, then done**

All changes are now in place on branch `feature/improve-opus-encoder`.
