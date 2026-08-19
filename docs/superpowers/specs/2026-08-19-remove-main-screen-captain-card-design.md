# Remove Duplicate Main-Screen Captain Progress Card

## Goal

Remove the duplicate `Next Captain — Cash saved` progress card from the Neon-D main screen because the same Captain progress and hiring flow is already available in Dealer and Captain management.

## Scope

- Remove the Captain milestone section from `src/components/NeonD/NeonDGame.tsx`.
- Remove any main-screen-only interaction that exists solely to support that section.
- Keep the Captain progress display and recruitment controls in `DealerHiringModal.tsx` unchanged.
- Preserve all other main-screen panels, Captain state calculations, and management behavior.

## Approach

Remove the render path rather than hiding it with CSS or leaving a disabled card. This avoids duplicate accessible content and removes the obsolete entry point while keeping the shared management flow intact.

## Testing

Update the Neon-D game UI tests so the main screen is asserted not to render the Captain recruitment progress card, while the existing management tests continue to cover Captain progress and recruitment. Run the focused test file, then the web type-check/build as available.

## Acceptance criteria

1. The main Neon-D screen does not render `Next Captain — Cash saved`, its progress bar, or its `Hire Captain` button.
2. Dealer and Captain management still renders Captain progress and recruitment controls.
3. Existing unrelated Neon-D behavior remains covered and passing.
