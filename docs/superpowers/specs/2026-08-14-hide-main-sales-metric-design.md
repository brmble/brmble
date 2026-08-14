## Goal

Hide the `Main sales` metric from the Neon-D player interface because the user does not want players to see it.

## Scope

- Remove the `Main sales` row from recruitment candidate cards.
- Remove the `Main sales` row from active dealer cards.
- Keep `getNormalDealerMainSaleRate` and all simulation/economy behavior unchanged; the value remains an internal gameplay calculation.

## Design

This is a presentation-only change in `DistributionPanel.tsx`. Delete the two JSX metric rows that render the label and units-per-second value. No state, save format, dealer balance, earnings, or secondary-sales logic changes.

## Validation

- Add or update a component-level assertion if the existing test setup covers these rows.
- Run the focused Neon-D frontend tests and the relevant type/build validation.
- Confirm no visible `Main sales` text remains in the distribution interface while the simulation tests continue to pass.
