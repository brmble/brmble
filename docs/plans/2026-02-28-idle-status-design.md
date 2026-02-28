# Idle Status Feature Design

**Issue:** #61 — feat: show idle status for users after inactivity  
**Date:** 2026-02-28  
**Authors:** Grandpa (design), Mr Pickle (research)

## Goal

Add idle status detection and display so users can see who is inactive, with configurable actions that trigger automatically when thresholds are exceeded.

## Two Idle Concepts

The system distinguishes between two types of inactivity, displayed as a single indicator with priority ordering:

### Voice Inactivity (Zzz)

- **Source:** Mumble server's `UserStats.idlesecs` field — server-computed, tracks seconds since last voice transmission
- **Scope:** All users in the current channel (server knows everyone's idle time)
- **Display:** Zzz icon next to user name
- **Actions:** None — display only

### Brmble Inactivity (AFK)

- **Source:** Client-side tracking of all user input within the Brmble app (mouse, keyboard, clicks, scroll, chat sends, voice toggles, channel joins)
- **Scope:** Local user only
- **Display:** AFK icon next to user name
- **Actions:** Self-mute, leave voice (configurable thresholds)

### Windows Inactivity (No display)

- **Source:** Win32 `GetLastInputInfo` API — tracks system-wide mouse/keyboard idle time
- **Scope:** Local user only
- **Display:** None — action trigger only
- **Actions:** Self-mute, leave voice (configurable thresholds)

## Display Rules

**Single icon, highest priority wins:**

| Priority | State    | Icon     | Trigger                                          |
|----------|----------|----------|--------------------------------------------------|
| 3 (high) | **AFK**  | AFK icon | Brmble idle threshold exceeded OR manual toggle   |
| 2        | **Zzz**  | Zzz icon | Voice idle threshold exceeded, user still in Brmble |
| 1 (low)  | **Active** | None   | User is speaking and interacting                  |

- AFK supersedes Zzz — if you're AFK, you're obviously also voice idle
- Icons never stack
- Manual AFK toggle is display-only — if users want to mute+deafen, they use the existing "leave voice" function

## Manual AFK Toggle

- User can manually set themselves AFK via a button or shortcut
- Purely a display indicator — does not trigger any actions (mute, leave voice)
- Stays active until the user explicitly un-toggles, regardless of activity
- Designed for: "I'm stepping away but don't want to leave voice"

## Action System

Actions are only triggered by timer-based sources, because those indicate the user genuinely isn't present:

| Idle Source    | Self-Mute | Leave Voice |
|---------------|-----------|-------------|
| Voice Idle     | —         | —           |
| Brmble Idle    | Yes       | Yes         |
| Windows Idle   | Yes       | Yes         |
| Manual AFK     | —         | —           |

- "Leave voice" uses the existing leave-voice function (mute + deafen + move to root)
- Action delays are measured from when that idle source started (not from the display threshold)

## Architecture: Approach A (Unified Idle Service)

Frontend owns display, settings, and Brmble idle detection.  
C# backend owns Mumble protocol communication and Windows API calls.

```
Frontend (React)                       C# Backend
─────────────────                      ─────────────────
useBrmbleIdle()                        IdleService (IService)
  └─ DOM events in WebView               ├─ VoiceIdleTracker
useIdleSettings()                        │   └─ polls UserStats.idlesecs
  └─ localStorage                        ├─ SystemIdleTracker
useIdleStatus()                          │   └─ GetLastInputInfo (Win32)
  └─ combines all sources                └─ pushes via bridge
useIdleActions()                            voice.idleUpdate { voice, system }
  └─ evaluates thresholds
  └─ sends action commands
     (voice.toggleMute, voice.leaveVoice)
```

### Why this split?

- C# naturally owns the two platform-level data sources (Mumble protocol + Win32 API)
- Frontend naturally owns the app-level one (DOM events within the WebView)
- Minimal new bridge messages — data flows one way (C# -> JS), actions reuse existing messages

### Voice idle data source abstraction

The `VoiceIdleTracker` is behind an interface so we can swap polling for server-push (Ice/CVP) later. Initial implementation uses periodic polling of `UserStats` per user.

## Settings Model

Stored in frontend `localStorage` under a dedicated key (following existing `brmble-settings` pattern).

```typescript
interface IdleSettings {
  voiceIdle: {
    enabled: boolean;           // default: true
    thresholdMinutes: number;   // default: 5 — show Zzz icon
  };
  brmbleIdle: {
    enabled: boolean;           // default: true
    thresholdMinutes: number;   // default: 10 — show AFK icon
    actions: {
      selfMute:   { enabled: boolean; delayMinutes: number }; // e.g. 15 min
      leaveVoice: { enabled: boolean; delayMinutes: number }; // e.g. 30 min
    };
  };
  windowsIdle: {
    enabled: boolean;           // default: false (opt-in)
    actions: {
      selfMute:   { enabled: boolean; delayMinutes: number }; // e.g. 10 min
      leaveVoice: { enabled: boolean; delayMinutes: number }; // e.g. 20 min
    };
  };
  manualAfk: {
    broadcastToOthers: boolean; // default: true — for future broadcasting
  };
}
```

## Bridge Messages

### New messages

| Direction | Type                | Payload                                                  | Purpose                                |
|-----------|---------------------|----------------------------------------------------------|----------------------------------------|
| C# → JS  | `voice.idleUpdate`  | `{ voiceIdle: { [sessionId]: number }, systemIdle: number }` | Periodic push of voice + Windows idle  |
| JS → C#  | `voice.setAfkStatus`| `{ afk: boolean }`                                      | Manual AFK toggle (for future broadcast)|

### Reused existing messages

| Direction | Type                | Purpose                  |
|-----------|---------------------|--------------------------|
| JS → C#  | `voice.toggleMute`  | Self-mute action         |
| JS → C#  | `voice.leaveVoice`  | Leave voice action       |

## Broadcasting (Future)

- Brmble idle/AFK status should eventually be broadcast to other Brmble users
- The Brmble server doesn't currently support custom events
- Users will have an opt-out setting (`broadcastToOthers`)
- Architecture is ready: `voice.setAfkStatus` bridge message exists, just needs server relay added later

## Key Files

### C# (new)
- `src/Brmble.Client/Services/Idle/IdleService.cs` — IService implementation
- `src/Brmble.Client/Services/Idle/VoiceIdleTracker.cs` — polls UserStats
- `src/Brmble.Client/Services/Idle/SystemIdleTracker.cs` — Win32 GetLastInputInfo

### C# (modify)
- `src/Brmble.Client/Program.cs` — register IdleService
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — override UserStats(), expose connection

### Frontend (new)
- `src/Brmble.Web/src/hooks/useIdleSettings.ts` — settings read/write from localStorage
- `src/Brmble.Web/src/hooks/useBrmbleIdle.ts` — DOM event idle tracking
- `src/Brmble.Web/src/hooks/useIdleStatus.ts` — combines sources, evaluates thresholds
- `src/Brmble.Web/src/hooks/useIdleActions.ts` — triggers actions on threshold breach

### Frontend (modify)
- `src/Brmble.Web/src/types/index.ts` — add idle types to User interface
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` — display idle icons
- `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` — display idle icons in root users
- `src/Brmble.Web/src/App.tsx` — wire up idle hooks, manual AFK toggle
