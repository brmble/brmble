# Neon-D Reset Confirmation Design

## Goal

Prevent accidental loss of Neon-D game progress by requiring confirmation before the Reset action clears the current empire.

## Design

`NeonDGame` will wrap the existing `resetGame` handler in the shared themed `confirm()` flow. Clicking Reset opens a destructive confirmation with:

- Title: `Reset Neon-D empire?`
- Message: `Are you sure you want to reset your Neon-D empire? All progress will be lost.`
- Confirm label: `Reset`
- Cancel label: `Cancel`
- Destructive styling enabled

The game will call `resetGame()` only when the confirmation resolves to `true`. Canceling or dismissing the prompt leaves state unchanged. The browser-native `window.confirm()` API and a feature-specific modal are out of scope.

## Testing

Extend the Neon-D component tests to verify that clicking Reset opens the shared confirmation with the approved copy and does not reset before confirmation. Verify that confirming calls `resetGame()` and canceling does not.

## Scope

Only the Neon-D Reset interaction and its focused tests are changed. The game engine reset behavior, persistence format, and other reset actions remain unchanged.
