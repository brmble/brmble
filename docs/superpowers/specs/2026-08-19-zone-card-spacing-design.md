# Zone Card Spacing Design

## Goal

Increase the visual separation between zone cards in the Neon-D distribution panel while leaving legacy distribution-card spacing unchanged.

## Design

Give the zone-card list its own wrapper class, `zoneCardStack`, instead of reusing the shared `cardStack` spacing. Set the new wrapper's grid gap to `var(--space-sm)`, one spacing step larger than the current `var(--space-xs)`.

The existing shared `cardStack` remains unchanged so non-zone distribution cards keep their current layout. No game behavior, state, accessibility semantics, or card contents change.

## Verification

Run the focused Neon-D frontend test suite or the repository's frontend validation command available in the project, confirming the change does not affect component behavior or existing tests.
