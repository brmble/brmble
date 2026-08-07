# Neon-D Distribution Star Ratings Design

## Goal

Display dealer Volume and Margin as compact five-star ratings in the Distribution panel while preserving access to the exact multiplier on hover and keyboard focus.

## Scope

- Apply the star presentation to normal dealer candidates and active dealers.
- Keep Main sales and Earnings as numeric rates.
- Keep Captain Volume and Margin as numeric base metrics; Captains do not have rolled dealer multipliers.
- Do not change simulation, save data, dealer generation, or multiplier calculations.

## Interaction and visual behavior

Each normal dealer Volume and Margin row will render five available star positions. The existing multiplier is rounded to the nearest whole-star count for a deliberately coarse visual signal: `1.3` displays as 1 star and `1.6` displays as 2 stars. There are no half-stars. Values are clamped to the five-star display range.

Stars will have filled and empty visual states. The row remains labeled Volume or Margin. Hovering or keyboard-focusing the rating exposes the exact multiplier, formatted to two decimal places (for example, `Volume: 1.23x`). The same exact value is available through an accessible label, so the information does not depend on pointer hover.

The component will use the existing Neon-D CSS module tokens and avoid a new dependency or icon library. The rating is display-only and is not interactive.

## Component boundary

Add a small reusable `DealerRating` presentation component within the Neon-D component area. It accepts:

- a metric label (`Volume` or `Margin`),
- the multiplier value, and
- an optional class/style hook only if required by the existing panel layout.

The component owns rating conversion, star state rendering, tooltip text, and accessible labeling. `DistributionPanel` remains responsible for selecting the dealer values and laying out the surrounding metrics.

## Data flow and error handling

The component receives the existing `volumeMultiplier` and `marginMultiplier` values without transformation outside the presentation boundary. Its conversion rounds to a whole-star count and clamps the display to `0`–`5`, preventing malformed or future out-of-range values from producing an invalid number of stars. The original exact value is used in the tooltip and accessible text.

No new persistence or runtime state is needed. Missing values are not expected in the current `Dealer` type; if a value is unavailable, the component should fail safely by rendering the existing label with an empty rating rather than throwing.

## Testing

Update the existing Neon-D UI expectation that currently asserts dealer star ratings are absent. Add tests that verify:

1. Candidate cards render Volume and Margin star ratings.
2. Active dealer cards render both star ratings.
3. The rating exposes the exact two-decimal multiplier through its title/tooltip and accessible label.
4. Values such as `1.3` and `1.6` map to one and two whole stars respectively, with no half-star state.
5. Main sales, earnings, and Captain base metrics remain numeric.

The test should assert semantic state or accessible text rather than relying only on the literal star glyph, so the visual implementation can evolve without weakening behavior coverage.

## Non-goals

- Rebalancing dealer multipliers or changing gameplay formulas.
- Converting Captain metrics to ratings.
- Adding click, drag, or rating-selection behavior.
- Replacing existing tooltips globally.
