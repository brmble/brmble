# Neon-D Pending Dealer Upgrade Design

## Summary

Adjust the Neon-D dealer equipment upgrade flow so that pressing `Upgrade` immediately spends the money and creates a mandatory three-choice upgrade selection for that specific dealer. The player must resolve that selection by choosing one of the offered upgrades or by firing that dealer later. Closing and reopening the upgrade UI must never reroll the choices.

## Desired Player Experience

When the player presses `Upgrade` on a dealer card:

- the upgrade cost is charged immediately
- exactly three upgrade options are generated
- those three options become locked to that dealer
- the player cannot dismiss the choice as a way to get a new roll

If the player reopens the upgrade flow for that same dealer before choosing, they must see the exact same three options again.

If the dealer is fired before a choice is made, the pending upgrade choice disappears together with the dealer.

## State Model

The dealer state should carry its own pending upgrade choice data instead of keeping the offer only in component-local UI state.

Add persistent dealer fields for:

- whether the dealer currently has a pending equipment choice
- the exact three generated options tied to that dealer

This keeps the flow consistent with autosave and prevents rerolling by closing the modal or refreshing the page.

## Flow Changes

### Start Upgrade

Pressing `Upgrade` should:

- verify the dealer exists
- verify the dealer is not already maxed out
- verify the player has enough money
- immediately subtract the upgrade cost
- generate three equipment options using the current weighted logic
- save those three options on the dealer if none are already pending
- open the upgrade modal for that dealer

If the dealer already has a pending set of options, pressing `Upgrade` again should not charge again and should simply reopen the modal with the existing set.

### Resolve Upgrade

Choosing one option should:

- apply only the selected upgrade
- increment the dealer equipment count
- clear the pending option set from that dealer
- close the modal

### Fire Dealer

Firing a dealer should also discard any pending equipment choice stored on that dealer.

## UI Behavior

The upgrade modal remains the presentation layer for choosing from the dealer's pending options.

Behavior requirements:

- the modal must read its options from dealer state, not from newly generated component state
- the close button or dismiss action must not create a reroll path
- reopening the modal for a dealer with pending options must show the same three choices
- once a choice is made, the modal closes normally

Implementation detail:

The UI may still allow the modal to visually close, but only if the pending options remain stored on the dealer and reopening returns the same set. The important rule is that closing the modal must not regenerate or discard the unpaid choice state.

## Testing

Add or update tests for:

- starting an upgrade immediately charging money and storing three pending options
- reopening the upgrade flow for the same dealer reusing the same options
- resolving one option applying the effect and clearing pending options
- firing a dealer clearing pending options
- existing dealers from older saves safely defaulting to no pending upgrade data

## Scope

This change is intentionally narrow:

- no change to upgrade weighting rules
- no increase to the three-equipment cap
- no new dealer progression system
- no extra confirmation step before paying for an upgrade roll
