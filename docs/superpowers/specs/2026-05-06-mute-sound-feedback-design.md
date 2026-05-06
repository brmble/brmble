# Mute Sound Feedback Design

**Date:** 2026-05-06

**Goal:** Add audio feedback when toggling mute via keyboard shortcut in Settings > Shortcuts > Toggle Mute.

---

## Overview

When a user presses the "Toggle Mute" keybind, they currently get no audio feedback. This design adds a configurable sound that plays on mute/unmute, giving users audio confirmation of their action.

The feature adds a sound dropdown as a sub-setting beneath the "Toggle Mute" row in Settings > Shortcuts, allowing users to choose from 3 sound schemes (Click, Pop, Beep) or disable sound entirely (None).

---

## Architecture

### Data Flow

1. **User presses mute keybind**
   - `AudioManager.cs` detects hotkey
   - Calls `SetMuted(!_muted, source: 'shortcut')`
   - Sends `voice.selfMuteChanged` via bridge with `{ muted: boolean, source: 'shortcut' }`

2. **Frontend receives event**
   - `App.tsx`: `bridge.on('voice.selfMuteChanged')` handler
   - Check `source === 'shortcut'` (not 'ui')
   - Check `settings.shortcuts.muteSoundScheme`
   - If not null, call sound service

3. **Sound service plays audio**
   - `soundService.ts` uses Web Audio API with singleton AudioContext
   - Different frequencies for mute (low) vs unmute (high)
   - Gain envelope applied to prevent clipping artifacts
   - Active oscillator tracked and stopped before new sound starts

---

## Sound Design

Each scheme defines a **pair** of sounds: one for mute (low), one for unmute (high).

### 1. Click
- **Mute:** Short low click (~600Hz, 50ms, gain 0.3)
- **Unmute:** Short high click (~1200Hz, 50ms, gain 0.3)
- Like a mouse click, subtle and quick

### 2. Pop
- **Mute:** Soft pop (~400Hz, 80ms, envelope with decay)
- **Unmute:** Bright pop (~800Hz, 80ms, quick attack)
- Like a bubble popping, slightly softer feel

### 3. Beep
- **Mute:** Descending beep (800→400Hz ramp, 100ms)
- **Unmute:** Ascending beep (400→800Hz ramp, 100ms)
- Like old phone tones, more noticeable

### None
- No sound plays (default)

---

## UI Design

### Location
Settings > Shortcuts > "Toggle Mute" row (sub-setting beneath the key binding)

### Layout
```
[Label: Toggle Mute]
  [Key Binding Button: Ctrl+Shift+M]
  [Label: Sound]  [Dropdown: Click ▼]
```

- Dropdown appears as a **sub-setting row** beneath the Toggle Mute key binding
- Indented slightly (16px left margin) to show hierarchy
- Dropdown width: ~120px
- Uses existing `<select>` styling from project CSS
- This prevents misalignment with other shortcut rows that don't have dropdowns

### Dropdown Options
1. None (default - no sound)
2. Click
3. Pop
4. Beep

### Behavior
- Dropdown is **always visible** (not just when key is bound)
- Changing dropdown saves setting immediately
- Setting persists across sessions via `localStorage` and backend `settings.set`

---

## Technical Implementation

### Web Audio API Approach
No audio files needed - sounds generated programmatically.

**File:** `src/Brmble.Web/src/services/soundService.ts`

