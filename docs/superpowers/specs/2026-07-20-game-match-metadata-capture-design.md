# Design: Game Match Metadata Capture

**Date:** 2026-07-20
**Status:** Approved
**Branch:** `feature/minigame-framework`

## Summary

Ensure that everything a future stats UI will need is **persisted at match
time**, so the later panels (server-wide rankings, per-channel rankings,
head-to-head, per-user settings stats) can be built with **zero irrecoverable
data gaps**. This PR is **server-side data capture only** — no read queries, no
endpoints, no UI. It populates the already-existing (but currently unused)
`metadata_json` columns on `game_matches` and `game_match_participants` with a
documented, versioned shape, including identity snapshots and Deathroll
per-player luck stats.

## Goals

- Capture per-match and per-participant detail that **cannot be reconstructed
  later** if not written now (identity labels at the time of play; in-match
  Deathroll stats).
- Establish a **versioned `metadata_json` convention** so future games (RPS,
  etc.) slot in without schema changes.
- Snapshot **participant display name** at match time so departed/renamed users
  keep accurate historical labels.
- Capture Deathroll summary + per-player "luck" metrics.
- Support **per-channel** stats via the `channel_id` already stored on every
  `game_matches` row (a duel can only start between users in the same channel,
  so `match.ChannelId` is fixed at invite time). The channel's *display name* is
  resolved live by the future panel — not snapshotted (there is no cheap
  channelId→name lookup in the game path).

## Non-Goals (YAGNI)

- **No UI / panels.** Server rankings, channel rankings, head-to-head, and the
  settings stats tabs are a **future PR**.
- **No new read queries, services, or endpoints.**
- **No new tables.** Aggregate tables (`game_user_stats`, `game_head_to_head`)
  stay recomputable from raw rows.
- **No `game_head_to_head.channel_id` column.** Per-channel head-to-head is
  computable later from raw `game_matches` (which already carries `channel_id`)
  + `game_match_participants`.
- **No new index** (e.g. on `game_matches.channel_id`). That is a
  read-performance concern that belongs in the future panel PR.
- **No avatar snapshot.** Avatars can be resolved live from the server / default
  to the game icon.
- **No channel-name snapshot.** Per-channel grouping uses the `channel_id`
  already on `game_matches`; the channel's display name is resolved live later.
- **No full roll-by-roll sequence** for Deathroll — summary + aggregate luck
  counters only.

## What is already sufficient (unchanged)

- `game_matches` already stores `channel_id`, `game_type`, `format`, `outcome`,
  `abandon_reason`, `started_at`, `ended_at`, `duration_ms`.
- `game_match_participants` already stores `user_id`, `placement`, `score`,
  `result`.
- Both `CompletedMatch` and `CompletedParticipant`
  (`GameMatchModels.cs`) already have a nullable `MetadataJson` field, and
  `GameRepository.SaveCompletedMatchAsync` already writes it. **The plumbing
  exists; it is simply never populated today.**

## Metadata convention (versioned)

All game `metadata_json` follows this documented shape. `schemaVersion` starts
at `1`.

### Match-level — `game_matches.metadata_json`

```json
{
  "schemaVersion": 1,
  "summary": { /* game-specific, see below */ }
}
```

- `summary` — game-specific match-level rollup.
- Per-channel stats do **not** live here — they use the existing
  `game_matches.channel_id` column.

### Participant-level — `game_match_participants.metadata_json`

```json
{
  "schemaVersion": 1,
  "displayName": "Alice",
  "deathroll": { /* game-specific per-player stats, key = gameType */ }
}
```

- `displayName` — snapshot of the participant's display name at match time.
- A game-specific object keyed by `gameType` (e.g. `deathroll`) holds
  per-player stats. Future games add their own key; no schema change.

## Deathroll fields

### Match summary (`summary`)

- `startingCeiling` — the ceiling the match began at (currently 100).
- `totalRolls` — total number of actual rolls across both players.
- `finalRoll` — the fatal roll value (the roll of 1, or a forced-loss `1`).

### Per-player (`deathroll`)

- `rolls` — number of actual rolls this player made.
- `rollsAboveMid` — count of this player's rolls strictly above the midpoint of
  that roll's range (`value > ceiling / 2`).
