# Game Match Metadata (`metadata_json`)

Every completed match writes a **versioned JSON envelope** to the `metadata_json`
columns of `game_matches` and `game_match_participants`. Future game engines must
follow this shape so no schema change is needed per game. Pre-existing rows may
have `metadata_json = NULL`; readers must treat all fields as optional.

## Match-level (`game_matches.metadata_json`)

    {
      "schemaVersion": 1,
      "summary": { /* game-specific, or null */ }
    }

Per-channel stats do NOT live here — group by the `game_matches.channel_id`
column (a duel can only start between users in the same channel).

## Participant-level (`game_match_participants.metadata_json`)

    {
      "schemaVersion": 1,
      "displayName": "Alice",        // snapshot at match time (survives rename/leave)
      "<gameType>": { /* per-player game-specific stats, optional */ }
    }

Avatars are NOT snapshotted — resolve them live from the server / default icon.

## Deathroll

`summary`:

    { "startingCeiling": 100, "totalRolls": 7, "finalRoll": 1 }

`finalRoll` is `null` for abandoned/forfeited matches.

Participant `deathroll`:

    { "rolls": 4, "rollsAboveMid": 1, "rollsBelowMid": 3, "avgRollRatio": 0.41 }

- `rollsAboveMid` / `rollsBelowMid`: each roll compared to the midpoint of its
  own range (`value > ceiling / 2` counts as above).
- `avgRollRatio`: mean of `value / ceiling` (0–1), a ceiling-normalized luck
  measure. Timeout forced-losses are excluded from all per-player counters.

## Adding a new game

Implement `IGameEngine.MatchSummary` and `IGameEngine.ParticipantStats`
(both default to `null`). `GameSessionManager` merges in `schemaVersion` and the
`displayName` snapshot automatically. Store the per-player object under the
engine's `GameType` key.
