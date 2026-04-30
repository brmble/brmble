# LiveKit Roadmap Refresh Implementation Plan

> **Historical note:** This implementation plan is retained as an implemented historical record for the shipped roadmap refresh. The task-by-task checklist body below is intentionally preserved as the original implementation record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status note:** Implemented. This plan is kept as a historical implementation record for the shipped roadmap refresh, including the preserved task-by-task checklist.

**Goal:** Historical implementation record for the shipped LiveKit/screenshare doc refresh that updated the roadmap, recent fix docs, and historical phase docs to reflect the implemented state and chosen next-phase-priority structure.

**Architecture:** This refresh treated `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md` as the current source of truth, updated April fix docs to read as landed work, and added short historical-note banners to older March LiveKit docs rather than rewriting them. It also folded the relevant open issues and known roadmap gaps into the refreshed roadmap so the next phase is visible without chasing GitHub and old specs, while keeping the Sub-Projects table on consistent lifecycle statuses and leaving E/F priority framing in the header, issue shortlist, and build-order sections. As part of that historical cleanup, `docs/superpowers/plans/2026-04-21-screenshare-self-slot.md` was treated as a pre-existing workspace plan file that this refresh also brought under version control; its original body remained intentionally preserved.

**Tech Stack:** Markdown docs, GitHub issues, existing `docs/superpowers/specs` and `docs/superpowers/plans` conventions

---

## File Map

- Modify: `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`
  Purpose: make the roadmap the clear current source of truth, mark implemented work, and state the next-phase priority plus issue shortlist without using special priority-only statuses in the Sub-Projects table.
- Modify: `docs/superpowers/specs/2026-04-21-screenshare-self-slot-design.md`
  Purpose: mark the self-slot/sidebar cleanup spec as implemented.
- Modify: `docs/superpowers/specs/2026-04-25-screen-share-auto-stop-design.md`
  Purpose: mark the auto-stop lifecycle hardening spec as implemented.
- Modify: `docs/superpowers/specs/2026-04-25-screen-share-picker-cancel-design.md`
  Purpose: mark the picker-cancel spec as implemented.
- Modify: `docs/superpowers/plans/2026-04-21-screenshare-self-slot.md`
  Purpose: label the pre-existing workspace plan as completed historical implementation work and bring it under version control as part of the refresh.
- Modify: `docs/superpowers/plans/2026-04-25-screen-share-auto-stop.md`
  Purpose: label the plan as completed historical implementation work.
- Modify: `docs/superpowers/plans/2026-04-25-screen-share-picker-cancel.md`
  Purpose: label the plan as completed historical implementation work.
- Modify: `docs/plans/2026-03-05-livekit-screen-share-design.md`
  Purpose: add a historical note that this was the publish-only phase.
- Modify: `docs/plans/2026-03-05-livekit-screen-share-impl.md`
  Purpose: add a historical note that this implementation plan describes the earlier publish-only phase.
- Modify: `docs/plans/2026-03-06-livekit-screen-share-viewer-design.md`
  Purpose: add a superseded note that this viewer design predates the current multi-share/manual-opt-in architecture.
- Modify: `docs/plans/2026-03-06-livekit-screen-share-viewer-impl.md`
  Purpose: add a superseded note that this implementation plan predates the current architecture.
- Modify: `docs/plans/2026-03-09-livekit-token-hardening-design.md`
  Purpose: label it as precursor material for the E/F hardening phase rather than the primary current roadmap.
- Modify: `docs/plans/2026-03-09-livekit-token-hardening.md`
  Purpose: label it as precursor implementation planning material for the future E/F phase.

### Task 1: Refresh The Master Roadmap

**Files:**
- Modify: `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`

- [ ] **Step 1: Update the roadmap header and sub-project table to match the current state**

Edit the header area so it no longer says only sub-project A is designed. Change the status language and keep the sub-project table on consistent lifecycle statuses, with next-phase priority called out in the header/build-order material instead of special table labels.

```md
# LiveKit & Screen Sharing Feature Roadmap

**Date:** 2026-04-17
**Status:** Active roadmap. Foundation and recent hardening fixes implemented; next recommended phase is E. Token & Security, then F. Connection & Reliability.

This is the master feature list for LiveKit and screen sharing work. Completed sub-projects and shipped follow-up fixes are tracked here, while future work should continue through design -> plan -> implementation cycles.

## Sub-Projects

| ID | Name | Status | Spec |
|----|------|--------|------|
| A | Multi-Share Foundation | Implemented | `2026-04-17-multi-share-foundation-design.md` |
| A2 | Multi-Share Layouts | Implemented | `2026-04-20-multi-share-layouts-design.md` |
| B | Broadcaster Controls | Not started | -- |
| C | Viewing Experience | Not started | -- |
| D | Game Overlay | Not started | -- |
| E | Token & Security | Not started | -- |
| F | Connection & Reliability | Not started | -- |
| G | UI/UX Polish | Not started | -- |
| H | Clips & Screenshots | Not started | -- |
| I | Performance & Quality | Not started | -- |
| J | Viewer Interaction | Not started | -- |
```