- `rollsBelowMid` — count at or below the midpoint (`value <= ceiling / 2`).
- `avgRollRatio` — mean of `value / ceiling` over this player's rolls (0–1);
  a ceiling-normalized "luck" measure supporting "rolled above/below average".

Notes:
- Only **actual rolls** (`DoRoll`) count toward luck stats. A **timeout
  forced-loss** (`ApplyTimeoutPenalty` reducing the ceiling to ≤1) is not a
  roll and is excluded from `rolls`/`rollsAboveMid`/`rollsBelowMid`/
  `avgRollRatio`, but a forced loss still contributes `finalRoll = 1` and the
  losing placement/result as today.

## Implementation

### 1. `DeathrollEngine` — accumulate counters in `State`

The engine keeps no history today (`Ceiling`, `LastRoll`, `LoserId`,
`CurrentIndex`). Add per-match accumulators to `State` (no full sequence):

- `int StartingCeiling` (captured from the initial ceiling).
- `int TotalRolls`.
- Per-player counters keyed by `UserId`: `rolls`, `rollsAboveMid`,
  `rollsBelowMid`, and a running sum of `value / ceiling` (to derive
  `avgRollRatio` at completion).

Increment these inside `DoRoll` at the point the roll value is known (midpoint
compared against the **pre-roll** `ceiling`, i.e. `s.Ceiling` before it is
reassigned).

### 2. `IGameEngine` — expose metadata (engine owns game-specific shape)

Add two optional-by-default members so non-Deathroll engines need no work:

- `object? MatchSummary(object state)` → match-level `summary` object (or null).
- `object? ParticipantStats(object state, long userId)` → the per-player
  game-specific object (or null).

`DeathrollEngine` implements both from its accumulators. Other engines return
`null` (or the interface provides default `null` implementations).

Identity (`displayName`, `channelName`) is **not** the engine's concern — the
engine has no name knowledge. It is merged in by the session layer.

### 3. `GameSessionManager` — compose the versioned envelope

At completion (`CompleteMatchAsync`) and forfeit (`ForfeitAsync`):

- Build match `metadata_json`:
  `{ schemaVersion: 1, summary: engine.MatchSummary(state) }`.
- For each participant, build
  `{ schemaVersion: 1, displayName: <NameOf(userId)>,
     [gameType]: engine.ParticipantStats(state, userId) }`.
- Serialize with `System.Text.Json` and set `MetadataJson` on the
  `CompletedMatch` / `CompletedParticipant` records before calling the
  repository. (Reuse the existing `NameOf` helper for display names.)

### 4. `GameRepository` — no change

`SaveCompletedMatchAsync` already persists `MetadataJson` for match + each
participant. No change beyond confirming it round-trips the populated values.

## Testing (MSTest)

- **DeathrollEngine:** given a scripted `IRandomSource`, assert `MatchSummary`
  (`startingCeiling`, `totalRolls`, `finalRoll`) and per-player
  `ParticipantStats` (`rolls`, `rollsAboveMid`, `rollsBelowMid`,
  `avgRollRatio`) for a normal game and a timeout forced-loss (forced loss
  excluded from luck counters; `finalRoll == 1`).
- **GameSessionManager:** assert the composed `CompletedMatch.MetadataJson`
  contains `schemaVersion` and `summary`, and each participant's `MetadataJson`
  contains `schemaVersion`, `displayName`, and the `deathroll` block — for both
  the completed and forfeited paths.
- **GameRepository:** assert the populated `MetadataJson` round-trips (write →
  read) for match and participants.

## Docs

- Document the versioned `metadata_json` convention (envelope shape,
  `schemaVersion`, identity snapshots, per-game key, Deathroll fields) in a new
  dedicated **`docs/games-metadata.md`** so future engine authors and the
  future stats-panel builders share one findable source of truth. No
  `UI_GUIDE.md` change — this PR adds no UI.

## Rollout notes

- Server change → requires
  `docker compose -f docker-local/docker-compose.yml up -d --build brmble` and
  worktree sync at the end. No web build (no web changes).
- Purely additive: old matches simply have `metadata_json = null`; future read
  code must treat metadata as optional/absent for pre-migration rows.
