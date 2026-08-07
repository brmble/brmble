# Neon-D Save Import/Export Design

## Goal

Allow players to move their Neon-D empire between browser profiles or installations using a portable save file, while protecting the current empire from malformed files and accidental replacement.

## Scope

- Add export and import actions to the Neon-D game header.
- Export the current in-memory `GameState` as a versioned JSON file.
- Import a JSON file through the browser file picker.
- Validate and normalize imported state before applying it.
- Confirm before replacing the current empire.
- Preserve the existing local-storage key and automatic persistence behavior.

Reset behavior, server APIs, and other games are out of scope.

## File format

The exported file is a UTF-8 JSON document with an envelope:

```json
{
  "format": "brmble-neon-d-save",
  "version": 1,
  "state": { }
}
```

The envelope identifies the game and leaves room for future migrations without confusing a Neon-D save with arbitrary JSON. The state payload contains the current `GameState`, including active and available dealers, production, progression, timers, and offline-earnings state.

The export filename is `brmble-neon-d-save.json`.

## Architecture and data flow

Keep file conversion separate from the React component:

1. A small save-format utility serializes the state into the versioned envelope.
2. The utility parses an unknown JSON value, checks the envelope and supported version, validates required state shape and value types, then applies the same defaults/migrations used for older local saves.
3. `useGameEngine` exposes an `importGame(state: GameState)` operation that replaces the active state, while export reads the already available current state; these operations do not change the game rules.
4. `NeonDGame` owns browser file-picker/download interactions and the replacement confirmation.
5. A successful import replaces React state and persists through the existing `usePersistedGameState` mechanism. A failed parse, validation, or file read leaves the current state untouched.

The import file input should be reset after each selection so choosing the same file again triggers a change event.

## User experience and error handling

- Export immediately downloads the current empire as `brmble-neon-d-save.json`.
- Import opens a file picker limited to JSON files.
- A valid file prompts: `Import this Neon-D save? Your current empire will be replaced.`
- Canceling the prompt makes no state change.
- Invalid JSON, the wrong game format, an unsupported version, or invalid state data shows a clear error and keeps the current empire.
- Importing must not reset transient UI state such as the currently open dealer-upgrade chooser unless the imported game data itself makes that chooser invalid; existing component effects may close it naturally.

Use the existing `confirm` prompt and the Neon-D component's existing inline status/error presentation (or the nearest established game error pattern) rather than introducing a new notification system.

## Testing

Add focused tests before implementation:

- Export produces the expected versioned envelope and filename/download payload.
- A valid exported save can be imported and restores representative progression data.
- Malformed JSON, wrong format, unsupported version, and invalid state are rejected without replacing the current state.
- Import cancellation does not replace the current state.
- Selecting the same file twice remains supported after a failed or completed import.

Run the focused Neon-D tests and the full web test suite/build as appropriate for the final change.

## Non-goals and compatibility

The existing `brmble_neon_d_save` local-storage data remains the source of truth for normal play. Imported files should use the current migration/default behavior so older valid state fields can continue to load, but no separate backwards-compatibility format is introduced beyond the versioned envelope.
