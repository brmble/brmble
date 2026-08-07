# Neon-D save invariant fix report

Date: 2026-08-07
Base HEAD: 9325ac21

## Scope completed

- Strengthened `saveFormat.ts` v2 parsing so it rejects impossible Neon-D states while still accepting legitimate fractional cash, Respect, stock, and earnings values.
- Added table-driven corrupt-save rejection coverage and a richer valid v2 round-trip case in `saveFormat.test.ts`.
- Removed only unreferenced legacy/v1 CSS selectors from `NeonD.module.css` after checking current usage in `ProductionPanel`, `DistributionPanel`, `MusclePanel`, and `NeonDGame`.

## Save validation changes

- Economic values now require non-negative finite numbers where the state can represent them:
  - `cash`
  - `runEarnings`
  - `respect`
  - product `stock`
  - dealer `earningsPerSecondAtArrest`
  - captain `personalEarnings`
  - `lastEarningsPerSeller` values
  - offline summary earnings
- Timestamps/durations now require non-negative finite numbers where applicable:
  - `lastDealerRefreshAt`
  - `nextMarketCheckAt`
  - `nextRiskCheckAt`
  - `lastTickAt`
  - active market event `endsAt`
  - offline summary `actualAwayMs` / `simulatedMs`
- `unlockedProducts` must be a non-empty canonical prefix that begins with `weed`.
- Product upgrades must remain canonical prefixes of each product’s upgrade catalog.
- Locked products must remain at zero stock, zero producers, and zero purchased upgrades.
- Dealer and Captain `selling` assignments must point to unlocked products.
- Dealer `volumeMultiplier` and `marginMultiplier` must stay within `0.5..1.5`.
- Seller equipment arrays must contain only known equipment ids with no duplicates.
- `activeDealers.length` must match territory capacity (`territoryLevel + 1`).
- `availableDealers` must contain exactly 3 unique valid dealers.
- `autoBulkEnabled` now requires `bulkUnlocked`.
- Active dealer ids and candidate ids are checked for uniqueness within their own pools.

## CSS cleanup completed

- Removed unreferenced legacy selectors after usage-checking the current Neon-D components.
- Post-cleanup usage scan found no remaining unused module selectors in the current Neon-D panel set.

## Verification run

Focused checks:

- `npm.cmd test -- src/components/NeonD/__tests__/saveFormat.test.ts src/components/NeonD/__tests__/NeonDGame.test.tsx`

Required gate:

- `npm.cmd test -- src/components/NeonD`
- `npm.cmd run type-check`
- `npx.cmd eslint src/components/NeonD`
- `npm.cmd run build`
- `git diff --check`
- `git grep -n -E "researchSpeed|SLOT_UNLOCK_COSTS|PRODUCT_ARREST_RISK|VOLUME_RANGES|MARGIN_RANGES|pendingUpgradeOptions|hasPendingUpgrade" -- src/Brmble.Web/src/components/NeonD`

## Notes / concerns

- The Neon-D test suite passes cleanly. One expected stderr line remains in `usePersistedGameState.test.ts` when it intentionally feeds invalid JSON into localStorage; this did not fail the suite and is unrelated to the save invariant fix.
- Unrelated untracked files in the worktree were left untouched.
