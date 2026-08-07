# Production Card Header Alignment Design

## Goal

Make Production product cards feel consistent with Distribution cards by using the same two-part card composition: a full-width colored header followed by a padded content body.

## Approved design

Each Production product card will render:

- A full-width, thick green header using the existing success accent.
- The product name as the primary header text.
- The current street price as smaller secondary text in the same header.
- The existing production metrics, actions, market banner, and research control inside a padded body below the header.

The Distribution card structure and spacing are the visual reference. Production keeps its green identity, while Distribution keeps its existing secondary accent and behavior.

## Components and styling

- Update `ProductionPanel` so the card header is separate from the content body.
- Add or adapt CSS module classes for a green production header and padded production body.
- Preserve all existing labels, controls, disabled states, market-event messaging, and accessibility labels.
- Keep the current production card hover treatment and card border behavior unless the structural change requires a small adjustment for overflow or spacing.

## Testing and verification

- Add a focused component assertion that Production renders the product name and street price in the production header region.
- Run the focused Neon-D component test suite.
- Run the web type-check/build to catch CSS-module and JSX issues.
- Review the final diff to confirm unrelated working-tree changes remain untouched.

## Scope

This is a presentation-only change to Production cards. It does not alter economy calculations, product unlocks, production rates, distribution behavior, or persisted game state.