- [ ] **Step 2: Update section A so it reflects implemented multi-view behavior**

Replace the stale “one active view at a time” wording and add a short implementation summary for the recent fix wave.

```md
## A. Multi-Share Foundation (Implemented)

> Multiple people sharing at once -- infrastructure that many other features depend on.

1. Simultaneous shares in the same channel
2. Share switcher via channel user list monitor icons (clickable)
3. ~~Grid/mosaic view~~ -> moved to A2 (implemented)
4. ~~Primary + thumbnail layout~~ -> moved to A2 (implemented)
5. Auto-switch on activity (optional) -- future
6. ~~Share pinning~~ -> deferred (not in A2 scope)

**Current shipped behavior:** one LiveKit room per channel, lazy room creation, one share per user, manual opt-in viewing, and multi-view layouts for up to four watched shares.

**Recent shipped follow-up fixes:**
- self-slot/sidebar cleanup (`2026-04-21-screenshare-self-slot-design.md`)
- auto-stop when capture ends externally (`2026-04-25-screen-share-auto-stop-design.md`)
- picker-cancel handling without false error state (`2026-04-25-screen-share-picker-cancel-design.md`)
```

- [ ] **Step 3: Add a next-phase issue shortlist and issue-gap note to the roadmap**

Add a compact section near the build-order area so the roadmap names the actual GitHub issues and the still-untracked gaps.

```md
## Next-Phase Issue Shortlist

The next hardening phase should start with these open issues:

- `#349` `[SECURITY] /livekit/active-share endpoint has no authentication`
- `#351` `[SECURITY] No rate limiting on any endpoint`
- `#354` `[SECURITY] LiveKit tokens have no early revocation`
- `#380` `feat: Reconnect non-voice services independently when Mumble stays connected`
- `#359` `Disable Screenshare button and keybinding while LiveKit is connecting`

Known roadmap gaps with no dedicated issue yet:

- token scoping for publish vs subscribe-only tokens
- token rotation / refresh before expiry
- room-level permissions tied to channel permissions
- auto-reconnect on drop
- share state recovery after crash
- connection quality indicator and graceful degradation
```

- [ ] **Step 4: Adjust the suggested build order so E and F are clearly the current recommendation**

Make the sequencing section read as a current recommendation rather than a historical suggestion.

```md
## Suggested Build Order

The recommended next sequence is:

