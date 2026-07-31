# Missed Ready Check Feedback Design

## Goal

Say plainly that an accepted challenge has been placed in the duel queue, and tell both players what
happened when a ready check expires instead of letting the notification silently vanish.

## Background

Two gaps found in manual testing of the queue confirmation work.

The confirmation notification is titled `Challenge accepted`. That reports the event but not its
consequence, so it does not answer the question the player actually has: am I in the queue?

More seriously, when a ready check expires nothing is reported at all. The server removes the
reservation (`DuelOrchestrator.ExpireReadyAsync`) and publishes
`game.commitmentCanceled { reservationId, reason: "expired" }` to both participants, but the web
client has no handler for that event. The ready notification simply disappears when the ready check
leaves the snapshot.

Expiry removes the reservation and promotes the next pair. That is by design: the queue holds pairs,
not individuals, and a player can hold only one commitment at a time, so there is no individual place
to preserve and nobody to requeue a lone ready player against. Getting back in means issuing a fresh
challenge, which joins the queue as a new pair at the back.

The gap is purely that none of this is reported. Both players are dropped from the queue in silence.

## Queue Confirmation Copy

The confirmation title becomes `Added to duel queue`. The detail is unchanged: the opponent pair,
then the game and format.

No behaviour, lifecycle, or settings change. The stable id stays `game-queued` and the
`notificationDuelQueued` category still gates it.

## Missed Ready Check

### Detection

A ref captures the last-seen ready check from snapshots: the reservation id and, per player, the
session id, display name, and `ready` flag. Snapshots already carry `players[].ready` — the duel
panel's ready card renders it — so no server or wire change is needed.

On `game.commitmentCanceled`, the handler acts only when `reason` is `expired` and the
`reservationId` matches the captured ready check.

The captured ref, rather than the live snapshot, is the source of truth for who readied. By the time
the event is handled the ready check may already have left the snapshot, and the ref is unaffected by
that ordering.

### Reason filtering

`game.commitmentCanceled` carries six reasons: `expired`, `declined`, `disconnected`, `leftChannel`,
`channelRemoved`, and `startFailed`. Only `expired` produces this notification.

The handler allow-lists `expired` rather than excluding the others, so a reason added later cannot
silently start reporting itself as a missed ready check. Note `startFailed` is published inline
rather than through `PublishReservationCancellationAsync`, so enumerating that helper's callers does
not find it.

The others are semantically different and must not be reported as a missed ready check. `declined` in
particular is a deliberate refusal, not a timeout; it is currently unreachable from the web client,
which offers only a Ready button, but another client can produce it.

### Two outcomes

Mutually exclusive, sharing the stable queue id `game-ready-missed`.

**The local player did not ready.** Regardless of what the opponent did.

- `warning`, title `Missed your duel`
- detail: `You did not ready up in time`, then `Qy vs Broan removed from the queue`
- `warning` carries `duration: null`, so it persists until dismissed with no special-casing

**The local player readied and the opponent did not.**

- `info`, title `Duel canceled`
- detail: `Broan did not ready up in time`
- default `info` auto-dismiss

If neither player readies, both see the first form.

The status split encodes severity honestly: missing your own pop costs you more than the opponent
missing theirs. It also produces the required persistence for free, because the player who was away
is the one who needs the notification to still be there when they return.

The opponent is named directly. Duels are 1v1, so there is exactly one other player. Names resolve
through the existing `playerName` helper, and the pair line through `pairLabel`, so this text cannot
drift from the panel or the other duel notifications.

### Lifecycle

Registration and cleanup both live in the register effect, as
`if (missed) register(...) else unregister(...)`.

Cleanup must not rely on `onExited`. A notification rendered behind a render gate unmounts before its
exit timer is scheduled, so `onExited` never fires — this is documented in `docs/UI_GUIDE.md` §13 and
was the cause of a slot leak in the queue confirmation work.

The captured outcome is cleared when the player dismisses it, and also when a new ready check
arrives. A stale `Missed your duel` must not sit on screen while the player is being offered another
duel.

### Not optional

This is the outcome of an action the player took, not ambient information, so it is not behind a
settings toggle. That matches the existing duel outcome notifications, which are also ungated.

## Testing

- The local player did not ready: a persistent `warning` naming the pair.
- The local player readied and the opponent did not: an auto-dismissing `info` naming the opponent.
- Neither readied: both see the persistent form.
- `declined`, `disconnected`, `leftChannel`, and `channelRemoved` produce nothing.
- A `reservationId` that does not match the captured ready check produces nothing.
- A new ready check clears a pending missed-ready notification.
- Dismissal releases the queue slot, verified on the registration state rather than DOM absence.
- The confirmation renders `Added to duel queue`.

## Out of Scope

- Any re-challenge or requeue action. Both notifications are informational; the player re-challenges
  through the normal path, which joins the queue as a new pair.
- Changing what expiry does on the server. Dropping the pair and promoting the next one is correct
  for a pair-keyed queue, not a limitation being deferred.
- Reporting `declined` or `disconnected` outcomes, and adding a decline button to the ready check.
- Any change to the badge highlight or the duel activity panel.
