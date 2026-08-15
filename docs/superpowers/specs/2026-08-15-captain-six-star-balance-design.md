# Captain Six-Star Balance

## Goal

Increase the base Captain rating from five stars / 1.50× to six stars / 1.75× for both sales volume and margin/value.

## Design

- Set Captain base volume multiplier to `1.75`.
- Set Captain base margin multiplier to `1.75`.
- Extend the shared dealer rating display to six stars while preserving the existing one-to-five-star behavior for ordinary dealers.
- Keep talent bonuses additive on top of the new Captain base values.
- Keep Captain volume and margin displayed as exact multiplier values alongside the stars.

## Behavior and compatibility

An unmodified Captain will sell at `1.75 × 3 = 5.25` main units per second and apply a `1.75×` margin multiplier before talent bonuses. Existing saved Captains use the same calculation functions, so they receive the new base balance automatically without save migration. Ordinary dealer generation and ratings remain unchanged.

## Testing

- Add regression coverage that an unmodified Captain uses 1.75× for volume and margin.
- Add coverage that the rating helper maps 1.75× to six stars and continues to cap ordinary dealer values at five stars.
- Run the focused NeonD tests and the web test suite/build as appropriate.
