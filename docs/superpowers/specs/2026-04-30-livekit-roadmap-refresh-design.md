# LiveKit Roadmap Refresh Design

**Date:** 2026-04-30
**Status:** Approved
**Scope:** Refresh LiveKit/screenshare docs so roadmap, plans, and historical design docs match the current implementation state and the chosen roadmap structure for next-phase priority.

## Overview

Brmble's LiveKit/screenshare documentation now has a mix of current roadmap docs, recently implemented fix specs, and older phase docs that no longer describe the shipped architecture. This refresh keeps the existing document set but makes the current status legible: foundation and recent hardening work are implemented, the next recommended phase is security first and reliability second, the roadmap table uses lifecycle statuses consistently, and older March docs are retained only as historical references.

## Goals

- Update the master LiveKit/screenshare roadmap to reflect implemented work through the recent fix wave.
- Mark recent fix specs and plans as implemented/completed rather than still approved/in-progress.
- Add clear historical or superseded notes to older March LiveKit/screenshare docs that no longer match the current architecture.
- Record the relevant open GitHub issues for the next phase and note roadmap gaps where no issue exists yet.

## Non-Goals

- Redesign the LiveKit/screenshare feature roadmap itself.
- Create implementation plans for Token & Security or Connection & Reliability.
- Rewrite older historical docs to match the new architecture line by line.
- Change non-LiveKit project docs.

## Current Problem

The repo currently mixes three documentation eras:

1. older March phase docs that still describe publish-only or single-share assumptions
2. the April roadmap and design docs that describe the current multi-share direction
3. recently merged fixes whose specs still read as merely approved even though they are already shipped

That makes it harder to answer basic planning questions such as:

- what is already done
- which docs are current source of truth
- what should be built next
- which open issues directly support the next phase

## Proposed Documentation Shape

### 1. Master roadmap becomes the clear source of truth

Update `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md` so it explicitly states:

- A. Multi-Share Foundation is implemented
- A2. Multi-Share Layouts is implemented
- the recent follow-up fix wave is implemented:
  - self-slot/sidebar cleanup
  - auto-stop on capture end
  - picker-cancel handling
- the recommended next phase is:
  1. E. Token & Security
  2. F. Connection & Reliability

Keep the Sub-Projects table on consistent lifecycle statuses such as `Implemented` and `Not started`. Keep the E/F priority framing in the status line, next-phase issue shortlist, and suggested build order rather than encoding it as special table statuses.

The roadmap should also stop implying the product is still single-view-only where that conflicts with current multi-view behavior. Keep `Invite to watch` under G as part of the context-menu polish item, and avoid reintroducing it under J so the placement reads as intentional rather than duplicated.

### 2. Recent fix specs/plans are marked complete

Update the April fix docs so their status lines and opening context reflect that the work has landed.

Files:

- `docs/superpowers/specs/2026-04-21-screenshare-self-slot-design.md`
- `docs/superpowers/specs/2026-04-25-screen-share-auto-stop-design.md`
- `docs/superpowers/specs/2026-04-25-screen-share-picker-cancel-design.md`
- `docs/superpowers/plans/2026-04-21-screenshare-self-slot.md`
- `docs/superpowers/plans/2026-04-25-screen-share-auto-stop.md`
- `docs/superpowers/plans/2026-04-25-screen-share-picker-cancel.md`

These should read as completed historical implementation records, not active plans.

### 3. Older March docs get historical/superseded notes

Keep the early LiveKit docs for context, but add a short banner or note at the top explaining that they describe an earlier phase and are no longer the current architectural source of truth.

Files:

- `docs/plans/2026-03-05-livekit-screen-share-design.md`
- `docs/plans/2026-03-05-livekit-screen-share-impl.md`
- `docs/plans/2026-03-06-livekit-screen-share-viewer-design.md`
- `docs/plans/2026-03-06-livekit-screen-share-viewer-impl.md`
- optionally `docs/plans/2026-03-09-livekit-token-hardening-design.md`
- optionally `docs/plans/2026-03-09-livekit-token-hardening.md`

The March 9 token-hardening docs are still useful input for next-phase work, so they should be marked as precursor material rather than simply obsolete.

### 4. Next-phase issues are visible in docs

The roadmap refresh should reference the current issue shortlist that supports the next phase:

- `#349` auth on `/livekit/active-share`
- `#351` rate limiting on endpoints
- `#354` token revocation
- `#380` independent non-voice reconnect
- `#359` disable screenshare while connecting

The docs should also note gaps where the roadmap has next-phase work but no dedicated issue yet:

- token scoping
- token rotation
- room-level permissions tied to channel permissions
- auto-reconnect on drop
- share state recovery after crash
- quality indicator and graceful degradation

## Editing Strategy

Use minimal edits:

- change status lines and short intro paragraphs where possible
- add concise historical-note banners instead of rewriting old docs
- update the roadmap's status line, table wording, build order, and next-phase notes without restructuring the whole document

This keeps the refresh small, reviewable, and faithful to the repository history.

## Risks

- Over-editing older docs could erase useful history instead of clarifying it.
- If the roadmap is updated without enough issue context, the next phase may still be underspecified.
- If older docs are not clearly labeled, contributors may still treat them as current.

## Success Criteria

- A reader can identify the current LiveKit/screenshare source of truth within one minute.
- The roadmap clearly shows what is implemented and what is recommended next.
- Recent April fix docs read as landed work.
- March LiveKit/screenshare docs are clearly labeled as historical or superseded.
- The next-phase issue shortlist and issue gaps are visible in the current docs.
