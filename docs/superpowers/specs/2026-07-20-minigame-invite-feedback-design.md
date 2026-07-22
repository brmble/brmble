# Design: Mini-Game Invite Feedback, Fixed-Duration Invite & Block Setting

**Date:** 2026-07-20
**Status:** Approved (design phase)
**Branch:** `feature/minigame-framework`
**Builds on:** `docs/superpowers/specs/2026-07-19-minigame-framework-design.md`

## Summary

Three related improvements to the server-authoritative Deathroll mini-game:

1. **Challenger feedback on invite outcomes.** Today when the challenged person
   dismisses an invite (× / auto-dismiss) the challenger is never told anything.
   Give the challenger three *distinct* outcomes: **declined** (× pressed),
   **no response / AFK** (invite timed out), and **blocked** (recipient blocks
   all challenges).
2. **Fixed-duration invite notification.** The incoming-challenge notification
   currently uses `status="info"` with no explicit duration, so it inherits the
   info default (5000ms auto-dismiss + `pauseOnHover`). It auto-dismisses after
   5s and, on dismiss, silently declines. Make it a fixed ~30s window matching
   the server invite timeout, with **no** hover extension.
3. **"Block all challenges" user setting.** Server-authoritative per-user flag;
   when a blocked user is challenged, the challenger is told the person isn't
   accepting challenges.

## Goals

- Challenger always gets clear, role-aware, named feedback for every invite
  outcome (declined / no response / blocked).
- Incoming invite stays visible for the full server invite window (30s) and does
  not extend on hover; the server authoritatively removes it at timeout.
- Distinguish explicit decline (×) from timeout (AFK) from block — three
  distinct `info` notifications.
- Block setting is server-authoritative (cannot be spoofed by a modified client)
  and follows the existing `companion_id` per-user column pattern.
- Reuse existing UI patterns per `docs/UI_GUIDE.md`; no new toast system.

## Non-Goals

- Broadcasting the block flag to other clients (only affects *future* invites →
  YAGNI; read server-side at invite time).
- Blocking specific users / allow-lists (single global on/off only this release).
- Changing any game rules, turn timers, or persistence schema.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Invite duration | `duration={null}` (no client timer); server removes at 30s via `game.expired` | Matches server `InviteTimeout`; no hover-extend; server-authoritative |
| Decline vs timeout | Split into `game.declined` (explicit ×) vs new `game.expired` (30s) | Currently indistinguishable; challenger needs distinct feedback |
| Block storage | New `challenges_blocked` bool column on `users` | Mirrors `companion_id`; server-authoritative, cheat-resistant |
| Block broadcast | None | Only affects future invites; read at invite time |
| Outcome feedback | Three distinct `info` notifications, single replaceable queue id `game-outcome` | UI_GUIDE: replaceable notifications unregister prior id |
| Settings location | New "Games" settings tab; move Deathroll stats here from Profile | User choice; groups game concerns |

## Server Changes (`Brmble.Server`)

### Decline vs expiry split
`GameSessionManager.DeclineOrExpireAsync` (~line 189) currently emits a single
`game.declined` to both players. Split:
- **Explicit decline** (recipient sends `game.respond {accept:false}`, i.e. ×):
  emit `game.declined` — carries challenger-facing role info.
- **Timeout** (30s `InviteTimeout` elapses, `GameSessionManager.cs:32`): emit new
  `game.expired` to both players. This also drives client removal of the invite
  notification (so the client uses `duration={null}` and never times out on its
  own).

### Block flag
- `Data/Database.cs`: add `challenges_blocked` INTEGER (0/1) column on `users` +
  runtime `ALTER TABLE` migration (pattern at ~lines 145-167).
- `Auth/UserRepository.cs`: add `GetChallengesBlocked` / `SetChallengesBlocked`
  (companion pattern at 135-152).
- `Auth/AuthEndpoints.cs` (88-101) + `Handlers/SessionMappingHandler.cs` (34-56):
  read the flag on connect into `SessionMapping`.
- `IGamePresence` (in `GameSessionManager.cs`) + `SessionMappingGamePresence.cs`:
  expose `ChallengesBlocked(session)`.
- `GameSessionManager.InviteAsync`: if the target is blocked, do not create a
  match; return an `InviteResult` with a **Blocked** reason discriminator.
- `InviteResult` record: add a reason discriminator so the endpoint can surface
  `Blocked` distinctly from other rejections (not in a match, not same channel, etc).

