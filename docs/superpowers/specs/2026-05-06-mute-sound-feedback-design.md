# Mute Sound Feedback Design

**Date:** 2026-05-06

**Goal:** Add audio feedback when toggling mute via keyboard shortcut in Settings > Shortcuts > Toggle Mute.

---

## Overview

When a user presses the "Toggle Mute" keybind, they currently get no audio feedback. This design adds a configurable sound that plays on mute/unmute, giving users audio confirmation of their action.

The feature adds a dropdown selector to the left of the "Toggle Mute" key binding button in Settings > Shortcuts, allowing users to choose from 3 sound schemes (Click, Pop, Beep) or disable sound entirely (None).

---

## Architecture

### Data Flow

1. **User presses mute keybind**
   - `AudioManager.cs` detects hotkey
   - Calls `SetMuted(!_muted)`
   - Sends `voice.selfMuteChanged` via bridge with `{ muted: boolean }`

2. **Frontend receives event**
   - `App.tsx`: `bridge.on('voice.selfMuteChanged')` handler
   - Check `settings.shortcuts.muteSoundScheme`
   - If not null, call sound service

3. **Sound service plays audio**
   - `soundService.ts` uses Web Audio API
   - Different frequencies for mute (low) vs unmute (high)
   - Sound scheme determines the exact audio profile

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
Settings > Shortcuts > "Toggle Mute" row

### Layout
```
[Label: Toggle Mute]        [Dropdown: Click ▼]    (16px gap)    [Key Binding Button: Ctrl+Shift+M]
```

- Dropdown appears **on the LEFT** of the key binding button
- **16px gap** between dropdown and keybind button
- Dropdown width: ~120px
- Uses existing `<select>` styling from project CSS

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
interface SoundScheme {
  mute: { freq: number; duration: number; type: 'sine' | 'square'; rampDown?: boolean };
  unmute: { freq: number; duration: number; type: 'sine' | 'square'; rampUp?: boolean };
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
  
  const audio = schemes[scheme][muted ? 'mute' : 'unmute'];
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = audio.type;
  gain.gain.value = 0.3;
  
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
  
  osc.start();
  osc.stop(ctx.currentTime + audio.duration);
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

### C# Backend
**File:** `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

Add `MuteSoundScheme` to the `ShortcutsSettings` record for backend persistence.

---

## Components to Modify

| Component | Change |
|-----------|--------|
| `ShortcutsSettingsTab.tsx` | Add dropdown next to Toggle Mute, wire to `muteSoundScheme` |
| `ShortcutsSettingsTab.css` | Add `.sound-select` and `.sound-key-row` styles |
| `App.tsx` | On `voice.selfMuteChanged`, call `playMuteSound()` if scheme set |
| `soundService.ts` (NEW) | Web Audio API sound generation |
| `AppSettings.cs` | Add `MuteSoundScheme` field to `ShortcutsSettings` record |

---

## Testing

1. **Unit Tests:** Test `soundService.ts` tone generation (mock AudioContext)
2. **Integration:** Bind Toggle Mute key, change sound scheme, verify correct sound plays
3. **Edge Cases:**
   - Sound scheme = None → no audio plays
   - Rapid mute/unmute → sounds don't overlap/crash
   - Unbind key → dropdown still works
   - Default state → "None" selected, no sound on mute

---

## Scope Exclusions

- No sounds for "Toggle Mute & Deafen" (separate feature)
- No sounds for microphone button clicks in UI (only keybinds)
- No custom sound file uploads (future enhancement)
