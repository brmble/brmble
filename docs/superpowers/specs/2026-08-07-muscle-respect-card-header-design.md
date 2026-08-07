# Muscle / Respect Card Header Alignment Design

## Goal

Make Muscle / Respect worker cards match the two-part card composition already used by Production and Distribution, while retaining the existing prestige accent and behavior.

## Approved design

Each Muscle / Respect worker card will render:

- A full-width primary-colored header using the existing `var(--accent-primary)` theme accent.
- The worker name as the primary header text.
- The current owned count as secondary header text.
- The existing respect metrics and purchase action inside a padded body below the header.

The panel-level Respect summary and Territory/Discount actions remain unchanged and outside the worker cards.

## Components and styling

- Update `MusclePanel` so each worker card has separate `muscleHeader` and `muscleBody` regions.
- Replace the current card-wide padding with a padded body while preserving the existing surface, border, primary left accent, radius, and layout behavior.
- Add dedicated Muscle / Respect card styles rather than reusing Production’s green header classes, keeping the gameplay areas visually distinct.
- Preserve all current labels, button handlers, disabled states, accessibility labels, and economy calculations.

## Testing and verification

- Add a focused component assertion that a worker name and owned count render inside the Muscle / Respect header region.
- Run the focused Neon-D component test suite.
- Run the web type-check and build to catch JSX, CSS-module, and bundling issues.
- Review the final diff to confirm unrelated working-tree changes remain untouched.

## Scope

This is a presentation-only change to Muscle / Respect worker cards. It does not alter Respect generation, worker costs, territory or discount progression, purchase behavior, or persisted game state.
