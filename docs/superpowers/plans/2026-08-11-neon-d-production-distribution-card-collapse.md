# Neon-D Production and Distribution Card Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent, expanded-by-default collapse controls to Neon-D Production and hired-dealer Distribution cards.

**Architecture:** `ProductionPanel` owns a local set of collapsed product IDs and `DistributionPanel` owns a local set of collapsed dealer IDs. Existing card headers become accessible disclosure headers; expanded bodies remain unchanged, while collapsed dealer cards render the required earnings summary.

**Tech Stack:** React 19, TypeScript 5.9, CSS Modules, Vitest 4, Testing Library, Vite 7.

## Global Constraints

- Collapse state is local and non-persisted; cards start expanded on mount.
- Each product and dealer card toggles independently by stable ID.
- Collapsed Production shows the card border/header and product name.
- Collapsed hired Distribution shows the card border/header, dealer name, selected product, and Earnings.
- Arrested dealer Earnings are `$0/s`.
- Empty slots, candidates, and captain cards are unchanged.
- Preserve all economy calculations, callbacks, disabled conditions, and save structures.
- Buttons use card-specific `aria-label`, `aria-expanded`, and `aria-controls` values.

---

### Task 1: Production card disclosure

**Files:**
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/ProductionPanel.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css`

**Interfaces:**
- Consumes: `ProductId`, visible product definitions, and existing Production card bodies.
- Produces: `collapsedProductIds: Set<ProductId>` and card buttons named `Collapse|Expand <name> production`.

- [ ] Add a UI test with unlocked Weed and Mushrooms. Assert both buttons start with `aria-expanded="true"`; collapse Weed; assert its Stock and Buy action disappear while its name remains and Mushrooms stays expanded; expand Weed and assert its body returns.
- [ ] Add a UI test for the next locked product. Collapse it and assert the product name remains while its Research action disappears.
- [ ] Run `npm.cmd run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx` and confirm failure because the disclosure buttons do not exist.
- [ ] Import `useState` and `Icon` in `ProductionPanel.tsx`; add `collapsedProductIds` initialized with an empty `Set<ProductId>` and an immutable membership toggle.
- [ ] For each card, derive `isCollapsed` and `production-body-${productId}`. Keep the existing `article` label, place street price plus a chevron button in `productionHeader`, set the required ARIA attributes, and render `productionBody` only when expanded.
- [ ] Add shared `.cardCollapseButton` styles that inherit header color and add an accessible hover/focus target without changing card width.
- [ ] Run the focused test and confirm all tests pass.
- [ ] Commit the Production slice as `feat: collapse Neon-D production cards`.

### Task 2: Hired dealer disclosure

**Files:**
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css`

**Interfaces:**
- Consumes: dealer ID/name/product, `lastEarningsPerSeller`, and existing normal/arrested dealer bodies.
- Produces: `collapsedDealerIds: Set<string>` and card buttons named `Collapse|Expand <name> distribution`.

- [ ] Add a UI test with two hired dealers. Assert both start expanded; collapse the first; assert dealer name, product, and live Earnings remain while Product select, ratings, protection, equipment, and fire controls disappear; assert the second stays expanded; expand the first and assert its controls return.
- [ ] Extend the arrested-dealer test to collapse the card and assert name, product, and `$0/s` remain while Status, Pay Bail, and Fire Dealer disappear.
- [ ] Run the focused test and confirm failure because Distribution disclosure controls do not exist.
- [ ] Add `collapsedDealerIds` beside `expandedEquipmentIds` with an immutable membership toggle.
- [ ] Give hired-dealer articles an accessible `<name> distribution` label. Put dealer name/product plus a chevron button in `dealerHeader`, with required ARIA attributes targeting `distribution-body-${dealer.id}`.
- [ ] When collapsed, render `.collapsedDealerSummary` with the same existing Earnings expression; otherwise render the current `dealerBody` unchanged. Do not add toggles to empty-slot, candidate, or captain cards.
- [ ] Update `.dealerHeader` to a flex disclosure header and add `.dealerHeaderTitle` and `.collapsedDealerSummary` styles.
- [ ] Run the focused test and confirm all tests pass.
- [ ] Commit the Distribution slice as `feat: collapse Neon-D distribution cards`.

### Task 3: Verification

**Files:** Verify the three implementation files above.

- [ ] Run `npm.cmd run test -- src/components/NeonD` and require zero failed tests.
- [ ] Run `npm.cmd run type-check` and require zero TypeScript errors.
- [ ] Run `npm.cmd run lint`; require no new errors in scoped files and record unrelated baseline failures if any.
- [ ] Run `npm.cmd run build` and require a successful Vite bundle.
- [ ] Review the scoped diff and confirm there are no engine, economy, save, candidate, captain, or unrelated changes.
