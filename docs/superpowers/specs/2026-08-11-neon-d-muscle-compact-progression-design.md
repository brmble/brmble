# Neon-D Muscle Compact Progression Design

## Goal

Reduce the visual density of the Muscle / Respect tab in PR #633 while keeping its progression, prices, purchases, and Respect calculations unchanged. Players should be able to scan their current Muscle workforce quickly without losing access to later worker tiers.

## Current Problem

`MusclePanel` renders every worker in `MUSCLE_CATALOG` as a tall card with a colored header, two separate metric rows, and a full-width purchase button. Ten cards compete for space in the left gameplay panel, so the tab feels cramped and requires substantial scrolling even when most tiers are not yet relevant.

The panel also gives Territory and Discount one full-width row each. Together with the worker cards, these repeated surfaces create more visual weight than the amount of information requires.

## Scope

This change is limited to the Muscle / Respect presentation in the improved Neon-D interface from PR #633.

In scope:

- compact worker rows;
- progressive disclosure of later worker tiers;
- an explicit show-all/hide-later-tiers control;
- a compact two-column layout for Territory and Discount actions;
- responsive and accessible behavior;
- focused UI tests.

Out of scope:

- economy formulas, prices, growth rates, Respect generation, or purchase rules;
- changes to `MUSCLE_CATALOG`;
- persisted game-state or save-format changes;
- changes to Production, Distribution, Captains, Kingpins, or prestige systems;
- new animation or icon systems.

## Layout

The panel retains its existing order and identity:

1. `Muscle / Respect` heading.
2. Respect total and Respect/sec summary.
3. Territory and Discount progression actions.
4. Muscle worker progression list.
5. Show-all/hide-later-tiers control when collapsed content exists.

Territory and Discount render side by side in a compact two-column action grid at normal panel widths. Each action keeps its existing label, cost, disabled state, and callback. At narrow widths the actions stack so their text remains readable.

## Compact Worker Rows

Each worker uses one compact row instead of a multi-section card.

The left side contains:

- worker name;
- owned count;
- base Respect/sec per worker;
- total Respect/sec contribution.

The right side contains a compact purchase button with the current price. The button retains the existing purchase callback and is disabled when cash is below the calculated worker cost.

The row uses the existing Muscle/Respect accent treatment as a narrow edge or subtle highlight. It does not repeat a full colored header. Owned and unowned workers share the same information structure so the list can be scanned vertically without changing reading patterns.

Unaffordable workers remain readable. Their disabled purchase action provides the visual state; the interface must not describe them as mechanically locked because the current game does not impose worker-tier locks.

## Progressive Disclosure

Collapsed mode is the default for each mount of `MusclePanel`. It shows:

- every catalog worker whose owned count is greater than zero; and
- the next two unowned catalog entries after the highest owned catalog index.

When no workers are owned, the first two catalog entries are the next two entries. If fewer than two later entries remain, all remaining entries are shown.

This definition remains deterministic when ownership contains gaps: all owned entries remain visible, while the two forward-looking entries are selected after the highest owned entry. Earlier unowned gaps stay hidden in collapsed mode and remain available through the show-all control.

When additional catalog entries are hidden, a quiet button below the list reads `Show all N later tiers`, where `N` is the number currently hidden. Activating it shows the complete catalog and changes the label to `Hide later tiers`. Activating it again restores the collapsed progression view.

The expanded/collapsed choice is local UI state. It is not persisted in the Neon-D save data. While the list is expanded, purchases do not automatically collapse it. In collapsed mode, purchasing a forward-looking tier immediately recalculates the visible progression window while retaining every owned tier.

## Responsive Behavior

At normal desktop panel widths, a worker row keeps its details on the left and purchase action on the right. Secondary metrics may wrap beneath the worker name when space tightens.

At narrow panel widths, the purchase action moves below the details and fills the available row width. Territory and Discount also change from two columns to one. The layout must not introduce horizontal scrolling or clipped prices.

All visual values use existing Brmble spacing, typography, radius, border, color, and transition tokens. The design adds no hardcoded visual measurements and follows the existing Neon-D CSS module pattern.

## Accessibility

The worker list remains semantic content, with each worker represented by an article or equivalent independently understandable row. Worker names remain headings so existing navigation and tests retain useful structure.

The show-all button:

- uses a native `button` element;
- exposes `aria-expanded="false"` in collapsed mode and `aria-expanded="true"` in expanded mode;
- references the worker-list container with `aria-controls`;
- has visible labels that describe both actions without relying on an icon.

Collapsed workers are not rendered and therefore are absent from the accessibility tree. Disabled purchase buttons use native `disabled` behavior. Focus styling and contrast continue to come from the shared theme tokens.

## Component Boundaries and Data Flow

`MusclePanel` continues to receive the same props and remains the only component changed for behavior. It derives owned counts and purchase prices from the existing state and economy helpers.

One local boolean controls whether all workers are shown. A small deterministic derivation inside the Muscle module computes the collapsed catalog slice from `MUSCLE_CATALOG` and `state.muscleOwned`. No game-engine action, reducer, persistence hook, or catalog data changes are required.

`NeonD.module.css` receives focused styles for the compact action grid, worker list, worker row, row details, compact purchase action, and responsive stacking. Obsolete Muscle-only card-body/header styles may be removed only if no other panel uses them.

## Testing

UI tests in `NeonDGame.test.tsx` will cover:

- a fresh state renders only the first two worker tiers in collapsed mode;
- all owned tiers remain visible and the next two unowned tiers after the highest owned tier are included;
- later tiers are initially absent;
- `Show all N later tiers` renders the full catalog and exposes `aria-expanded="true"`;
- `Hide later tiers` restores the collapsed view and `aria-expanded="false"`;
- a visible worker purchase still calls the existing `buyMuscleWorker` action with the correct worker ID;
- unaffordable worker purchase buttons remain disabled;
- existing Territory and Discount actions and Muscle summary assertions continue to pass.

Verification will run the focused Neon-D test suite, TypeScript checking, the frontend build, linting for the touched Neon-D files, and `git diff --check`.

## Success Criteria

- The default Muscle view contains only owned workers plus two forward-looking tiers.
- Players can reveal and purchase any catalog tier through the show-all control.
- Worker information and purchase prices remain available with substantially less vertical card chrome.
- Territory and Discount consume less vertical space without losing information.
- No economy, save, or simulation behavior changes.
- The layout remains usable with keyboard navigation and at narrow panel widths.
