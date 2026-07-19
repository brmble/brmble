# Design: Server-Authoritative Mini-Game Framework & Stats

**Date:** 2026-07-19
**Status:** Approved (design phase)
**Branch:** `feature/minigame-framework`
**Related issues:** #275 (Battle system), #177 (lottery), #178 (`/roll`), #373 (Type Racer)

## Summary

Add a server-authoritative 1v1 mini-game framework to Brmble so users in the
same voice channel can challenge each other to duels. The server owns game
rules, state, and randomness; clients send intents and render state. Completed
matches are persisted with enough detail to power per-user and head-to-head
stats, sliceable by week / month / all-time, and extensible to 3+ player games
later.

First game: **Deathrolling** (turn-based, server-generated rolls). Second game:
**Rock-Paper-Scissors** (simultaneous sealed commit). These two interaction
patterns cover almost every future game (type racer, reaction time, trivia,
etc.). Tic-tac-toe was explicitly rejected (solved draw, poor fit for gamers).

## Goals

- Server-authoritative, cheat-resistant 1v1 games with trustworthy stats.
- Reuse existing identity (mTLS cert-hash → `users.id`), transport (NativeBridge
  + `/ws` + `IBrmbleEventBus`), and persistence (Dapper + SQLite) — no new infra.
- Only Brmble clients (not plain Mumble/OG clients) can play; enforced server-side.
- Persist a full match log + participants so stats can be sliced by time window,
  support placements (2nd/3rd), and derive streaks/rivals without schema changes.
- Announce results to the whole voice channel (Matrix system message) for spectators.

## Non-Goals (this release)

- Real-time / latency-sensitive games (reaction time, live type-racer progress).
- 3+ player / team matches (schema supports them; no engine ships for them yet).
- ELO / ranked ladders (schema leaves room via an optional future table).
- Client-authoritative or Matrix-event-carried game state (explicitly rejected —
  spoofable, contradicts server authority).

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Source of truth | Server-authoritative | Trustworthy stats, cheat resistance |
| Match formats (now) | 1v1 turn-based | Matches stated stats goal; simplest |
| Game logic location | C# engines in `Brmble.Server` | Consistent with IService/Dapper patterns |
| Transport | Existing bridge + `/ws` + mTLS | No duplicate identity/infra |
| Persistence | Full match log + aggregate cache | Enables windowed/streak/rival stats |
| Multiplayer/placement | match + participants split | Future-proofs 3+ players & 2nd place |
| Result visibility | Matrix system msg to channel room | Spectators, matches #275/#177/#178 UX |
| Initial games | Deathroll, then RPS | Prove turn-based + simultaneous-commit |

## Architecture

Three layers, all on existing plumbing:

```
Web (React)  --game.* bridge-->  Client GameService (C#)  --mTLS REST-->  Brmble.Server/Games
     ^                                   ^                                      |
     |  game.* bridge events             |  re-emit /ws game events             | /ws via IBrmbleEventBus
     +-----------------------------------+--------------------------------------+
                                                                                |
                                       Matrix channel announcement (MatrixService) for spectators
```

Identity uses existing `users.id` (cert-hash anchored). Live match state is
in-memory (`GameSessionManager`); only completed matches are persisted. A server
restart abandons live matches (acceptable for short turn-based minigames).

### Server engine abstraction (`Brmble.Server/Games/`)

`IGameEngine` — per-game rules; declares its interaction model so RPS and later
real-time/multiplayer games are not precluded:

