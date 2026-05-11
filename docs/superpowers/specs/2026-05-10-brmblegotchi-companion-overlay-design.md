# Brmblegotchi Companion Overlay Design

**Date:** 2026-05-10
**Status:** Approved for planning

## Goal

Reposition Brmblegotchi from a Tamagotchi-style maintenance widget into a companion overlay that helps users stay aware of live Brmble activity. The new Brmblegotchi should surface current speakers, channel chat, DMs, and join/leave/moderation events in a companion-led overlay, with both a `Full Companion` and `Minimal` presentation mode.

---

## Overview

The current Brmblegotchi implementation is built around virtual-pet behaviors:

- Stat decay (`hunger`, `happiness`, `cleanliness`)
- Care actions (`feed`, `play`, `clean`, `sleep`)
- Growth stages (`egg` through `ghost`)
- Theme-specific pet rendering in a sidebar widget

That loop no longer matches the product direction. The new direction is a companion-first overlay that behaves more like a living in-game notification layer than a pet you maintain.

This redesign keeps the name and high-level companion identity, but changes the feature's core job:

- From: "care for a pet during downtime"
- To: "stay aware of social and voice activity through a friendly overlay companion"

The Codex pet reference is useful here because it emphasizes desktop presence, expressive sprite behavior, and companion-like personality without requiring gameplay systems.

---

## Product Requirements

### User-visible behavior

When the overlay is enabled, Brmblegotchi can surface:

1. Channel messages for the channel the user is currently in.
2. Direct messages.
3. Join events.
4. Leave events.
5. Moderation events such as kick and ban.
6. Active speakers in the current voice channel.

Displayed message examples:

- `ChannelMaui: hi there`
- `DM from Qy: how are you`
- `Kira joined the channel`
- `Milo left the channel`
- `Qy was kicked from the channel`

### Scope boundaries

Brmblegotchi should remain narrow and trustworthy:

- It should only announce chat, DM, join/leave, moderation, and speaker activity.
- It should not become a general assistant or commentator on unrelated app state.
- It should not reintroduce Tamagotchi upkeep loops such as hunger, cleanliness, or care actions.
- It should not require users to interact with it to keep it "healthy."

### Presentation modes

The overlay must support two presentation modes:

1. `Full Companion`
2. `Minimal`

Both modes share the same underlying event logic and settings. The only difference is presentation.

### Default verbosity

Default behavior should be low-noise:

- Important direct events are shown clearly.
- Channel messages are shown only for the channel the user is currently in.
- Speaker display is live and compact.
- The system should prefer concise, factual wording.

---

## Visual Direction

### Full Companion

`Full Companion` should make Brmblegotchi feel like a small desktop creature rather than a boxed widget:

- Animated sprite-led presentation
- Strong, readable silhouette
- Expressive but restrained motion
- Event bubbles or captions visually attached to the companion
- Live speaker stack placed near the companion

The companion's personality should come through in pose, animation timing, and expression, not by rewriting important event text into jokes or roleplay.

### Minimal

`Minimal` should prioritize readability and low distraction:

- Clean overlay panel
- Speaker stack as the primary persistent element
- Event lines rendered in a compact notification list
- Little or no visible mascot framing

If Brmblegotchi appears at all in this mode, it should be a small accent rather than the visual anchor.

### States

The new visual states should reflect overlay duties rather than pet simulation:

- `idle`
- `message`
- `dm`
- `moderation-alert`
- `speaking-nearby`
- `quiet`

These states replace the old pet-health framing as the primary experience.

---

## Settings Design

Settings should live under `Interface -> In-Game Overlay`.

### Core settings

- `Enable Companion Overlay`
- `Overlay Mode`
  - `Full Companion`
  - `Minimal`
- `Show Channel Messages`
- `Show Direct Messages`
- `Show Join/Leave Events`
- `Show Moderation Events`
- `Show Active Speakers`

### Settings behavior

- Disabling the overlay hides all Brmblegotchi overlay UI.
- Switching modes updates presentation immediately without changing which events are enabled.
- Event toggles apply to both modes.
- Existing Brmblegotchi theme/game settings should be evaluated during implementation for removal, migration, or de-emphasis if they conflict with the companion direction.

---

## Architecture

The redesign should split Brmblegotchi into shared event logic plus two presentation shells.

### Shared overlay model

Introduce a shared overlay state model that is independent from the old pet simulation state.

Suggested responsibilities:

- Receive and normalize overlay-worthy events from chat, DM, voice, and moderation sources.
- Maintain a bounded queue of recent display events.
- Maintain a live set of active speakers for the current voice channel.
- Apply user settings to filter what is shown.
- Expose presentation-friendly state to the UI.

### Presentation shells

Two UI shells consume the same shared overlay model:

1. `Full Companion Overlay`
2. `Minimal Overlay`

This keeps business logic consistent while letting presentation diverge.

### Existing Brmblegotchi boundaries

The current `Brmblegotchi.tsx` is heavily coupled to:

