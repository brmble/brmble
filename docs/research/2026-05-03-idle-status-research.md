# Idle Status Feature — Implementation Research

Date: 2026-05-03
Issue: [#61 — feat: show idle status for users after inactivity](https://github.com/brmble/brmble/issues/61)
Scope: Detection, display, and sync of idle/AFK presence in Brmble (Win32 + WebView2 + MumbleSharp + Matrix).
Supersedes the Feb 2026 design + implementation plan on branch `docs/idle-status-design` — keeps the architecture, revises the source mix, the polling layer, and several defaults.

## TL;DR

1. **The Mumble protocol gives us one signal: `UserStats.idlesecs`, pull-only.** No `UserState` broadcast carries it, so we *must* poll. Mumble itself ships no native idle UI beyond a per-user voice-activity colour in the 1.4+ user list.
2. **`idlesecs` resets on outbound voice + control messages, not on listening.** This is the famous Mumble pain point — and it's why `idlesecs` alone makes attentive listeners look AFK. We have to compensate client-side.
3. **Combine three sources with AND, not OR**: Mumble voice idle (server-truth, all peers) + Brmble app idle (DOM events, local only) + Win32 system idle (`GetLastInputInfo`, local only). Any one source being "active" un-AFKs the user. This matches Teams' multi-source model and avoids both Mumble's and Discord's biggest false-positives.
4. **Default threshold: 10 minutes.** This is the de-facto industry consensus (Slack, Discord, Steam). Teams' 5 min is the most-complained-about value in its ecosystem; Steam's 2h Snooze is a different state. 10 min hits the sweet spot.
5. **Polling budget: sweep current channel every 30 s, max 30 users per sweep.** Mumble servers enforce a leaky-bucket of ~1 control message/sec sustained (burst 5). `mumo`'s reference idle bot uses 10 s sweeps; 30 s is cautious and works for any normal channel size.
6. **Subscribe to `WM_WTSSESSION_CHANGE` (lock/unlock).** Lock screen → hard AFK regardless of `GetLastInputInfo`, sidesteps the media-playback false positive (locked = definitely AFK).
7. **Local voice transmit must reset Brmble app idle.** Speaking is unambiguous presence even with no DOM events. Wire a `MumbleAdapter` transmit event into the React idle reducer as a synthetic activity ping.
8. **No manual AFK toggle, no separate "AFK" display state.** Leave-voice already serves as the explicit "I'm stepping away" affordance. The only visible idle indicator is the peer-visible "Zzz" icon driven by `UserStats.idlesecs`. The local user's idle state is internal — used to fire configured auto-actions (self-mute, leave-voice), not displayed.
9. **Drop "broadcast Brmble idle to other users" from v1.** Mumble has no extension point and Matrix presence is disabled on most homeservers (matrix.org included). All peer-visible idle comes from `idlesecs` polling. No bridge channel needed for Brmble-specific status.
10. **Don't use `Environment.TickCount64 - dwTime` for system idle.** `dwTime` is the low 32 bits of `GetTickCount`; mismatched widths = garbage after 49.7 days uptime. Subtract in 32-bit unsigned space.
11. **No "AFK channel auto-move" in v1.** It's a 2015 idea that fights better with mute-on-idle today. We can re-evaluate later.

## Why this is hard

Idle/presence looks like a 2-day feature. The reasons it isn't:

- **Mumble has no presence model.** It tracks `idlesecs` server-side and that's it. There is no "AFK status" field, no `m.presence`-like EDU, no push event. Every other voice-app comparable in age (TeamSpeak, Ventrilo) has the same gap.
- **No single source is reliable.** Mumble's `idlesecs` flags listeners as idle. `GetLastInputInfo` flags fullscreen gamers and Netflix viewers as idle. DOM events miss everything that happens outside the WebView. You need to combine sources and accept that "watching a movie with the PC unattended" is a false positive nobody has solved.
- **The cross-app-presence problem is unsolved at scale.** Matrix, the closest comparable open protocol, ships presence but it's disabled on most homeservers because it doesn't scale (Synapse #3971). Discord's solution is centralised, proprietary, and still has many gaps. We can't punt to a standard.

The design needs to land somewhere defensible, with the right defaults, the right combination logic, and a graceful degradation when sources lie.

---

## Part 1 — The Mumble Protocol: what it actually gives us

### `UserStats.idlesecs` is the only signal

Verified against `lib/MumbleSharp/MumbleSharp/Packets/mumble.proto:567` and `mumble-voip/mumble:src/murmur/Messages.cpp`:

```proto
optional uint32 idlesecs = 17;  // "Duration since last activity."
```

- **Server-computed.** `msgUserStats` returns `bwr.idleSeconds()` from per-user `BandwidthRecord`. The client never reports its own idle.
- **Reset triggers.** Most authenticated control messages run the macro `MSG_SETUP(st)`, which calls `uSource->bwr.resetIdleSeconds()`. Outbound voice (UDP/UDPTunnel) also resets via the audio dispatch path. `msgPing` and `msgUserStats` use `MSG_SETUP_NO_UNIDLE` and do **not** reset. Practical effect: speaking, sending text, or changing mute/channel resets idle; *passively listening for two hours does not*.
- **No `away` / `presence` / `afk` field.** `UserState` has `mute`, `selfMute`, `deaf`, `selfDeaf`, `suppress`, `priority_speaker` — all mute-state, no presence. Brmble cannot relay a richer status to non-Brmble Mumble clients without a protocol extension (which has been requested for years and never merged).

### Pull-only — there is no presence push

`idlesecs` only arrives in response to a `UserStats` request. The server never broadcasts it. The official Mumble client triggers a `UserStats` request every time you open a user's "Information" dialog, and the moderator-bot framework `mumo` polls on a timer for its `idlemove` module. There is no event-driven shortcut.

### Polling budget

From `Messages.cpp` and `mumble-server.ini`:

- The global leaky bucket is `messageburst=5`, `messagelimit=1` per client per server — ~1 control message/sec sustained, burst 5.
- `msgUserStats` does **not** call `RATELIMIT(user)` directly, but counts toward the global bucket.
- Reference: `mumo`'s `idlemove` defaults to `interval=10` (full server sweep every 10 seconds) and has run in production on large servers for years without complaints.

**Brmble policy:** sweep current channel every 30 s, max 30 users per sweep, otherwise stagger across waves. For a channel of N users with sweep interval T, ensure `N/T ≤ 1` sustained; we want plenty of headroom because the user may also send text and toggle mute. Use `stats_only=true` to keep response payloads small (omits cert + full bandwidth, keeps `idlesecs` and `onlinesecs`).

### `UserStats` privacy / visibility

Verified: requesting `UserStats` is not broadcast to the target — no "someone checked your stats" notification exists. The official client does this on every "User Information" dialog open. Safe to poll. Note that `UserStats` returns IP and certificate hash unless the requester is the user themselves or has admin rights — most servers restrict the bandwidth/cert fields. `idlesecs` and `onlinesecs` come back regardless.

### What MumbleSharp gives us today

- `IMumbleProtocol.UserStats(UserStats)` — incoming dispatch hook (`IMumbleProtocol.cs:201`).
- `BasicMumbleProtocol.SendRequestUserStats(UserStats)` — outgoing send (`BasicMumbleProtocol.cs:899-902`).
- Default handler is empty virtual; `MumbleAdapter` does not currently override it.
- **No polling scheduler, no per-session caching, no throttle.** We own all of that.

### Mumble's known issues, summarised

- [#1257](https://github.com/mumble-voip/mumble/issues/1257) — long-standing request for a server-controlled AFK channel that auto-deafens occupants. Never landed.
- [#1858](https://github.com/mumble-voip/mumble/issues/1858) — the new Qt UI's red-fading idle icons confuse users; it's the only visual idle signal Mumble ships and it's contentious.
- [#2997](https://github.com/mumble-voip/mumble/issues/2997) — request to be able to ping/poke deafened users; thread acknowledges no protocol-level presence mechanism.
- [#3831](https://github.com/mumble-voip/mumble/issues/3831) — admin reports their AFK bot uses `UserStats.idlesecs`; flags packet-loss regression in 1.3.0.
- forums.mumble.info topics 1160, 2347, 303 — same gap, repeatedly: Murmur has no idle logic; you script it via Ice/mumo.

The user's intuition was correct: **Mumble's idle support is exactly one int field, and the community has been working around it for over a decade.**

---

## Part 2 — How competing apps solve it

### Side-by-side

| App | Auto-idle source | Default threshold | Manual states | Broadcast to peers? | Notable failure mode |
|---|---|---|---|---|---|
| **Discord** | OS idle (Electron `powerMonitor`) | ~10 min | online / idle / dnd / invisible | Gateway `PRESENCE_UPDATE` | Wayland: never idles; voice mic noise keeps you online |
| **Slack** | OS idle (Electron) + WS heartbeat | ~10 min | active / away (+ status) | `presence_change` event | Mouse-jigglers defeat trivially |
| **MS Teams** | OS idle + lock + Outlook calendar + app state | **5 min** | Available / Busy / DND / BRB / Away / Appear Away / In a Call / In a Meeting / Presenting / OOO / Offline | Microsoft Graph push | "Stuck in meeting"; 5-min default widely complained about |
| **Element/Matrix** | Time-since-last-`/sync` | ~5 min | online / unavailable / offline (+ status_msg) | `m.presence` EDU (federated) | **Disabled on most homeservers** — fan-out is too expensive (Synapse #3971) |
| **Steam** | OS idle | ~10 min Away, ~2h Snooze | Online / Away / Snooze / Busy / Invisible / Looking-to-Play | Steam friends push | Fullscreen games suppress hooks → "in-game / Away" mid-play |
| **TeamSpeak 3/5** | None (manual only) | n/a — admin-side idle-kicker | Manual Away (free-text) | Server propagates flags | Users forget to toggle |
| **Mumble (official)** | Voice silence (client `tIdle` timer) | User-configurable, often 5–60 min | Self-mute / self-deafen + manual comment | Server idle action via mumo bot | Pure listeners flagged idle |
| **Zoom** | None (Attention Tracking removed 2020) | n/a | n/a | n/a | Removed under privacy backlash — instructive precedent |

### What the field tells us

- **Detection: 90% of "modern" apps use OS-level system idle.** Slack, Teams, Steam, Discord. The exceptions are the gaming-voice lineage (Mumble, TeamSpeak, Ventrilo) which infer from voice packets, and Matrix which infers from sync activity. Both alternatives have the same flaw — passive presence ≠ active presence.
- **Threshold consensus: 5–10 minutes.** Teams (5) is the most-complained-about default in its space. Discord, Slack, Steam (10) feel right to users. We pick 10.
- **Broadcast is hard.** Matrix at scale doesn't ship presence; Discord runs centralised infra; Mumble has no extension point. Brmble's safest play is: derive *peer* idle from `UserStats.idlesecs` (already in the protocol, all servers support it) and don't try to broadcast a richer Brmble-specific status to peers in v1.
- **Manual override is universal and wanted in apps where presence is the *only* affordance** (Slack, Teams, Discord — you can't "leave the room" because there is no room). Brmble has voice channels: leaving voice already *is* the explicit "I'm stepping away" affordance. We can skip the manual AFK toggle without losing user value.
- **Surveillance affordances backfire.** Zoom Attention Tracking was killed in 2020 after privacy backlash. Don't expose raw last-input timestamps to peers, even though Discord wastes its `since` field. Buckets only.

### Lessons distilled

1. OS idle is the right base signal, not voice packets. Add voice packets and DOM events as additional un-idle signals.
2. 10 minutes is the right default. Make it configurable.
3. Skip manual AFK — leave-voice already covers it for Brmble's UX.
4. Don't broadcast more than the protocol naturally supports. Peer idle is `idlesecs`-derived; that's it for v1.
5. Let users disable auto-idle and auto-actions. Discord's refusal to ship a disable-toggle spawned three top community plugins.

---

## Part 3 — OS-level idle detection

### `GetLastInputInfo` is the right API on Windows

`BOOL GetLastInputInfo(PLASTINPUTINFO plii)` returns the `GetTickCount()` value of the last qualifying input event for **the calling session**. Brmble runs in the user's interactive session, so this is exactly what we want. (Cross-session via `WTSQuerySessionInformation` is only relevant if we ever ship a service.)

**Wraparound.** `dwTime` is `DWORD` (32-bit). After ~49.7 days uptime, it wraps. The safe pattern in C#:

```csharp
[StructLayout(LayoutKind.Sequential)]
struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

[DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);

uint IdleMs()
{
    var lii = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
    GetLastInputInfo(ref lii);
    return unchecked((uint)Environment.TickCount - lii.dwTime); // 32-bit unsigned wraps correctly
}
```

**Do not** mix widths (`Environment.TickCount64 - lii.dwTime`) — `dwTime` is the low 32 bits of the boot timestamp; after a wrap the high bits diverge and the result is garbage. The Feb plan's snippet uses `(uint)Environment.TickCount - info.dwTime` and casts to int — close enough but the cast can briefly produce a tiny negative on the documented "not guaranteed to be incremental" race; clamp to zero.

### Edge cases

- **Lock screen.** Counter keeps incrementing correctly while locked. Login at the secure desktop is invisible to the session counter, so unlocking gives several seconds of phantom idle until the first post-unlock input. **Fix:** subscribe to `WM_WTSSESSION_CHANGE` via `WTSRegisterSessionNotification`. `WTS_SESSION_LOCK` → instant hard-AFK; `WTS_SESSION_UNLOCK` → reset idle to zero.
- **RDP.** `GetLastInputInfo` correctly reports the RDP session's idle time (input over the RDP channel updates the remote session tick). No special handling needed.
- **Fullscreen exclusive games (DirectInput).** Many games bypass the message queue. `GetLastInputInfo` stays frozen during gameplay; the user appears AFK while actively playing. Modern raw input mostly works, but `RIDEV_NOLEGACY` registration historically broke it. We cannot fix this from outside the game. Mitigation: keep the system-idle threshold long (10 min) and don't take destructive actions on system-idle alone — the AND with Brmble app idle and voice idle covers most cases (a gamer with Brmble open and PTT will be transmitting).
- **Media playback.** Watching a movie reports as idle — `GetLastInputInfo` only tracks human input. `SetThreadExecutionState(ES_DISPLAY_REQUIRED)` inhibits sleep but does not reset the idle counter. There's no clean OS-level fix. We accept this as a known false positive and offer the manual override.
- **Touch / pen.** Counts on Windows 8+; no special handling.

### Cross-platform notes (for a future port)

- **macOS:** `CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateHIDSystemState, kCGAnyInputEventType)` returns seconds (double). Subscribe to `NSDistributedNotificationCenter` for `com.apple.screenIsLocked` / `Unlocked`.
- **Linux X11:** `XScreenSaverQueryInfo()` (libXss).
- **Linux Wayland:** `ext-idle-notify-v1` (notification-style; client requests "wake me when seat idle ≥ N s"). Supported by KWin, wlroots-based compositors (Sway, Hyprland), Mir. **Not supported by GNOME Mutter** — fall back to `org.gnome.Mutter.IdleMonitor` D-Bus.

For Brmble v1 (Windows-only), we just need `GetLastInputInfo`. But the design should expose `IIdleSource` so a future port doesn't require restructuring.

### DOM-level idle inside the WebView

Listen on `window`: `mousemove`, `mousedown`, `keydown`, `wheel`, `touchstart`, `pointerdown`, `pointermove`, `scroll`, `click`. Throttle event handlers (write-only to a `lastActivityTs` ref; let the polling tick read).

**WebView2 background throttling:** when the window is hidden, Chromium throttles `setInterval` to ≥1 Hz after a 10-second budget. The Feb plan's `useBrmbleIdle` increments `idleSecs` on each interval tick — that pattern under-counts when hidden. **Use `lastActivityTs = Date.now()` and compute `Math.floor((Date.now() - lastActivityTs) / 1000)` per tick instead.** WebSocket and active audio playback exempt the page from throttling, so an active Mumble call keeps timers accurate.

**Page Visibility:** `document.visibilityState === 'hidden'` should not reset the timer (user might be in a fullscreen game) but should not increment it artificially either. The timestamp-diff approach handles this naturally.

### Voice transmission as activity

The local user is unambiguously present while transmitting. This is currently captured for *peers* via Mumble's `bwr.resetIdleSeconds()` on the audio dispatch — but locally we should also reset the Brmble-app idle timer. Wire a synthetic activity event from `MumbleAdapter`'s local-transmit state into the React reducer (same path as a `keydown`).

---

## Part 4 — Combining sources

Three independent timers:

| Timer | Source | Scope | What "active" means |
|---|---|---|---|
| `voiceIdleSec` | Mumble `UserStats.idlesecs` | All peers + self | Spoke or sent control message recently |
| `brmbleIdleSec` | DOM events + voice transmit | Self only | Interacted with Brmble or spoke |
| `systemIdleSec` | `GetLastInputInfo` | Self only | Touched mouse/keyboard anywhere on PC |

### AND, not OR

The combiner should consider the local user AFK iff **all three** sources agree they are inactive past their respective thresholds:

```
isAFK = voiceIdleSec  > voiceThreshold
     && brmbleIdleSec > brmbleThreshold
     && systemIdleSec > systemThreshold
```

Why AND:

- **Typing in another app:** system busy → not AFK. Correct: user is at the PC.
- **Gaming with PTT:** system idle (DirectInput false positive) but voice is being transmitted → not AFK. Correct.
- **Gaming with VAD:** system idle, voice idle if quiet, but Brmble window may have focus → still active.
- **Watching a movie unattended:** all three idle → AFK. This is the unavoidable false positive (the movie is "active use", but we can't tell). Manual override is the user's escape hatch.

OR would un-AFK on any single source being noisy and never trigger; AND requires consensus and is more conservative.

### Display: only one icon, peer-visible

The only visible idle indicator in the UI is the **Zzz icon** next to a username when their `voiceIdleSec > threshold`. That's it. Self gets the same icon as peers (consistent rendering). No "AFK" badge, no display state for "all three sources idle" — that internal state only drives auto-actions.

```
voiceIdleSec > threshold  →  show Zzz icon (peers + self)
otherwise                 →  no icon
```

### Local AFK state (internal only — drives actions)

The AND-combined AFK state is computed but never rendered. It exists solely to trigger configured auto-actions:

- All three sources past their thresholds **AND** `isLocked` is false (or whatever `isLocked` triggers) → consider firing self-mute / leave-voice actions per `useIdleActions` config.
- `isLocked === true` → short-circuit to "fully idle" regardless of timers (covers the media-playback false positive).

### Threshold defaults (revised from the Feb design)

| Source | Feb default | Revised default | Reason |
|---|---|---|---|
| Voice idle (Zzz, all peers + self) | 5 min | **5 min** | unchanged — matches `mumo` and Discord voice-AFK |
| Brmble app idle (action only, self) | 10 min | **10 min** | industry consensus; no display, gates self-mute action |
| Windows idle (action only, opt-in) | n/a — opt-in | **10 min, opt-in** | matches industry; opt-in still right because lock-screen handler covers most cases |
| Self-mute action delay | 15 min | **15 min** | unchanged |
| Leave-voice action delay | 30 min | **30 min** | unchanged |
| Lock-screen → fully idle | not specified | **immediate** | new — covers the media-playback false positive |

---

## Part 5 — Brmble architecture (revised)

### What holds up from the Feb design

- **Three sources** (voice idle, Brmble app idle, Windows idle) — yes, this is the right surface area.
- **Service split:** C# owns Win32 + Mumble; React owns DOM + settings + actions — yes, idiomatic for the bridge.
- **`voice.idleUpdate` C# → JS push every ~10 s** — yes, but also push on session change, not just on timer.
- **localStorage settings** with a dedicated key — yes, consistent with existing patterns.
- **Sidebar icon rendering** — yes, but use the centralised `<Icon>` component (Feb plan predates it) and only one icon (Zzz), not two.

### What needs revising

1. **Drop the manual AFK toggle entirely.** Leave-voice already covers "I'm stepping away." This removes: the manual-AFK button in the UI, the `manualAfk` settings sub-tree, the `voice.setAfkStatus` bridge message, and the `IdleState = 'afk'` display priority. Simplifies the React reducer significantly.
2. **Drop the AFK display state.** The combined "fully idle" state is internal-only (drives actions). Sidebar shows only the Zzz icon driven by voice idle, applied to peers and self consistently.
3. **`useBrmbleIdle` should use `Date.now()` diffing, not interval increment** — see Part 3 (WebView2 background throttling). Trivial code change.
4. **`useIdleActions` should AND the sources before firing destructive actions.** The Feb plan's `useIdleActions` checks `brmbleIdleSecs >= threshold` and `systemIdleSecs >= threshold` independently; either one alone can trigger leave-voice. That fires false positives for fullscreen gamers (DirectInput → system idle high while gaming). Require `brmbleIdleSecs >= brmbleThreshold` AND the source-specific threshold before firing.
5. **Add lock-screen handling** in the C# `SystemIdleTracker`: subscribe to `WM_WTSSESSION_CHANGE` via `WTSRegisterSessionNotification`, expose `IsLocked` alongside `GetIdleSeconds()`. Bridge payload becomes `{ voiceIdle: {...}, systemIdle: 123, isLocked: false }`. Lock = short-circuit to fully idle.
6. **Wire local voice transmit as a synthetic Brmble activity ping.** `MumbleAdapter` already raises events when the local user transmits (existing speaking indicator path). Plumb it into the React idle reducer as activity (same code path as a `keydown`).
7. **Polling layer**: the Feb plan says "MumbleAdapter polls UserStats every 30 s for each user in the channel." Add: stagger across waves if channel >30 users; only poll while connected and channel is non-empty; pause polling when local user is alone in channel.
8. **Default `windowsIdle.enabled = false`** is correct. Add a one-line settings hint: "Useful if you often Alt-Tab to other apps but want Brmble to know you're still at your PC." The Feb plan doesn't explain why a user would opt in.
9. **MSTest, not xUnit.** Per project convention, if we add tests they're MSTest.

### Revised architecture sketch

```
Frontend (React)                       C# Backend
─────────────────                      ─────────────────
useBrmbleIdle()                        IdleService (IService)
  └─ DOM events → lastActivityTs        ├─ VoiceIdleTracker
  └─ + voice.localTransmit ping         │   └─ receives UserStats responses
  └─ tick: now - lastActivityTs         │   └─ keeps {sessionId → idleSecs}
useIdleSettings()                       ├─ SystemIdleTracker
  └─ localStorage                       │   └─ GetLastInputInfo (32-bit safe)
useIdleStatus()                         │   └─ WM_WTSSESSION_CHANGE → isLocked
  └─ exposes voiceIdleSec per peer +    └─ pushes voice.idleUpdate
     self → drives Zzz icon                  { voiceIdle, systemIdle, isLocked }
useIdleActions()
  └─ AND(brmble, source) before        MumbleAdapter
     firing self-mute / leave-voice      ├─ override UserStats(): feed VoiceIdleTracker
  └─ isLocked → fully idle               ├─ poll timer: SendRequestUserStats per
                                         │  channel user, staggered, every 30s
                                         └─ on local transmit start: bridge.send(
                                              "voice.localTransmit")
```

### Final v1 spec (decisions locked 2026-05-03)

**Hardcoded behaviour, no settings UI:**

- **Single threshold: 10 minutes** for everything.
- **Auto leave-voice trigger:** while in a voice channel, fire `LeaveVoice()` when (`brmbleIdleSec ≥ 10 min` **AND** `systemIdleSec ≥ 10 min`) **OR** `isLocked === true`.
- **Skip the self-mute middle stage** from the Feb plan. Direct to leave-voice.
- **Toast on next interaction** after auto-kick: "Je bent uit voice gehaald na 10 min idle." Non-blocking, dismissible. Use `useNotificationQueue` + `<Notification>`.
- **Voice transmit by local user resets `brmbleIdleSec`** (synthetic activity ping from MumbleAdapter speaking-state event).

**Visual:**

- **Sidebar moon icon (`<Icon name="moon" />`)** next to every Mumble-connected user (peers + self) when their `voiceIdleSec > 10 min`. Driven by polled `UserStats.idlesecs`. Rendered via the existing `user-status-area` span in `ChannelTree.tsx` and the equivalent in root-users (`Sidebar.tsx`).
- **Hover tooltip on the moon** showing elapsed time. Format: `< 60 min` → "AFK voor 12 min"; `≥ 60 min` → "AFK voor 1u 23m"; `≥ 24 h` → "AFK voor 2 dagen". Use the existing `<UserTooltip>`/`<Tooltip>` infrastructure.
- **Tray icon moon overlay** when `systemIdleSec ≥ 10 min` OR `isLocked` — shown whether or not connected to voice. Two pre-rendered .ico files (`Resources/brmble.ico` + `Resources/brmble-idle.ico`); swap via `Shell_NotifyIcon(NIM_MODIFY)`.

**Polling:**

- Sweep `UserStats` for **every Mumble-connected user we render** (voice channels + root) every **30 s**. Stagger across waves if >30 users to stay under Mumble's ~1 control msg/s sustained limit.
- Pause polling when not connected.

**Out of scope for v1 (deferred):**

- Manual AFK toggle / button (leave-voice covers it).
- Settings UI for thresholds.
- Self-mute middle stage.
- Brmble-specific presence broadcast (Mumble `idlesecs` already covers peer-visible idle).
- Per-server settings.
- Idle for pure-Matrix DM contacts without a Mumble session.

**Why this is enough**

Anyone in voice who's stale-but-present gets a moon icon (peer-visible via `idlesecs`). Anyone fully AFK (10 min Brmble + 10 min OS, or locked) is auto-kicked from voice — their absence from the channel *is* the presence signal. The two-stage progression ("name + moon" → "name absent") covers what users need to see, with no broadcast layer required.

---

## Bibliography

### Mumble protocol & ecosystem
- [mumble-voip/mumble — `Mumble.proto`](https://github.com/mumble-voip/mumble/blob/master/src/Mumble.proto)
- [mumble-voip/mumble — `Messages.cpp`](https://github.com/mumble-voip/mumble/blob/master/src/murmur/Messages.cpp) (`MSG_SETUP`, `RATELIMIT`, `msgUserStats`)
- [mumble-voip/mumble — `Settings.h`](https://github.com/mumble-voip/mumble/blob/master/src/mumble/Settings.h) (`iIdleTime`, `iaeIdleAction`)
- [mumble-voip/mumble — `AudioInput.cpp`](https://github.com/mumble-voip/mumble/blob/master/src/mumble/AudioInput.cpp) (`tIdle` voice-silence trigger)
- [mumo `idlemove.ini`](https://github.com/mumble-voip/mumo/blob/master/modules-available/idlemove.ini) (10 s sweep, 1 h threshold, ref implementation)
- [Issue #1257 — AFK channel support](https://github.com/mumble-voip/mumble/issues/1257)
- [Issue #1858 — Red idle icons in new UI](https://github.com/mumble-voip/mumble/issues/1858)
- [Issue #2997 — Ping deafened users](https://github.com/mumble-voip/mumble/issues/2997)
- [Issue #3831 — UserStats-based bot idle](https://github.com/mumble-voip/mumble/issues/3831)
- [forums.mumble.info topic 1160](https://forums.mumble.info/topic/1160-moving-users-based-on-idle-time-issue/)
- Local: `lib/MumbleSharp/MumbleSharp/Packets/mumble.proto:567`, `BasicMumbleProtocol.cs:891-902`, `IMumbleProtocol.cs:201`, `TcpSocket.cs:277-279`

### Competitor presence systems
- [Discord Gateway Events docs](https://docs.discord.com/developers/events/gateway-events)
- [discord-api-types: GatewayPresenceUpdateData](https://discord-api-types.dev/api/discord-api-types-v10/interface/GatewayPresenceUpdateData)
- [Discord Support: Changing Online Status](https://support.discord.com/hc/en-us/articles/227779547-Changing-Online-Status)
- [Vencord CustomIdle](https://vencord.dev/plugins/CustomIdle), [DisableCallIdle](https://vencord.dev/plugins/DisableCallIdle)
- [Slack API: Presence and status](https://api.slack.com/apis/presence-and-status)
- [Microsoft: User presence in Teams](https://learn.microsoft.com/en-us/microsoftteams/presence-admins)
- [Synapse #3971 — Presence is increasingly heavy](https://github.com/matrix-org/synapse/issues/3971)
- [Patrick Cloke: Matrix Presence](https://patrick.cloke.us/posts/2023/12/15/matrix-presence/)
- [Zoom Attention Tracking deprecation KB](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069153)
- [SinusBot AFK mover (TeamSpeak ecosystem precedent)](https://forum.sinusbot.com/resources/afk-mover-away-mute-deaf-idle.179/)

### OS-level idle detection
- [GetLastInputInfo (learn.microsoft.com)](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo)
- [GetLastInputInfo wraparound Q&A](https://learn.microsoft.com/en-us/answers/questions/1254087/getlastinputinfo-is-being-used-to-find-idle-time-a)
- [WTSQuerySessionInformation](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsquerysessioninformationa)
- [SetThreadExecutionState](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate)
- [PH3 — Things you really should know about Windows Input](https://ph3at.github.io/posts/Windows-Input/)
- [Wayland `ext-idle-notify-v1`](https://wayland.app/protocols/ext-idle-notify-v1)
- [Page Visibility API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [WebView2 background throttling feedback (issue #3045)](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3045)

### Existing Brmble work (referenced)
- `docs/plans/2026-02-28-idle-status-design.md` (on `docs/idle-status-design` branch) — Feb design, mostly holds; revisions tracked above.
- `docs/plans/2026-02-28-idle-status-implementation.md` (on `docs/idle-status-design` branch) — Feb 14-task plan; needs the revisions in Part 5 before execution.
