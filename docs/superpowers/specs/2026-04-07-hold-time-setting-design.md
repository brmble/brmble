# Hold Time Setting — Design

## Overview

Add a "Hold Time" slider to the Audio Settings tab in the Transmission section. This setting controls how long the microphone keeps transmitting after speech stops, preventing cut-off when pausing between words.

The setting only appears when **Push to Talk** mode is selected, placed below the "Push to Talk Key" binding.

## Reference

Mumble uses `iVoiceHold` measured in frames (10ms each), with a default of 20 frames (200ms). Range: 100ms–2000ms.

## Changes

### 1. Settings Data Model

**File:** `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`

Add `voiceHoldMs: number` to `AudioSettings` interface with default `200`.

```typescript
export interface AudioSettings {
  // ... existing fields ...
  voiceHoldMs: number; // ms to hold mic open after speech stops
}

export const DEFAULT_SETTINGS: AudioSettings = {
  // ... existing defaults ...
  voiceHoldMs: 200,
};
```

### 2. UI Component

**File:** `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`

Inside the PTT-only block (after Push to Talk Key binding):

```tsx
<div className="settings-item settings-slider">
  <label>
    Hold Time: {localSettings.voiceHoldMs}ms{localSettings.voiceHoldMs === 200 ? ' (default)' : ''}
    <span className="tooltip-icon" data-tooltip="How long to keep transmitting after you stop speaking. Prevents cut-off when pausing between words.">?</span>
  </label>
  <input
    type="range"
    min="100"
    max="2000"
    step="10"
    value={localSettings.voiceHoldMs}
    onChange={(e) => handleChange('voiceHoldMs', parseInt(e.target.value, 10))}
  />
</div>
```

### 3. Settings Persistence

**File:** `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

Ensure `voiceHoldMs` is included in the settings object passed to the bridge for persistence.

### 4. Backend Configuration

**File:** `src/Brmble.Client/Services/Voice/AudioManager.cs`

Replace hardcoded `LocalSpeakingTimeoutMs = 300` with configurable field:

```csharp
private int _voiceHoldMs = 200; // configurable hold time in ms
```

Update `SetVoiceHoldMs(int ms)` method (add if not exists) to accept the value.

### 5. Bridge Communication

**File:** `src/Brmble.Client/Services/Voice/VoiceService.cs`

Route `voiceHoldMs` from settings to `AudioManager.SetVoiceHoldMs()`.

## Files to Modify

1. `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` — add slider UI
2. `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx` — ensure persistence
3. `src/Brmble.Client/Services/Voice/VoiceService.cs` — wire up setting
4. `src/Brmble.Client/Services/Voice/AudioManager.cs` — implement configurable hold time

## Testing

- Slider only visible when PTT mode selected
- Slider correctly updates `voiceHoldMs` in settings
- Value persists across app restarts
- Backend receives and applies the new hold time value
