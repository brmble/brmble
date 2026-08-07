# Production Card Visual Design

## Goal

Update the Neon-D Production cards so their presentation matches the supplied reference screenshot more closely, without changing game behavior, economy calculations, state, or actions.

## Scope

The change is limited to the production-card markup and CSS module styles in the web client. Existing handlers, computed values, disabled states, unlock behavior, market banners, bulk-selling controls, research controls, and persistence remain unchanged.

## Card layout

Each unlocked production card renders:

1. A full-width green header containing the product name on the left and the effective street value on the right.
2. A stock row showing the current stock amount.
3. A production-versus-sales row with production on the left, a green upward indicator, sales on the right, and a red downward indicator.
4. A delta row showing the signed production-minus-sales amount, colored according to whether the delta is positive or negative.
5. The existing producer purchase button, with its label updated to include the current producer count and the existing next-purchase cost.
6. The existing next production-upgrade button or completion label.

Locked products keep their existing research action inside the card body.

## Presentation details

- Preserve the existing production green identity, card border, hover treatment, and panel scrolling behavior.
- Keep the current number formatting and live values.
- Use CSS-based up/down indicators so the visual treatment matches the screenshot without changing the displayed data model.
- Keep the producer name in the buy action label; pluralize the producer noun for counts other than one where practical.
- Ensure long product names and large values remain readable within the existing responsive card width.
- Preserve accessible labels and button semantics.

## Testing

Add or update focused component assertions to verify that an unlocked Weed card renders:

- the product name and street value in the production header;
- the stock, production, sales, and delta labels/values;
- the production and sales direction indicators;
- the producer count in the buy button label.

Run the focused Neon-D component test, then the web build or the project’s standard validation command available in the repository.

## Non-goals

- No economy or simulation changes.
- No changes to producer pricing or upgrade pricing.
- No changes to game state shape, save format, unlocks, or action callbacks.
- No redesign of Distribution, Muscle, or other Neon-D cards.
