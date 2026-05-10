# Neon-D Bug And Issue Report

Date: 2026-05-09

Scope reviewed:
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
- `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts`
- `src/Brmble.Web/src/components/NeonD/constants.ts`
- `src/Brmble.Web/src/App.tsx`
- Neon-D test suite under `src/Brmble.Web/src/components/NeonD/**`

Test run:
- `npm run test -- src/components/NeonD`
- Result: 45 tests passed across 3 files

## Executive summary

The Neon-D implementation is in decent shape at the unit-test level, but there are still several player-facing risks that the current tests do not catch. The strongest defects are:

1. Game progress is not saved when the Neon-D overlay is closed inside the app, so recent progress can be lost even though the feature appears to be persisted.
2. The current code and tests still leave some ambiguity around side-hustle behavior, but the "very strong across all unlocked products" scaling is a valid design choice rather than a bug.

There is also a smaller but still visible presentation issue where several UI glyphs appear to be mojibake rather than intended symbols.

## Findings

### 1. Closing the Neon-D overlay can discard recent progress

Severity: High

Files:
- `src/Brmble.Web/src/App.tsx:2627`
- `src/Brmble.Web/src/App.tsx:2628`
- `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts:72`
- `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts:88`
- `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts:90`
- `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts:92`

What happens:
- The game component is conditionally mounted with `showGame ? <NeonDGame ... /> : ...`.
- Persistence currently writes on a 30-second interval and on `beforeunload`.
- When the player closes the game overlay from inside the app, the component unmounts without saving immediately.

Why this is a bug:
- Closing the overlay is a normal in-app action, not a browser unload.
- Any progress earned since the last 30-second save can be lost even though the user expects the game to be persistent.

Player impact:
- Recent upgrades, hires, unlocks, and earnings can disappear after closing the game panel.
- The issue is likely to feel intermittent and frustrating because it depends on timing.

Suggested fix:
- Save on unmount cleanup, or persist on every state change with throttling/debouncing.
- Add a test that mounts the hook, changes state, unmounts, remounts, and verifies the latest state was retained.

### 2. Side-hustle design intent is underspecified in tests and UI text

Severity: Medium

Files:
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts:108`
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts:109`
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts:111`
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts:115`
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts:117`
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts:238`
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts:239`
- `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts:255`
- `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts:266`
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:76`
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:312`

What happens:
- Side-hustle currently applies 10% extra volume to every other unlocked product, which you confirmed is intentional.
- `buyEquipment` keeps stacking `sideVolume` with no clamp.
- One test still says the ratio is "capped at 0.9", but the assertion does not verify that cap and the implementation does not enforce one.
- The upgrade text and UI display do not make the intended "10% over all unlocked products" behavior especially explicit.

Why this matters:
- The code now appears consistent with your intended economy, but the tests and player-facing wording do not clearly document that intent.
- That creates a maintenance risk where a future cleanup could accidentally "fix" a deliberate power feature.
- It also makes the current report easy to misread unless the design choice is written down clearly.

Player impact:
- Players may not understand just how strong side-hustle is supposed to be.
- Future contributors may accidentally nerf or clamp a mechanic that is intentionally overpowered.

Suggested fix:
- Rename or rewrite the misleading cap test so it matches the intended design.
- Add one explicit test that documents the intended behavior: side-hustle applies its bonus across all other unlocked products.
- Consider updating the upgrade description/UI copy so the power is more obvious.

### 3. Neon-D UI contains mojibake characters instead of intended symbols

Severity: Medium

Files:
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:13`
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:130`
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:213`
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:224`
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:326`
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx:327`

Observed strings include:
- `â˜…`
- `â˜†`
- `Ã—`
- `ðŸ”„`
- `ðŸ”’`
- `â—`
- `â—‹`

Why this is a problem:
- If these bytes are present in the file as shown, players will see broken glyphs rather than stars, close icon, refresh icon, lock icon, and equipment dots.
- Even if some environments mask the issue, the source text is brittle and likely to render inconsistently.

Player impact:
- UI quality looks broken.
- Symbol-only controls become harder to understand at a glance.

Suggested fix:
- Replace the mojibake text with correct Unicode glyphs or, better, use icons/components so encoding is not a silent dependency.

## Test coverage gaps

The existing Neon-D test suite is healthy for basic hook behavior, but it does not currently protect the highest-risk player flows:

- No test verifies persistence across component unmount/remount.
- No test explicitly documents the intended side-hustle behavior across all unlocked products.
- No test verifies the actual rendered Neon-D UI for broken symbols or text.
- No integration test covers opening the game from `App.tsx`, making progress, closing it, and reopening it.

## Recommended next steps

1. Fix persistence-on-close first, because it directly causes user-visible progress loss.
2. Update the side-hustle tests and wording so they clearly encode the intended "really strong across unlocked products" behavior.
3. Add tests for unmount persistence and for intentional side-hustle scaling behavior.
4. Clean up the mojibake glyphs so the shipped UI is trustworthy and easier to polish.
