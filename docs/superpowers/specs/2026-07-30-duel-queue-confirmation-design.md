# Duel Queue Confirmation and Ready Context Design

## Goal

Confirm to both participants that an accepted challenge actually entered the queue, and give the
ready-check notification enough context to act on without opening the duel activity panel.

## Background

`docs/superpowers/specs/2026-07-26-queued-duel-feedback-design.md` decided that acceptance would
produce no notification, on the reasoning that "the complete queue snapshot becomes the ongoing
status indicator." The channel duel badge highlight was the personal affordance.

In practice that leaves a void. The challenge notification clears on `game.accepted` (correct — its
buttons would otherwise send commands for an offer that no longer exists), but nothing replaces it.
Both players are left unsure whether the challenge succeeded. The badge highlight is too peripheral
to answer that question, and the queue snapshot only answers it if you go looking for it.

This design reverses the "no accepted notification" decision for the **confirmation** case only. It
does not add ongoing queue-position status; the panel remains the place for that.

## Queue Placement Confirmation

### Trigger

Derived from queue snapshots, not from the `game.accepted` event.

A hook tracks the set of `reservationId`s where the local session is a participant **and** the entry
sits in `queue[]`. When an id enters that set, the confirmation fires once for that reservation.

`game.accepted` carries an `offerId` while snapshots carry a `reservationId`, and the two do not
correlate directly. Deriving from snapshots avoids both that correlation problem and the race
between the event and the snapshot that reflects it.

### Immediate-start suppression

When a pair is accepted into an idle channel, the orchestrator appends the reservation and promotes
it to a ready check before the snapshot is built. The client therefore never observes that
reservation in `queue[]`, and no confirmation fires. The suppression is structural rather than a
special case: there is no "is this about to become a ready check?" test to get wrong.

A confirmation followed immediately by "Ready to play?" would be noise, and this avoids it without
timing heuristics.

### Baseline guard

The first snapshot observed for a channel seeds the tracked set without firing. Without this, a
reconnect or a recovery snapshot would replay a confirmation for a reservation that was queued
minutes ago.

The guard is per channel, keyed on first observation of that channel's snapshot, so joining a second
channel later does not replay its existing queue either.

### Presentation

Shared top-right `<Notification>` via `useNotificationQueue` under the stable id `game-queued`.

- Status: `info`
- Title: `Challenge accepted`
- Detail: the pair line (`Qy vs Broan`), then `Rock Paper Scissors · bo3`
- Auto-dismiss on the default `info` timer; no action buttons

No new visual pattern, no new tokens, no count badge.

### Optional notification setting

This is a repeatable informational notification, so per `docs/UI_GUIDE.md` §13 it is gated behind
both the global `Disable optional notifications` switch and its own category toggle.

A new category key `notificationDuelQueued` joins the existing four
(`notificationRemoteScreenShare`, `notificationScreenShareStatus`, `notificationIdleWarning`,
`notificationMovedChannel`). It defaults to on, is normalized by
`normalizeOptionalNotificationSettings`, gated by `shouldShowOptionalNotification`, and gets a
toggle row in `MessagesSettingsTab`.

## Ready Check Notification Context

The ready-check notification currently shows only `Deathroll · 1v1`. It does not say who you are
about to play, which is the fact most needed before pressing Ready.

The 2026-07-26 spec did add an estimated duration to the ready **card** in the duel activity panel.
It did not cover the ready **notification**, which is what a player actually sees.

The notification's `detail` becomes a structured node mirroring the panel's ready card:

- the pair line (`Qy vs Broan`)
- `Deathroll · 1v1 · Estimated duration: ~10s`

`Estimated duration: Unknown` when the server has too few samples, matching the card.

Both values are already available on the client: `readyCheck.players` carries `displayName`, and
`readyCheck.estimatedDuration` was added to the wire contract by the 2026-07-26 work. No server
change and no new plumbing.

The card's rule that a ready check shows **no start ETA** still holds — participant readiness
controls advancement, so a start estimate would be misleading. Only the duration is added.

`title`, `detail`, and the action button are unchanged in structure; `<Notification>` already accepts
`React.ReactNode` for `detail`.

### Shared formatting

`formatDuration` and `estimateText` currently live inside `DuelQueueModal.tsx`. Mirroring the card
only stays true if both render from one implementation, so they move to a shared module that the
modal and the notification both import.

This is the reason the mirroring option was chosen over independent copy, and without the extraction
the two will drift the first time either is edited.

## Testing

Confirmation trigger:

- Fires when the local session newly appears in `queue[]`.
- Stays silent when the pair goes straight to `readyCheck` without appearing in `queue[]`.
- Stays silent for the first snapshot of a channel, including a recovery snapshot that already
  contains the local session in the queue.
- Ignores queue entries the local session is not part of.
- Fires once per reservation, not on every subsequent snapshot.

Presentation and settings:

- The confirmation renders the opponent pair and the game/format line.
- It is suppressed by the global optional-notification switch and by its own category toggle.
- The category defaults to on and normalizes like the existing four.

Ready notification:

- Renders the pair, the game/format line, and the estimated duration.
- Renders `Estimated duration: Unknown` when the estimate is unknown.
- Still shows no start ETA.

Shared formatting:

- The modal and the notification produce identical text for the same estimate.

`src/uiGuideCompliance.test.ts` continues to pass; no hardcoded colors, sizes, spacing, or radii.

## Out of Scope

- Ongoing queue-position or wait-time status outside the panel. The confirmation is a one-shot
  moment; the panel remains the place for live status.
- Any change to the channel duel badge highlight.
- Any server or wire change.
