# RPS AFK Draw + Unsupported-Game Handling — Design

Date: 2026-07-23
Branch: `feature/rps-minigame-and-stats`

## Problem

Two gaps surfaced during two-client testing of the Rock Paper Scissors minigame:

1. **Mutual-AFK matches never end.** RPS uses `InteractionModel.SimultaneousCommit`
   with a 15s server-side `TurnTimer`. When *both* players fail to pick,
   `RpsEngine.ResolveRound` treats it as a round-level tie and replays the *same*
   round number. `RoundWins` never increments, `WinnerId` is never set, and
   `GetOutcome` stays `InProgress` forever. The 15s timer keeps re-arming, so a
   fully-idle match loops indefinitely — holding the one-duel-per-channel slot and
   blocking everyone else in the channel from starting a game.

2. **Challenging a client that lacks the chosen game.** There is no capability or
   version handshake anywhere (client↔server or client↔client). The server only
   validates that *it* knows the `gameType`; it never checks the target client. A
   client that doesn't recognise a `gameType` stores the invite without validation
   and its modal switch (`App.tsx`) falls through to the wrong `DeathrollModal`
   rather than refusing the game.

## Decisions

- **AFK draw trigger:** end the match as a draw after **2 consecutive** rounds
  where *neither* player picks. A single pick by either player resets the streak.
- **Draw recording:** a real draw — persist both participants as `Result: "draw"`,
  `CompletedMatch.Outcome: "draw"`, count it in head-to-head stats, and show a draw
  end-state in the feed and modal.
- **Unsupported game:** **client-side auto-decline only.** RPS is unreleased and
  clients auto-update, so there are effectively no old clients in the wild. This is
  forward-compat insurance for future game types, not retroactive protection.
  (Server-side capability gating was considered and rejected as unnecessary for the
  current deployment reality; noted as a possible future enhancement.)

## Part 1 — Forced draw on mutual AFK (RPS)

### Engine — `src/Brmble.Server/Games/Engines/RpsEngine.cs`

- Add two `State` fields:
  - `int ConsecutiveDoubleTimeouts` — count of back-to-back rounds where both
    players were idle at timeout.
  - `bool Drawn` — match ended in a draw.
- In `ResolveRound`:
  - **Both idle on timeout** (`p0 is null && p1 is null`): increment
    `ConsecutiveDoubleTimeouts`. If it reaches `2`, set `Drawn = true`. Otherwise
    keep the existing behaviour (tie, replay the same round number).
  - **Every other branch** (at least one player picked, whether decisive or a
    matched-throw tie): reset `ConsecutiveDoubleTimeouts = 0`. A single pick breaks
    the idle streak.
- `GetOutcome`: if `Drawn`, return `GameOutcome.Finished` with **both**
  participants `Placement: 1`, `Result: "draw"`, `Score = RoundWins[idx]`.
  Otherwise unchanged.
- `EndFeedLine`: add a draw branch. Keep WebView2-safe glyphs only (reuse the
  existing `✊✋✌️` set — 🤝 is unverified in the WebView2 font). Example:
  `✊✋✌️ {a} vs {b} — Rock Paper Scissors ended in a draw (both idle)`.

The counter reaching 2 on a double-timeout ends the match **regardless of the
current round score** — this is an anti-grief measure for stalled/idle matches and
matches the "2nd time both don't choose" rule directly.

### Match completion — `src/Brmble.Server/Games/GameSessionManager.cs`

`CompleteMatchAsync` currently hardcodes `Outcome: "decided"` and derives
`winner = Participants.First(p => p.Placement == 1)`. Change to derive from the
participants so draws flow through the existing persistence path:

- `isDraw = outcome.Participants.All(p => p.Result == "draw")`
- `CompletedMatch.Outcome: isDraw ? "draw" : "decided"`
- `winner = isDraw ? null : outcome.Participants.FirstOrDefault(p => p.Placement == 1)`
- Add `draw = isDraw` to the `game.ended` payload so the client is explicit rather
  than inferring a draw from a null `winnerId` (which also occurs in other paths).
- Draw feed fallback if `EndFeedLine` returns null.

No new timer wiring is needed: `HandleTurnTimeoutAsync` already re-checks
`GetOutcome` after `ApplyTimeoutPenalty`, so once `Drawn` flips the outcome to
`Finished`, the match completes and the channel/`duelState` badge clears normally.

### Client — `src/Brmble.Web`

- `useGameState.ts` `handleEnded`: carry the `draw` flag (and/or treat null
  `winnerId` on a non-abandoned end as a draw).
- `RpsModal.tsx`: render a "Draw" end banner when the match drew, instead of
  win/loss. Respect the existing 3-2-1 reveal gating (the final double-timeout still
  produces a `roundResult` before `game.ended`).
- Head-to-head already surfaces `Draws` from `UserGameStats`; verify the RPS H2H
  panel shows the draw. No stats-schema change.

## Part 2 — Client-side auto-decline for unsupported games

Purely forward-compat. In `src/Brmble.Web/src/components/Games/useGameState.ts`
`handleInvited`:

- Define `SUPPORTED_GAMES = ['deathroll', 'rps']` (single source of truth for the
  client's known game types).
- If an incoming invite's `gameType` is not in `SUPPORTED_GAMES`:
  - Do **not** store `incoming` or open a modal.
  - Immediately decline via the existing path (`gamesApi.respond(matchId,
    accept: false)`).
  - Optionally surface a low-key receiver-side notification: "Received an
    unsupported game — auto-declined; you may need to update."
- The inviter receives the standard `game.declined`. A friendlier "their client
  doesn't support this game" reason would require a server relay and is out of
  scope; noted as a possible later enhancement.

## Testing

### Server (`tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`)

- Two consecutive both-timeouts end the match: `game.ended` carries `draw: true`
  and null `winnerId`; persisted `CompletedMatch.Outcome == "draw"` with both
  participants `Result == "draw"`.
- A pick by one player between two timeouts resets the streak (no premature draw;
  the match continues).
- Draw is recorded in head-to-head/`UserGameStats` as a draw for both players.

The test harness uses `HalvingRandom` and `FakePublisher`; timeouts are driven via
the existing `ExpireInviteForTestAsync`-style helpers / `HandleTurnTimeout` path —
confirm/extend a test hook to fire a turn timeout deterministically.

### Client

- No Games component tests exist today. Keep changes minimal; rely on
  `uiGuideCompliance.test.ts` (no new emoji/glyphs in component code) plus a manual
  two-client check: (a) both players idle → match draws and clears the channel;
  (b) auto-decline path when handed an unknown `gameType`.

## Out of scope

- Server-side capability/version handshake (rejected for current deployment).
- Forwarding a decline reason to the inviter for unsupported games.
- Match-level draws for Deathroll (not applicable to its rules).
