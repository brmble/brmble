# Design: User Idle Status Display

**Date:** 2026-02-27  
**Status:** Approved

## Overview

Show different idle indicators in the channel list based on voice inactivity duration:
- **5-10 min:** Clock icon
- **10-20 min:** Moon icon  
- **20+ min:** Bed/sleep icon

Uses Mumble's existing `idlesecs` field from the UserStats protocol.

## Architecture

### C# Client (MumbleAdapter.cs)

1. Override `UserStats(UserStats userStats)` to receive idle data
2. Maintain a timer that requests UserStats for all users every ~10 seconds
3. Track previous idle level per user session
4. Emit `voice.userIdle` bridge event when idle level changes:

```csharp
// idleLevel: 0=none, 1=5min, 2=10min, 3=20min
_bridge?.Send("voice.userIdle", new { session, idleLevel });
```

### Frontend (TypeScript)

1. Add `idleLevel: 0 | 1 | 2 | 3` to the `User` type
2. Listen for `voice.userIdle` event in App.tsx
3. Update user state with new idle level
4. Render appropriate icon in ChannelTree.tsx based on idleLevel

## Data Flow

```
Mumble Server --UserStats(idlesecs)--> MumbleAdapter.UserStats()
                                              |
                                       Track per-user idle
                                              |
                                  Idle level crosses threshold?
                                              |
                        +---------+------------+-----------+
                        |         |            |           |
                       none   5min+        10min+       20min+
                        |         |            |           |
                   no event  voice.userIdle { session, idleLevel: 1 }
                                              |
                                    ChannelTree.tsx
                                     /    |    \
                              idleLevel prop drives icon
                                     |
                              .user-status span shows icon
```

## UI Design

### Icon Mapping

| idleLevel | Duration   | Icon (SVG)                                |
|-----------|------------|-------------------------------------------|
| 0         | < 5 min    | (none)                                    |
| 1         | 5-10 min   | Clock - 🕐                                |
| 2         | 10-20 min  | Moon - 🌙                                 |
| 3         | 20+ min    | Bed - 😴                                  |

### Placement in User Row

```
[🔇/🔊] [🔇/   ] [🕐/🌙/😴] [username]
   deaf   muted   idle     name
```

The idle icon appears in the `.user-status` span, alongside the existing deaf/muted icons.

## Thresholds

- **5 minutes:** 300 seconds - transition from active to idleLevel 1
- **10 minutes:** 600 seconds - transition from idleLevel 1 to idleLevel 2
- **20 minutes:** 1200 seconds - transition from idleLevel 2 to idleLevel 3

Implementation uses simple tiered comparisons, not a sliding window.

## Edge Cases

1. **User starts speaking:** Mumble resets `idlesecs` to 0 automatically - client receives updated UserStats and emits idleLevel: 0
2. **User reconnects:** New session = fresh idle tracking from 0
3. **Multiple users:** Each user tracked independently by session ID
4. **No voice channel:** Users outside voice channels are not shown

## Testing Considerations

- Manual test: Connect two clients, wait 5 min, verify clock appears
- Unit test: Idle level calculation logic
- Integration: Verify UserStats request/response cycle works
