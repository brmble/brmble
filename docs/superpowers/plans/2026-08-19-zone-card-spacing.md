# Zone Card Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase the visual separation between Neon-D zone cards without changing spacing for legacy distribution cards.

**Architecture:** Add a zone-specific wrapper class in `DistributionPanel.tsx` and style it in `NeonD.module.css`. Keep the existing shared `cardStack` class and its `var(--space-xs)` gap unchanged for legacy cards.

**Tech Stack:** React, TypeScript, CSS Modules, Vite, Vitest.

## Global Constraints

- Use `var(--space-sm)` for the zone-card gap.
- Leave legacy `.cardStack` spacing unchanged.
- Do not change game state, behavior, accessibility semantics, or card contents.

---

### Task 1: Give zone cards a dedicated larger gap

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx:540`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css:297`

**Interfaces:**
- Consumes: the existing `styles.cardStack` CSS-module class and the zone list rendered by `props.state.zones.map(...)`.
- Produces: a `styles.zoneCardStack` wrapper whose direct child zone cards are separated by `var(--space-sm)`.

- [ ] **Step 1: Change only the zone-list wrapper class**

In the zone-mode rendering, replace:

```tsx
<div className={styles.cardStack}>
  {props.state.zones.map((zone) => {
```

with:

```tsx
<div className={styles.zoneCardStack}>
  {props.state.zones.map((zone) => {
```

Leave the legacy `activeDealers` wrapper later in the file using `styles.cardStack`.

- [ ] **Step 2: Add the dedicated CSS rule without changing the shared rule**

Immediately after the existing `.cardStack` rule, add:

```css
.zoneCardStack {
  display: grid;
  gap: var(--space-sm);
}
```

Keep this existing rule unchanged:

```css
.cardStack {
  display: grid;
  gap: var(--space-xs);
}
```

- [ ] **Step 3: Run focused validation**

From `src/Brmble.Web`, run:

```powershell
npm run type-check
npm run test -- --run
npm run build
```

Expected result: type-check, Vitest, and the production build complete successfully; no runtime or behavior tests require updates because the change only affects layout spacing.

- [ ] **Step 4: Review the diff and commit the implementation**

Run:

```powershell
git diff -- src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css
git add -- src/Brmble.Web/src/components/NeonD/DistributionPanel.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css
git commit -m "style: increase zone card spacing"
```

Confirm the diff contains only the zone wrapper class change and the new `.zoneCardStack` rule.
