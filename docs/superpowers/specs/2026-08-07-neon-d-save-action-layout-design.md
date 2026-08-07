# Neon-D Save Action Layout Design

## Goal

Align the Neon-D Reset, Export save, and Import save controls as one right-aligned action group with a consistent Neon-D visual style.

## Design

- Replace the separate save-action wrapper and Reset button with one `headerActions` wrapper.
- Keep the existing order: Export save, Import save, Reset.
- Apply the existing `upgradeButton resetButton` classes to all three controls.
- Use the existing CSS spacing tokens and `margin-left: auto` so the group stays at the right edge of the stats bar.
- Keep all click handlers, file input behavior, confirmation, and error handling unchanged.

## Testing

Extend the Neon-D component test to assert that Export save, Import save, and Reset are rendered as buttons in the shared action group and retain their existing accessible names. Run the focused Neon-D component tests, type-check, and production build.
