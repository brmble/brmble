# Neon-D Left Panel Tabs Design

## Goal

Reduce the visual density of the Neon-D screen by making Production and Muscle / Respect selectable tabs in the left column, while keeping Distribution permanently visible in the right column.

## User experience

The Neon-D gameplay area remains a two-column layout:

- The left column contains a centered two-option tab switcher and one active panel.
- The right column always contains the existing Distribution panel.
- The available left tabs are `Production` and `Muscle`.
- `Production` is selected whenever Neon-D opens, preserving the current initial view.
- Selecting `Muscle` replaces the Production panel with the existing Muscle / Respect panel in the left column.
- Selecting `Production` restores the existing Production panel.
- The selected tab is local UI state only. It is not persisted in the Neon-D save and does not affect the game engine.

The tab switcher uses two equal-width buttons centered across the left column. The inactive tab keeps the existing muted styling, while the active tab uses the existing green accent styling shown in the provided reference image.

On narrow screens, the existing responsive stacking behavior remains: the left workspace and Distribution panel stack vertically, with the tab switcher staying above the active left panel.

## Architecture

`NeonDGame` owns a small `activeLeftPanel` state initialized to `production`. It renders the tab controls and chooses between the already-existing `ProductionPanel` and `MusclePanel`. `DistributionPanel` remains outside that conditional branch and continues rendering in the right column.

No economy, game-engine, save-format, or action-handler changes are required. Existing panel props and callbacks remain unchanged.

The tab controls use accessible tab semantics:

- a tab list container with `role="tablist"`;
- two buttons with `role="tab"`;
- `aria-selected` reflecting the active tab;
- stable labels suitable for keyboard and automated testing.

## Styling

Add focused styles for:

- the two-column gameplay grid;
- the left workspace wrapper;
- the centered two-tab control;
- active and inactive tab states;
- focus-visible feedback.

Reuse the existing theme variables and accent colors. Do not introduce a new color palette or alter the visual treatment of the Distribution cards.

## Testing

Extend the existing `NeonDGame` UI tests to verify:

1. Production is selected and its content is visible on initial render.
2. Both tabs are rendered with the expected accessible labels.
3. Selecting Muscle hides Production and shows Muscle / Respect content.
4. Selecting Production switches the left column back.
5. Distribution content remains visible after switching tabs.

The existing test suite and web production build should continue to pass.

## Scope boundaries

This change does not add tab persistence, URL state, new gameplay behavior, or changes to the Distribution panel. It does not remove any Production, Distribution, or Muscle functionality; it only changes which left-column panel is visible at a time.
