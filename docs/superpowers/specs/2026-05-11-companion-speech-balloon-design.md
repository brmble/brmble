# Companion Speech Balloon Design

**Date:** 2026-05-11
**Status:** Draft for review
**Related:** `docs/superpowers/specs/2026-05-11-companion-overlay-next-design.md`

## Goal

Make the `Full Companion` overlay bubble render as a clear speech balloon that feels attached to the active companion sprite.

## Scope

This change applies only to the shared `Full Companion` rendering path.

In scope:

- style the existing companion bubble as a speech balloon
- keep the current text content and visibility rules
- make the balloon tail mirror correctly for left and right overlay positions
- preserve the shared behavior for every enabled companion

Out of scope:

- changing overlay model behavior
- changing bubble timing or message text
- changing `Minimal` mode
- introducing companion-specific balloon art or per-companion variants

## Current Baseline

Today, `FullCompanionOverlay` already renders:

- one active companion sprite
- an optional text bubble when `display.bubble` exists
- the same shared structure for all companions

That means the correct place for this change is the shared overlay markup and CSS, not the companion asset system.

## Recommended Approach

Use the existing `aside.companion-bubble` and convert it into a speech balloon with CSS.

Why this approach:

- it is the smallest code change
- it preserves the existing accessibility behavior
- it automatically applies to all companions that use `Full Companion`
- it avoids unnecessary overlay-model or asset churn

## Visual Design

The bubble should read as a speech balloon rather than loose floating text.

Required treatment:

- a filled balloon panel behind the text
- rounded corners
- a light border or outline so the balloon stays readable over games and video
- a soft shadow for separation
- a tail that visually points back toward the companion sprite

The text should remain compact and readable, using the current message body without rewriting copy.

## Position Rules

The balloon tail should adapt to overlay position so it still appears attached to the sprite.

Rules:

- `top-left` and `bottom-left` positions use a left-anchored tail
- `top-right` and `bottom-right` positions use a right-anchored mirrored tail
- the tail should emerge from the lower portion of the balloon so it feels connected to the sprite below or beside it

This can be handled with position-aware CSS selectors rather than separate components.

## Accessibility And Behavior

Behavior stays the same:

- the balloon renders only when `display.bubble` exists
- the text content is unchanged
- the `role="status"` and `aria-live="polite"` behavior remains intact

The change is presentational, not behavioral.

## Testing

Add a focused render test around the full overlay so the speech-balloon structure remains intentional.

Recommended verification:

- confirm full overlay still renders the bubble text for active chat
- confirm the bubble keeps its accessible status role
- confirm the bubble exposes a stable class or attribute that represents the speech-balloon styling
- run the existing companion overlay tests to ensure no regression in `Minimal` mode or sprite rendering

## Implementation Notes

Expected files:

- `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
- `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

The implementation should prefer minimal markup change. If the tail can be expressed cleanly with pseudo-elements, that is preferred over adding dedicated tail nodes.