### Settings endpoints
`Games/GameEndpoints.cs`:
- `GET /games/settings` → `{ challengesBlocked: bool }` (identity from cert).
- `POST /games/settings {challengesBlocked}` → persists via `UserRepository`.

## Client Changes (`Brmble.Client`)

`GameService` re-emits the new `game.expired` event over the bridge (same pattern
as existing `game.declined`). Settings endpoints are tunnelled through the
existing bridge REST forwarder — no new client logic beyond passthrough.

## Web Changes (`Brmble.Web`)

### Invite notification (`App.tsx` ~line 4340)
- Change the `game-invite` `<Notification>` to `duration={null}` (no client timer
  → nothing to hover-extend). `×` still calls `declineInvite()` (explicit decline).
- Server removes it at 30s via `game.expired`, handled in `useGameState`.

### Challenger feedback (`components/Games/useGameState.ts`)
- Add `outgoingInvite { matchId, targetSession }` state, set on `invite()` success,
  cleared on any outcome.
- Split `handleDeclined` (explicit decline) and add `handleExpired` (timeout);
  each is **role-aware** (only the challenger shows outcome feedback; the recipient
  just clears state).
- `invite()` handles the `Blocked` reason from the server and shows the blocked
  outcome.
- Three role-aware `info` notifications via `useNotificationQueue`, single
  replaceable id `game-outcome` (unregister prior before registering next):
  - Declined → **"Challenge declined"** (with challenged user's name)
  - Timeout → **"No response"**
  - Blocked → **"Challenge blocked"** (isn't accepting challenges)

### Games settings tab
- `components/SettingsModal/SettingsModal.tsx`: add `'games'` tab — three edits:
  the two `initialTab`/`activeTab` string-union types (~47 & ~118), the tab
  `<button>` list (~434-486), and the content render block (~488-542).
- **New** `components/SettingsModal/GamesSettingsTab.tsx`:
  - Server-backed "Block all challenges" toggle (reuses the `settings-toggle`
    row pattern from `MessagesSettingsTab.tsx:125-135`), reading/writing via new
    `/games/settings` calls added to `api/games.ts`. NOT part of the client
    `AppSettings` blob.
  - `<GameStats gameType="deathroll" />` moved here (self-contained component).
- `components/SettingsModal/ProfileSettingsTab.tsx`: remove the Deathroll stats
  block (lines 314-318) and the now-unused `GameStats` import (line 11).
- `api/games.ts`: add `getGameSettings()` / `setGameSettings()`.

## Testing

- **MSTest** (`Brmble.Server.Tests`, `[TestClass]`/`[TestMethod]`/`Assert.*`):
  - `GameSessionManagerTests`: extend `FakePresence` with a blocked flag; assert
    inviting a blocked user returns the `Blocked` reason and creates no match.
  - Decline vs expiry: assert explicit decline emits `game.declined`, timeout
    emits `game.expired`.
- **Web**: a ≥4-event repeated-event test for the `game-outcome` top-right
  notification (per UI_GUIDE), verifying replaceable id unregisters prior.

## UI_GUIDE Updates (same branch)

Update the Minigame Invite Pattern section for: fixed-duration (`duration={null}`)
invite removed server-side; the three distinct outcome notifications and their
wording; the new "Games" settings tab and the relocated Deathroll stats.

## Error Handling & Edge Cases

- Self-block irrelevant (block only affects incoming invites).
- Blocked target: no match created, no invite notification sent to target;
  challenger sees "Challenge blocked".
- Simultaneous decline + timeout race: server resolves once (whichever fires
  first); the loser path is a no-op (match already gone).
- Recipient disconnects during a pending invite: falls through to timeout →
  `game.expired`.
- `challenges_blocked` migration must be idempotent (column-exists guard, like
  existing migrations).

## Build Order

1. Server: `challenges_blocked` column + migration + `UserRepository` + presence
   plumbing (TDD).
2. Server: `InviteAsync` block check + `InviteResult` reason + decline/expiry
   split + `game.expired` event.
3. Server: `GET/POST /games/settings`.
4. Client: `GameService` passthrough for `game.expired`.
5. Web: `api/games.ts` settings calls; `useGameState` `outgoingInvite` +
   handlers + notifications; `App.tsx` `duration={null}`.
6. Web: Games settings tab + move stats out of Profile.
7. UI_GUIDE update.