- local pet stats
- growth state
- theme selection
- local storage persistence for pet position and pet state

That file should not simply absorb overlay behavior. The redesign should separate:

- overlay event state
- overlay presentation
- any optional legacy appearance/theme migration logic

This likely means creating new overlay-focused modules instead of continuing to extend the current pet component as the single source of truth.

---

## Data Flow

### Event sources

The companion overlay needs data from these sources:

1. Current channel chat messages
2. Direct messages
3. Channel membership events
4. Moderation events
5. Voice speaking state for the current channel

### Event normalization

Raw events should be normalized into a compact overlay event format.

Suggested conceptual shapes:

- `channel-message`
- `direct-message`
- `user-joined`
- `user-left`
- `user-kicked`
- `user-banned`

Each event should carry:

- event type
- actor name or source name
- optional target name
- optional message text
- timestamp
- channel relevance

### Speaker state model

Speaker activity should not use the same queue behavior as message events. It needs a short-lived live model:

- up to 2-3 active speakers visible at once
- names update as speaking activity changes
- entries decay away shortly after speech stops
- stack reflects the current voice channel only

This should be modeled as active speaker state, not as a stream of text notifications.

### Rendering flow

1. App-level event source emits raw activity.
2. Overlay event adapter normalizes the activity.
3. User settings filter out disabled categories.
4. Shared overlay store updates:
   - recent event queue
   - active speaker stack
5. Selected presentation shell renders the result.

---

## Interaction Rules

### Message rules

- Channel messages should appear only for the channel the user is currently in.
- DMs should always be eligible when DM events are enabled.
- Event text should remain plain and factual by default.
- Full Companion mode may add light expressive framing visually, but the message body should remain readable and trustworthy.

### Speaker rules

- Speaker display should show up to 2-3 active names.
- It should prefer currently active speakers over stale entries.
- When many people speak rapidly, the stack should remain stable and readable rather than thrashing.
- A speaker starting to talk should update the live stack immediately.
- A speaker stopping should fade out after a short grace period instead of disappearing instantly.

### Overlay behavior

- Overlay content should stay on top when the user has enabled overlay behavior.
- Full Companion mode should feel attached to a character.
- Minimal mode should feel like a polished VOIP overlay, not a pet UI with pieces removed.

---

## Error Handling And Edge Cases

### Missing or partial data

- If an event arrives without a message body, render a safe fallback line rather than nothing.
- If a user name is unavailable, use a neutral fallback like `Unknown user`.
- If a moderation event lacks a target, do not invent one.

### Event flooding

- Rapid join/leave churn should not overwhelm the overlay.
- The shared event queue should be bounded.
- Implementation should consider event coalescing or aggressive expiry for noisy categories if needed.

### Speaker churn

- Rapid speaker switching should not cause visible flicker.
- The speaker stack should use a short decay window so names feel stable.
- If more than 3 people are active, the overlay should show only the top visible subset rather than trying to render everyone.

### Overlay-off behavior

- When companion overlay is disabled, no overlay presentation should render.
- Underlying subscriptions may still exist if shared infrastructure requires them, but hidden UI should not accumulate stale visible state that flashes when re-enabled.

---

## Migration

The redesign should treat the current Tamagotchi implementation as legacy behavior.

### What should stop defining the product

- Hunger, happiness, and cleanliness as the main state model
- Care buttons as the main interaction loop
- Growth progression as the main reason to keep Brmblegotchi enabled

### Migration expectations

- Existing users should be able to opt into the new companion overlay through the overlay settings area.
- Legacy settings should not break startup if they still exist in storage.
- The implementation plan should decide whether old Brmblegotchi settings are:
  - migrated
  - hidden
  - removed
  - temporarily supported alongside the new overlay

The important design constraint is that legacy pet systems must not continue to shape the new experience.

---

## Testing Strategy

### Unit-level

Add tests around shared overlay logic:

- event normalization
- settings-based filtering
- queue bounding
- active speaker stack updates
- speaker decay timing

### UI-level

Add frontend tests for:

- mode switching between `Full Companion` and `Minimal`
- event toggle behavior
- rendering channel messages, DMs, and moderation events
- rendering up to 2-3 speaker names
- hidden overlay behavior when disabled

### Integration-level

Verify end-to-end behavior for:

1. Receiving a channel message while inside that channel
2. Receiving a DM
3. A user joining or leaving
4. A user being kicked or banned
5. Multiple users speaking in quick succession
6. Switching overlay modes without losing event subscriptions or state consistency

---

## Recommendation For Planning

The implementation plan should treat this as a companion-overlay redesign, not a pet-feature extension. The safest path is to build:

1. Shared overlay event model and state
2. Minimal overlay shell
3. Full Companion shell
4. Settings integration under `Interface -> In-Game Overlay`
5. Legacy Brmblegotchi migration/deprecation decisions

That order keeps the data model and VOIP overlay behavior correct before investing in the more expressive companion presentation.
