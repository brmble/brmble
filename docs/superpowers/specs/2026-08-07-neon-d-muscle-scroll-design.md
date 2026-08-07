# Neon-D Muscle Panel Scrolling Design

## Goal

Allow the active Muscle / Respect panel in Neon-D to scroll through all worker cards when the desktop viewport is shorter than the panel content.

## Root cause

The desktop gameplay grid clips overflow. Its left workspace is an auto-sized grid with `overflow: hidden`, while the active panel only declares `max-height: 100%`. Because the workspace does not allocate a definite remaining height to the panel, the panel cannot establish a scrollable box before the workspace clips its overflowing cards.

## Design

Keep the tab switcher fixed at the top of the left column and make the active panel consume the remaining height:

- The left workspace gets a full available height and two grid rows: an automatic tab row and a `minmax(0, 1fr)` panel row.
- The active panel keeps `overflow-y: auto` and uses the grid row height rather than a percentage `max-height`.
- The outer desktop gameplay grid continues clipping the overall workspace, so scrolling stays local to the active left panel.
- The existing narrow-screen media query continues stacking the gameplay columns and disables the local panel scroll in favor of the stacked page/grid scroll behavior.

No React, game-state, save-format, or economy changes are required.

## Testing

Add a focused UI regression assertion that the Neon-D layout exposes the left workspace and active panel with the classes needed for the fixed-tab/local-scroll contract. Keep the existing tab-switching and Muscle content tests intact, then run the focused Neon-D test file and the web production build.

## Scope

Only the Neon-D layout CSS and its regression coverage are in scope. Distribution behavior, tab semantics, responsive stacking, and gameplay actions remain unchanged.
