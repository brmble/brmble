# Manual Bulk Selling Cooldown

## Goal

Make bulk selling a manual-only action and enforce a 20-minute cooldown between successful bulk sales.

## Current behavior

The NeonD simulation supports both a manual `Bulk sell overflow` button and an `autoBulkEnabled` mode. Automatic bulk selling is invoked during normal deterministic simulation and offline progress whenever stock exceeds the trigger threshold. The manual action sells stock above 500g at 90% of effective street value.

## Design

### State and timing

Add `lastBulkSellAt` to `GameState`, storing the game-clock timestamp of the most recent successful bulk sale. Initialize it to the state creation time. Add a `BULK_SELL_COOLDOWN_MS` constant equal to `20 * 60 * 1000`.

The cooldown is global across all products: a successful sale for one product prevents another product from being bulk-sold until 20 minutes have elapsed. A sale that has no overflow above the 500g retain amount does not start or extend the cooldown.

Bulk-sale eligibility will be evaluated against the current game timestamp. The simulation helper will accept the current time for manual sales, reject attempts during cooldown without changing state, and set `lastBulkSellAt` only when it actually sells units.

### Manual-only behavior

Remove `autoBulkEnabled`, its setter, the Auto Bulk UI control, and all calls to automatic bulk-selling logic from deterministic simulation and offline progress. Production and offline simulation will leave stock at its calculated level; only the explicit manual action can reduce stock to 500g.

The existing unlock threshold, unlock cost, retain amount, trigger-related constants that are no longer used, and 90% sale value remain unchanged unless cleanup makes their removal necessary. No new automatic replacement behavior is introduced.

### UI

Keep the per-product `Bulk sell overflow` button. Disable it when:

1. The product has no stock above 500g; or
2. The global bulk-sale cooldown has not expired.

While cooling down, show the remaining time in the button label using the existing game timestamp/render pattern. The button should use a whole-minute/second countdown that reaches zero at the cooldown boundary. The action handler remains authoritative so stale UI or repeated clicks cannot bypass the cooldown.

### Save compatibility

Bump the NeonD state schema version because the state shape changes. Migrate existing saves by treating missing `lastBulkSellAt` as `0`, which makes the first post-upgrade manual sale available immediately. Existing `autoBulkEnabled` data is ignored and is not carried into the new state. Validate that `lastBulkSellAt` is a finite non-negative number.

### Testing

Add or update tests to cover:

- A successful manual sale reduces stock, awards the expected cash and run earnings, and records the sale timestamp.
- A second sale before 20 minutes is rejected with no state changes.
- A sale at or after 20 minutes is allowed.
- A no-op sale does not start the cooldown.
- Deterministic simulation never bulk-sells automatically, even when stock exceeds the old trigger threshold.
- Offline progress never bulk-sells automatically.
- The production panel removes the Auto Bulk control, disables the manual button during cooldown, and displays the remaining cooldown.
- New saves and migrated saves satisfy the updated save schema.

## Alternatives considered

1. Keep automatic bulk selling and apply the cooldown to it too. Rejected because the requested game behavior is manual-only.
2. Store a cooldown in React component state. Rejected because it would reset on reload and could diverge from the persisted game clock.
3. Store a separate cooldown per product. Rejected in favor of one global cooldown, which makes “bulk selling” a single player action and prevents switching products to bypass the intended 20-minute limit.

## Out of scope

- Changing bulk-sale pricing, thresholds, unlock cost, or stock retention.
- Adding a separate automatic sales feature.
- Changing dealer/captain sales or production rates.
