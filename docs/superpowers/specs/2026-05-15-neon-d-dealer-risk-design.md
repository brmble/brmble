# Neon-D Dealer Risk Design

**Date:** 2026-05-15
**Status:** Draft for review

## Goal

Add a lightweight dealer arrest system to Neon-D that creates meaningful tradeoffs without breaking the idle flow. The player should choose between higher profits and safer operation on a per-dealer basis.

## Summary

Each active dealer can be in one of three states:

- `active`
- `protected`
- `arrested`

Arrest risk is determined only by the product the dealer is currently selling. The game performs a periodic arrest check for each non-protected dealer. If the check succeeds, that dealer becomes arrested and stops generating income until the player either pays bail or fires them.

The player can toggle `Pay off cops` for each dealer. While enabled, that dealer is fully immune to arrest checks but earns 15% less income.

## Design Principles

- Keep the system easy to understand at a glance.
- Preserve idle progress by using infrequent risk checks instead of constant punishment.
- Make high-risk products more profitable but harder to run safely.
- Ensure bail remains a live economic choice throughout early, mid, and late game.

## Dealer States

### Active

The dealer operates normally:

- sells their assigned product
- generates full income
- is eligible for arrest checks

### Protected

The dealer operates under `Pay off cops`:

- sells their assigned product
- generates 85% of normal income
- is completely immune to arrest checks
- can be toggled back to normal by the player at any time

Protection is not permanent. It is a live toggle on the dealer card.

### Arrested

The dealer stops operating:

- generates no income
- cannot switch products
- cannot buy additional equipment
- can only be recovered through `Pay Bail` or removed through `Fire Dealer`

Arrested dealers keep their existing equipment unless the player fires them.

## Arrest Check Model

The game performs arrest checks on a schedule per dealer instead of using a visible heat meter.

### Timing

- Each eligible dealer gets checked on a repeating timer.
- The timer should use a randomized interval window, with the first implementation targeting roughly every 300-600 seconds per dealer.
- The interval should be independent per dealer so multiple arrests do not feel synchronized or scripted.

### Eligibility

A dealer is eligible for a check only when all of the following are true:

- the slot contains a dealer
- the dealer is not arrested
- `Pay off cops` is disabled

### Risk Source

The arrest chance comes only from the product the dealer is actively selling at the moment of the check.

This design intentionally avoids extra hidden math from:

- accumulated heat
- total money earned
- equipment count
- number of dealers

That keeps the system legible and lets players reason directly from product choice.

### Product Risk Tiers

The first implementation should use a simple per-product configuration, for example:

- early products: low arrest chance
- midgame products: medium arrest chance
- late-game products: high arrest chance

Exact percentages are balancing values and should live in constants rather than being hardcoded in UI components.

## Pay Off Cops

`Pay off cops` is a per-dealer toggle.

### Effect

- While enabled, the dealer is fully immune to arrest.
- While enabled, the dealer earns 15% less income.

### Income Handling

The 15% penalty should apply to the dealer's realized earnings, after normal product sale math is calculated for that dealer. This keeps the feature compatible with current volume, margin, side-volume, and equipment systems.

### UX Rules

- The toggle must clearly show whether protection is on or off.
- The earnings shown on the dealer card should already reflect the current protected or unprotected income.
- Protected dealers should have a visible status label such as `Protected` or `Cops Paid Off`.

## Bail

When a dealer is arrested, the primary recovery action is `Pay Bail`.

### Bail Formula Direction

Bail must scale with the player's current economy, specifically their current total income per second rather than their cash on hand.

Recommended formula shape:

`bailCost = max(baseFloor, totalIncomePerSecond * bailMultiplier)`

### Requirements

- use current total income per second
- include a minimum floor so bail never becomes trivial
- update dynamically as the player's run becomes stronger

This keeps bail meaningful at every stage of the game and prevents it from becoming either irrelevant or impossible.

### Bail Result

After bail is paid:

- the dealer returns to normal operation
- the dealer is no longer arrested
- the dealer keeps their existing equipment
- `Pay off cops` should return in the off state unless later balancing shows a reason to restore the previous setting

Defaulting protection back to off keeps the state transition simple and preserves player choice.

## Fire Dealer

The player may permanently remove an arrested dealer instead of paying bail.

### Effect

- removes the dealer from the slot
- destroys all equipment and upgrades attached to that dealer
- does not refund prior investment

This serves as the low-cash escape valve when bail is too expensive or the dealer is no longer worth saving.

## UI Design

The system should stay compact and readable on each dealer card.

### Dealer Card Content

For an active or protected dealer, show:

- current product
- current earnings per second
- `Pay off cops` toggle
- simple risk label for the current product, such as `Low Risk`, `Medium Risk`, or `High Risk`

For a protected dealer, also show:

- explicit protected status text
- earnings already displayed with the 15% penalty applied

For an arrested dealer, replace normal controls with:

- arrested state messaging
- `Pay Bail ($X)` button
- `Fire Dealer` button

### What We Do Not Show

- no heat bar
- no hidden-risk explanation panel
- no arrest probability countdown in the main dealer UI

The player-facing model should stay simple: risky products are dangerous, protection costs income, bail fixes arrests.

## Data Model Changes

The current dealer model needs explicit arrest/protection state.

Add fields to dealer state for:

- whether `Pay off cops` is enabled
- whether the dealer is arrested
- when the next arrest check should occur

These fields should be persisted with the save state so the system survives refreshes and idle sessions consistently.

## Game Loop Changes

The game tick should gain arrest handling in addition to the existing production and sales logic.

### Per Tick Responsibilities

- continue production updates
- continue sales updates for active and protected dealers
- skip sales for arrested dealers
- check whether a dealer has reached their next arrest-check timestamp
- if so, evaluate the current product risk and either arrest the dealer or schedule the next check

Protected dealers should never enter the arrest branch.

## Error Handling and Edge Cases

- If a dealer becomes arrested, income for that dealer must stop immediately on the next tick.
- If a player changes a dealer's product before a risk check fires, the new product determines the risk.
- If total income per second is zero when bail is calculated, the minimum bail floor still applies.
- If a protected dealer is toggled off, they become eligible for future arrest checks again using a newly scheduled interval rather than an immediate surprise check.
- Save migration should safely initialize new dealer state for older saves.

## Testing

Add automated coverage for:

- protected dealers receiving the 15% income penalty
- protected dealers never getting arrested
- unprotected dealers using current product risk at check time
- arrested dealers producing zero dealer income
- bail cost scaling from current total income per second with a minimum floor
- firing an arrested dealer removing them and their equipment
- persisted state restoring arrest/protection fields correctly

## Recommended Implementation Order

1. Extend types and persisted dealer state.
2. Add configurable product risk constants and bail constants.
3. Update the game engine to support dealer protection, arrest checks, and bail recovery.
4. Update dealer card UI for toggle, risk label, and arrested actions.
5. Add or update tests for engine behavior and persistence.

## Open Balancing Decisions

The following should be tuned during implementation:

- exact arrest percentages per product
- exact arrest interval window
- minimum bail floor
- bail multiplier against total income per second

These values should be easy to iterate on without changing the system design.
