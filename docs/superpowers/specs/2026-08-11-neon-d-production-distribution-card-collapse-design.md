# Neon-D Production and Distribution Card Collapse

## Goal

Reduce the vertical footprint of active Production and Distribution cards on demand while keeping each card's essential identity and live operating summary visible.

## Interaction

- Every eligible card starts expanded whenever `NeonDGame` mounts.
- Each eligible card has an arrow button in its colored header.
- The expanded state uses an upward arrow and an accessible `Collapse ...` label.
- The collapsed state uses a downward arrow and an accessible `Expand ...` label.
- Each card expands and collapses independently.
- Collapse state is local presentation state. It is not written to Neon-D save data and resets to expanded when the game is reopened.

## Production Cards

- Every visible Production product card is independently collapsible, whether the product is unlocked or is the next locked product available for research.
- The card border, colored header, and product name remain visible in the collapsed state.
- For an unlocked product, collapsing hides stock, yield, level, production-versus-sales flow, and the producer purchase action.
- For a locked product, collapsing hides the research/unlock action.
- Expanding restores the existing body unchanged.

## Distribution Cards

- Every hired dealer card is independently collapsible, including arrested dealers.
- The card border and colored header remain visible in the collapsed state.
- The compact summary always displays the dealer name, the product currently being sold, and current Earnings.
- A normal dealer's collapsed Earnings value remains the existing live per-second value.
- An arrested dealer's collapsed Earnings value is `$0.00/s`.
- Collapsing hides slot information, product selection, ratings, risk or protection status, side volume, protection controls, equipment, upgrade actions, bail actions, and fire actions.
- Expanding restores the existing body unchanged.
- Empty dealer slots, dealer candidate cards, and locked slots remain unchanged because they are not active Distribution cards.

## Architecture and State

- Keep the existing `NeonDGame` rendering and game-engine data flow intact.
- Track collapsed Production product IDs and collapsed Distribution dealer IDs in two local React sets.
- Toggle membership by stable product or dealer ID so changing one card cannot affect another.
- Do not change economy calculations, engine callbacks, state types, save keys, or persistence behavior.
- Reuse the existing card header/body boundaries and CSS module. Add only the compact summary, toggle button, and layout styles needed for this feature.

## Accessibility

- Use semantic `button` elements for the arrow controls.
- Give each button a card-specific accessible label that describes the next action, such as `Collapse Weed production` or `Expand Test Dealer distribution`.
- Expose expansion state through `aria-expanded` and associate the button with its collapsible body where practical.
- Keep the visible arrow decorative so screen readers announce the action only once.

## Testing

Extend the focused `NeonDGame` UI tests to verify:

- Production and hired Distribution cards render expanded initially.
- A Production card can collapse and expand without changing another Production card.
- A collapsed Production card retains its border/header and product name while hiding its body details and actions.
- A hired Distribution card can collapse and expand without changing another hired dealer card.
- A collapsed Distribution card retains dealer name, current product, and live Earnings while hiding other details and controls.
- An arrested Distribution card retains dealer name, product, and `$0.00/s` while collapsed.
- Toggle buttons have card-specific labels and correct `aria-expanded` state.
- Empty slots, candidate cards, and locked slots retain their current behavior.

Run the focused Neon-D UI tests, the complete Neon-D test suite, type checking, and the production web build after implementation.

## Scope

This is a presentation-only feature. It does not change Neon-D economy behavior, dealer behavior, product unlocks, save data, or unrelated panels.