- `GameType` — e.g. `"deathroll"`.
- `InteractionModel` — `AlternatingTurns` | `SimultaneousCommit` (room for `RealTime`).
- `InitialState(players, IRandomSource)` → opaque game state.
- `ValidateAction(state, userId, action)` → ok / illegal.
- `ApplyAction(state, userId, action, IRandomSource)` → new state (+ events, e.g. "rolled 42").
- `GetOutcome(state)` → InProgress | Finished(placements[], scores, metadata).
- `PublicView(state, forUserId)` → per-player view (hides opponent's sealed pick until reveal).

`IRandomSource` — shared server-authoritative, crypto-backed RNG primitive.
Deathroll uses it for every roll; reusable by `/roll` (#178) and lottery (#177)
later. Seedable in tests for deterministic engine tests.

`GameSessionManager` (singleton, in-memory) — invite/accept/decline, one active
match per user, enforces both players are Brmble clients in the **same voice
channel** (via `SessionMappingService`), drives turns, applies actions through
the engine, and on finish writes match + participants + aggregate cache in one
Dapper transaction, then fires the Matrix channel announcement.

## Data Model (SQLite, Dapper, added in `Data/Database.cs` `Initialize()`)

Format-agnostic match + participants split so 1v1 and future 3+ player / placement
games share one schema.

**`game_matches`**
- `id` INTEGER PK
- `game_type` TEXT (`'deathroll'`, `'rps'`, …)
- `channel_id` INTEGER (Mumble channel the match happened in)
- `format` TEXT (`'1v1'` / `'ffa'` / …)
- `outcome` TEXT (`'decided'` / `'draw'` / `'abandoned'`)
- `abandon_reason` TEXT NULL (`'forfeit'` / `'disconnect'` / `'left_channel'`; set when `outcome = 'abandoned'`)
- `started_at`, `ended_at` (timestamps)
- `duration_ms` INTEGER
- `metadata_json` TEXT NULL (per-game extras)

**`game_match_participants`** (one row per player per match)
- `match_id` INTEGER → `game_matches.id`
- `user_id` INTEGER → `users.id`
- `placement` INTEGER (1 = winner, 2 = second, …; ties share a placement)
- `score` INTEGER NULL (game-defined: final roll, RPS rounds won, WPM, …)
- `result` TEXT (`'win'` / `'loss'` / `'draw'` / `'abandoned'`)
- `metadata_json` TEXT NULL (per-player game extras, e.g. accuracy)
- PK (`match_id`, `user_id`)

Abandoned matches (forfeit, disconnect, or leaving the channel) are **recorded**,
not discarded. The participant who caused the abandonment gets `result =
'abandoned'`; the reason is captured in `game_matches.abandon_reason`. This makes
rage-quits and disconnect patterns visible in stats.

**`game_user_stats`** (lifetime aggregate cache; all-time view only)
- `user_id`, `game_type` (composite PK), `wins`, `losses`, `draws`,
  `abandons`, `games_played`, `updated_at`

**`game_head_to_head`** (lifetime per-pair aggregate cache)
- `player_low_id`, `player_high_id`, `game_type` (composite PK; canonical
  `low < high` ordering like `dm_room_map`), `low_wins`, `high_wins`, `draws`,
  `updated_at`

Indexes: `game_matches(ended_at)`, `game_matches(game_type)`,
`game_match_participants(user_id)`, `game_match_participants(match_id)`.

### Stats derivation

- **Source of truth** = `game_matches` + `game_match_participants` (retained).
- Lifetime aggregate tables are a **read-cache for the all-time view only**,
  updated in the same transaction as the match insert (never drift).
- **Windowed (week/month/all-time), streak, nemesis/rival, head-to-head,
  leaderboards, activity heatmap** are computed **on-demand** from the indexed
  match log. Volume is low (voice-channel minigames), so no pre-aggregation
  beyond the lifetime cache is needed.
- Game-flavor stats (longest deathroll survival, unluckiest early 1, biggest
  starting roll, type-racer best WPM/accuracy) come from `score` + `metadata_json`.
- ELO/skill ratings are out of scope now; if added later, a `game_ratings`
  table updated per match slots in without touching the log schema.

## Message Protocol

New `game.*` bridge namespace (distinct from the existing single `game.toggle`
used by NeonD). Intents go Web → bridge → Client → server over mTLS REST; events
come back server → `/ws` → Client → bridge → Web.

| Step | Web → server (intent) | Server → Web (event) |
|---|---|---|
| Challenge | `game.invite {targetUserId, gameType}` | `game.invited {matchId, from, gameType}` (to target) |
| Respond | `game.respond {matchId, accept}` | `game.started {matchId, players, firstTurn, view}` or `game.declined` |
| Play | `game.action {matchId, action}` (e.g. `{roll:true}`) | `game.stateUpdated {matchId, view, whoseTurn, lastEvent}` |
| End | — | `game.ended {matchId, placements, winnerId, scores}` + Matrix system msg to channel |
| Quit/disconnect | `game.forfeit {matchId}` | `game.ended {outcome:'abandoned', reason}` |

Guardrails: 30s invite timeout; per-turn timeout with escalating penalty (see
Deathrolling Turn Timeout below); one active match per user; both players must
remain in the same voice channel (leaving = forfeit). No slash commands in this
release — invites are initiated from UI only.

### Deathrolling Turn Timeout & Penalty

Instead of an immediate auto-forfeit, a slow player is penalised progressively so
the game still resolves without letting anyone stall indefinitely:

- Each turn the active player has **15 seconds** to roll.
- If they do not roll within 15s, their **roll ceiling** (the current number they
  must roll under) is reduced by **X%** (configurable, default 20%), rounded down.
- Every additional **5 seconds** without a roll reduces the ceiling by another X%.
- This repeats until the player either rolls (against the reduced ceiling) or the
  ceiling reaches **1**, at which point they are forced to roll a `1` and **lose**.
- The server owns these timers and the ceiling reduction (authoritative); each
  reduction emits a `game.stateUpdated` so both clients see the shrinking ceiling
  and a visible countdown.
- Timeout-driven losses are recorded as a normal `'decided'` outcome (the player
  genuinely lost), not `'abandoned'`.

## Components / File Plan

**Server `Brmble.Server/Games/`**: `IGameEngine.cs`, `IRandomSource.cs`,
`CryptoRandomSource.cs`, `GameSessionManager.cs`, `GameRepository.cs`,
`GameStatsService.cs` (windowed/streak/rival queries), `GameEndpoints.cs`,
`Engines/DeathrollEngine.cs`, later `Engines/RpsEngine.cs`, `GamesExtensions.cs`
(DI). Schema in `Data/Database.cs`. Result announcement via existing
`MatrixService`. `/ws` events via `IBrmbleEventBus`. Register in `Program.cs`.

**Client `Brmble.Client/Services/Games/GameService.cs`** (`IService`,
`ServiceName = "games"`) — forwards `game.*` intents to the server over mTLS
(pattern from `ChannelRequestBridgeHandler`), re-emits `/ws` game events over the
bridge. Registered in `Program.cs`.

**Web `Brmble.Web/src/`**: `api/games.ts` (bridge-tunneled with browser `fetch`
fallback), `components/Games/` (invite entry from existing user row/tooltip,
Deathroll board, invite `<Notification>` via `useNotificationQueue`),
`components/Profile/` stats view. All UI per `docs/UI_GUIDE.md` (design tokens
only, no new toast system); read the guide before any UI work.

## Testing

- `DeathrollEngine` unit tests: rules, turn order, win detection, deterministic
  RNG via seeded `IRandomSource`.
- `GameRepository` / `GameStatsService` tests (`Brmble.Server.Tests`): match +
  participants insert, aggregate cache correctness, windowed/streak/head-to-head
  queries.
- `GameSessionManager` lifecycle tests: invite/accept/decline, one-match-per-user,
  same-channel + Brmble-only enforcement, forfeit/timeout paths.

## Build Order

1. Schema + `GameRepository` + `GameStatsService`.
2. `IGameEngine` + `IRandomSource` + `DeathrollEngine` (TDD).
3. `GameSessionManager` + `GameEndpoints` + `/ws` events.
4. Client `GameService`.
5. Web UI (Deathroll board, invite flow) + profile stats view.
6. `RpsEngine` as the second engine, proving the abstraction.

## Error Handling & Edge Cases

- Non-Brmble target, target not in same voice channel, target already in a match,
  self-challenge → invite rejected with reason.
- Invite timeout → invite expires, no match recorded.
- Turn timeout (Deathrolling) → escalating ceiling penalty, ultimately a normal
  `'decided'` loss (not abandoned); see Deathrolling Turn Timeout above.
- Player forfeits, disconnects, or leaves the voice channel mid-match → match
  ends `'abandoned'` and **is recorded** with `abandon_reason`
  (`forfeit`/`disconnect`/`left_channel`); the abandoning player's participant
  `result = 'abandoned'` and the other player is treated as the winner for
  head-to-head purposes. Abandons are tracked in `game_user_stats.abandons` so
  quit/disconnect behaviour is visible.
- Server restart → in-memory live matches lost; on restart any match still live
  is closed as `'abandoned'` (`reason = 'disconnect'`) if it can be reconciled,
  else simply not persisted. Persisted history is unaffected.
- Illegal/duplicate/out-of-turn actions → rejected by engine, state unchanged.