1. **A. Multi-Share Foundation** -- implemented
2. **A2. Multi-Share Layouts** -- implemented
3. **E. Token & Security** -- next priority; close the current auth and permission gaps before expanding feature surface
4. **F. Connection & Reliability** -- harden reconnect, recovery, and connection-state behavior immediately after E
5. **C. Viewing Experience** -- pop-out, PiP, fullscreen
6. **B. Broadcaster Controls** -- window picker, audio, quality presets
7. **D. Game Overlay** -- depends on C and the voice system
8. **G. UI/UX Polish** -- refinements across all features
9. **I. Performance & Quality** -- optimization pass
10. **H. Clips & Screenshots** -- capture features
11. **J. Viewer Interaction** -- social features last
```

- [ ] **Step 5: Read the roadmap file to verify the updated wording is coherent**

Run: `git diff -- docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`

Expected: Diff shows only roadmap-status, current-state, and next-phase guidance updates with no accidental restructuring.

- [ ] **Step 6: Keep `Invite to Watch` placement explicit and non-duplicated**

If needed, add a short clarification in the roadmap so `Invite to watch` is clearly intentional under G's context-menu polish item and is not repeated under J.

Expected: The roadmap reads as deliberate, with no ambiguity about whether `Invite to watch` was accidentally dropped from Viewer Interaction.

### Task 2: Mark The April Fix Specs And Plans As Landed Work

**Files:**
- Modify: `docs/superpowers/specs/2026-04-21-screenshare-self-slot-design.md`
- Modify: `docs/superpowers/specs/2026-04-25-screen-share-auto-stop-design.md`
- Modify: `docs/superpowers/specs/2026-04-25-screen-share-picker-cancel-design.md`
- Modify: `docs/superpowers/plans/2026-04-21-screenshare-self-slot.md`
- Modify: `docs/superpowers/plans/2026-04-25-screen-share-auto-stop.md`
- Modify: `docs/superpowers/plans/2026-04-25-screen-share-picker-cancel.md`

- [ ] **Step 1: Update the three April design specs from approved to implemented**

Apply the same status pattern to each spec so they read as historical records of landed fixes.

```md
**Status:** Implemented
```

For the opening overview paragraph of each file, add one short sentence like:

```md
This fix has landed and is kept here as the design record for the shipped behavior.
```

- [ ] **Step 2: Add a completion banner to each April implementation plan**

Insert this note directly below each title block, before the first task section:

```md
> **Status note:** Implemented. This plan is kept as a historical implementation record for the shipped fix.
```

- [ ] **Step 3: Verify the six files now read as completed records rather than active work**

Run: `git diff -- docs/superpowers/specs/2026-04-21-screenshare-self-slot-design.md docs/superpowers/specs/2026-04-25-screen-share-auto-stop-design.md docs/superpowers/specs/2026-04-25-screen-share-picker-cancel-design.md docs/superpowers/plans/2026-04-21-screenshare-self-slot.md docs/superpowers/plans/2026-04-25-screen-share-auto-stop.md docs/superpowers/plans/2026-04-25-screen-share-picker-cancel.md`

Expected: Each diff is limited to status and framing text, with no change to the historical technical content.

### Task 3: Add Historical Notes To The March LiveKit Docs

**Files:**
- Modify: `docs/plans/2026-03-05-livekit-screen-share-design.md`
- Modify: `docs/plans/2026-03-05-livekit-screen-share-impl.md`
- Modify: `docs/plans/2026-03-06-livekit-screen-share-viewer-design.md`
- Modify: `docs/plans/2026-03-06-livekit-screen-share-viewer-impl.md`
- Modify: `docs/plans/2026-03-09-livekit-token-hardening-design.md`
- Modify: `docs/plans/2026-03-09-livekit-token-hardening.md`

- [ ] **Step 1: Add a publish-only historical note to the March 5 docs**

Insert this note after the title in both March 5 files:

```md
> **Historical note:** This document describes the original publish-only LiveKit phase. The current source of truth for LiveKit/screenshare status and sequencing is `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`.
```

- [ ] **Step 2: Add a superseded-architecture note to the March 6 viewer docs**

Insert this note after the title in both March 6 files:

```md
> **Historical note:** This document predates the current multi-share, manual-opt-in viewing architecture and is retained for history only. See `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md` and the April LiveKit specs for the current direction.
```

- [ ] **Step 3: Add a precursor note to the March 9 token-hardening docs**

Insert this note after the title in both March 9 files:

```md
> **Historical note:** This document is useful precursor material for the upcoming Token & Security / Connection & Reliability hardening phase, but it is not the primary current roadmap.
```

- [ ] **Step 4: Read the March-doc diff to confirm the notes are short and non-destructive**

Run: `git diff -- docs/plans/2026-03-05-livekit-screen-share-design.md docs/plans/2026-03-05-livekit-screen-share-impl.md docs/plans/2026-03-06-livekit-screen-share-viewer-design.md docs/plans/2026-03-06-livekit-screen-share-viewer-impl.md docs/plans/2026-03-09-livekit-token-hardening-design.md docs/plans/2026-03-09-livekit-token-hardening.md`

Expected: Diff shows only short top-of-file notes, preserving the original historical content.

### Task 4: Verify And Commit The Documentation Refresh

**Files:**
- Modify: all files changed in Tasks 1-3

- [ ] **Step 1: Review the full doc-only diff**

Run: `git diff -- docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md docs/superpowers/specs/2026-04-21-screenshare-self-slot-design.md docs/superpowers/specs/2026-04-25-screen-share-auto-stop-design.md docs/superpowers/specs/2026-04-25-screen-share-picker-cancel-design.md docs/superpowers/plans/2026-04-21-screenshare-self-slot.md docs/superpowers/plans/2026-04-25-screen-share-auto-stop.md docs/superpowers/plans/2026-04-25-screen-share-picker-cancel.md docs/plans/2026-03-05-livekit-screen-share-design.md docs/plans/2026-03-05-livekit-screen-share-impl.md docs/plans/2026-03-06-livekit-screen-share-viewer-design.md docs/plans/2026-03-06-livekit-screen-share-viewer-impl.md docs/plans/2026-03-09-livekit-token-hardening-design.md docs/plans/2026-03-09-livekit-token-hardening.md`

Expected: All changes are documentation-only, scoped to status, sequencing, and historical-context framing.

- [ ] **Step 2: Check git status to confirm only intended docs changed**

Run: `git status --short`

Expected: Only the roadmap refresh spec, plan, and intended LiveKit/screenshare docs appear as modified or added.

- [ ] **Step 3: Commit the documentation refresh**

```bash
git add docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md docs/superpowers/specs/2026-04-21-screenshare-self-slot-design.md docs/superpowers/specs/2026-04-25-screen-share-auto-stop-design.md docs/superpowers/specs/2026-04-25-screen-share-picker-cancel-design.md docs/superpowers/specs/2026-04-30-livekit-roadmap-refresh-design.md docs/superpowers/plans/2026-04-21-screenshare-self-slot.md docs/superpowers/plans/2026-04-25-screen-share-auto-stop.md docs/superpowers/plans/2026-04-25-screen-share-picker-cancel.md docs/superpowers/plans/2026-04-30-livekit-roadmap-refresh.md docs/plans/2026-03-05-livekit-screen-share-design.md docs/plans/2026-03-05-livekit-screen-share-impl.md docs/plans/2026-03-06-livekit-screen-share-viewer-design.md docs/plans/2026-03-06-livekit-screen-share-viewer-impl.md docs/plans/2026-03-09-livekit-token-hardening-design.md docs/plans/2026-03-09-livekit-token-hardening.md
git commit -m "docs: refresh livekit roadmap and historical plans"
```

- [ ] **Step 4: Confirm the commit landed cleanly**

Run: `git log --oneline -n 1`

Expected: The latest commit is `docs: refresh livekit roadmap and historical plans`.
