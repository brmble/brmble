# Queued Duel Feedback Design

## Goal

Clear accepted challenge notifications as soon as the server converts an offer into a reservation, and highlight the channel duel badge when the local player is queued or in a ready check.

## Accepted Challenge Lifecycle

The server already publishes `game.accepted` privately to both participants with the accepted `offerId`. The web game state will subscribe to this event and clear only challenge state whose `offerId` matches:

- The recipient clears the matching incoming challenge and its accepting state.
- The challenger clears the matching outgoing challenge.
- A stale or unrelated accepted event changes neither challenge.
- No accepted-result notification is added. The complete queue snapshot becomes the ongoing status indicator.

This prevents stale challenge actions from sending commands for an offer that has already become a queued or starting reservation.

## Personal Queue Highlight

The app will derive a separate set of personal duel channel IDs from complete queue snapshots. A channel is personal when the current Mumble session appears in:

- `readyCheck.players`, or
- any `queue[].players` pair.

An active match alone does not produce the personal highlight because its participant modal is already visible.

The existing swords button remains visible for any active, ready, or queued duel. When its channel is personal, it receives the same active treatment as the top-bar mute control: `var(--accent-primary)` text/icon color and `var(--accent-primary-wash)` background. No new color, animation, count badge, or layout pattern is introduced.

## ETA Behavior

ETA calculation remains unchanged. A queued duel's ETA excludes its own duration and includes every active, ready, and queued segment ahead of it. If an earlier segment, such as RPS, has fewer than ten qualifying duration samples, later ETAs remain `Unknown` even when the later duel type has sufficient history. The modal continues showing plain `Unknown` without explanatory or partial estimates.

## Testing

Regression coverage will prove:

- Matching `game.accepted` clears recipient and challenger challenge state.
- Stale or mismatched offer IDs do not clear a newer challenge.
- Accepted challenge buttons disappear before they can send stale commands.
- The swords badge uses the standard active treatment for the local player's queued and ready states.
- The badge remains unhighlighted for observers and for an active-only local match.
- A Deathroll rematch behind an insufficient-sample RPS segment retains an unknown ETA.
- Existing badge click behavior still does not select or join the channel.
