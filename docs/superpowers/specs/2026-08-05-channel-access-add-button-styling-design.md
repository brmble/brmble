# Channel Access Add Button Styling

## Goal

Make the `Add group` and `Add user` controls in the channel access panel read as interactive buttons and match the existing settings UI.

## Design

Apply the shared `btn btn-secondary btn-sm` classes to both controls. This gives them the established border, padding, typography, hover, focus, and disabled states without introducing a new component or stylesheet rule.

The controls keep their current labels, disabled conditions, and click handlers. The `Save access settings` control remains the panel's primary action.

## Verification

Extend the channel access panel test to assert that both add controls use the shared secondary small-button classes. Run that targeted test and the web build.