```typescript
// Singleton AudioContext - browsers limit concurrent instances to ~6
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

// Track active oscillator to prevent overlapping sounds
let activeOsc: OscillatorNode | null = null;
let activeGain: GainNode | null = null;

interface SoundProfile {
  freq: number;
  duration: number;
  type: 'sine' | 'square';
  rampDown?: boolean;
  rampUp?: boolean;
}

interface SoundScheme {
  mute: SoundProfile;
  unmute: SoundProfile;
}

const schemes: Record<string, SoundScheme> = {
  click: {
    mute: { freq: 600, duration: 0.05, type: 'square' },
    unmute: { freq: 1200, duration: 0.05, type: 'square' }
  },
  pop: {
    mute: { freq: 400, duration: 0.08, type: 'sine' },
    unmute: { freq: 800, duration: 0.08, type: 'sine' }
  },
  beep: {
    mute: { freq: 800, duration: 0.1, type: 'sine', rampDown: true },
    unmute: { freq: 400, duration: 0.1, type: 'sine', rampUp: true }
  }
};

export function playMuteSound(scheme: string | null, muted: boolean): void {
  if (!scheme || !schemes[scheme]) return;

  // Stop any currently playing sound
  if (activeOsc) {
    try { activeOsc.stop(); } catch { /* already stopped */ }
    activeOsc.disconnect();
    activeGain?.disconnect();
  }

  const audio = schemes[scheme][muted ? 'mute' : 'unmute'];
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  // Gain envelope to prevent clipping artifacts (fade in/out)
  const fadeIn = 0.01;
  const fadeOutStart = audio.duration - 0.02;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + fadeIn);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + Math.max(fadeOutStart, fadeIn));

  osc.type = audio.type;

  if (audio.rampDown) {
    osc.frequency.setValueAtTime(audio.freq, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(audio.freq * 0.5, ctx.currentTime + audio.duration);
  } else if (audio.rampUp) {
    osc.frequency.setValueAtTime(audio.freq, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(audio.freq * 2, ctx.currentTime + audio.duration);
  } else {
    osc.frequency.value = audio.freq;
  }

  osc.connect(gain);
  gain.connect(ctx.destination);

  activeOsc = osc;
  activeGain = gain;

  osc.start();
  osc.stop(ctx.currentTime + audio.duration);

  // Cleanup after stop
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
    if (activeOsc === osc) {
      activeOsc = null;
      activeGain = null;
    }
  };
}
```

---

## Settings Persistence

### TypeScript Interface
**File:** `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx`

```typescript
export interface ShortcutsSettings {
  toggleMuteKey: string | null;
  toggleMuteDeafenKey: string | null;
  toggleLeaveVoiceKey: string | null;
  toggleDMScreenKey: string | null;
  toggleScreenShareKey: string | null;
  toggleGameKey: string | null;
  // NEW:
  muteSoundScheme: 'click' | 'pop' | 'beep' | null;
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  // ... existing fields ...
  muteSoundScheme: null, // Default: no sound
};
```

### C# Backend - Event Payload
**File:** `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

Modify `voice.selfMuteChanged` payload to include source:
```csharp
_bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted, source = "shortcut" });
```

**File:** `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

Add `MuteSoundScheme` to the `ShortcutsSettings` record for backend persistence.

---

## Components to Modify

| Component | Change |
|-----------|--------|
| `ShortcutsSettingsTab.tsx` | Add sound dropdown as sub-setting beneath Toggle Mute row |
| `ShortcutsSettingsTab.css` | Add `.sound-select` and `.sound-sub-row` styles |
| `App.tsx` | On `voice.selfMuteChanged` with `source === 'shortcut'`, call `playMuteSound()` |
| `soundService.ts` (NEW) | Web Audio API with singleton context, gain envelope, oscillator tracking |
| `MumbleAdapter.cs` | Add `source` field to `voice.selfMuteChanged` payload |
| `AudioManager.cs` | Pass `source: 'shortcut'` when mute triggered by hotkey |
| `AppSettings.cs` | Add `MuteSoundScheme` field to `ShortcutsSettings` record |

---

## Testing

1. **Unit Tests:** Test `soundService.ts` - singleton AudioContext, gain envelope, oscillator tracking
2. **Integration:** Bind Toggle Mute key, change sound scheme, verify correct sound plays
3. **Edge Cases:**
   - Sound scheme = None → no audio plays
   - Rapid mute/unmute → previous sound stops, no overlapping
   - Unbind key → dropdown still works
   - Default state → "None" selected, no sound on mute
   - Play 10+ sounds → singleton AudioContext prevents memory leak
   - UI mute button click → no sound (source !== 'shortcut')
   - Gain envelope → no clipping artifacts on start/stop

---

## Scope Exclusions

- No sounds for "Toggle Mute & Deafen" (separate feature)
- No sounds for microphone button clicks in UI - enforced by `source !== 'shortcut'` check
- No custom sound file uploads (future enhancement)
