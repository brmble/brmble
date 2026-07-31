# Duel Activity Feedback Design

## Goal

Clear accepted challenge notifications as soon as the server converts an offer into a reservation, highlight the channel duel badge when the local player is queued or in a ready check, and make estimated duel timing understandable at a glance.

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

## Estimated Duration Contract

The server snapshot will expose an explicit `estimatedDuration` for every active, ready, and queued duel. The value uses the existing server-side full-duration median and retains the complete `DurationEstimate` contract: known or unknown status, milliseconds, sample count, method, and approximate flag.

The UI calls this value **Estimated duration**. The median remains an internal statistical detail and is not exposed as user-facing terminology.

Snapshot construction will calculate each distinct game configuration once and reuse that estimate for individual cards and cumulative queue ETAs. The web must not derive per-duel duration by subtracting cumulative ETAs.

## Duel Activity Timing

### Live Duel

The live card uses the server's `startedAt`, `estimatedDuration`, and current time. While the panel is open, presentation updates once per second:

- `Estimated duration: ~25s`
- `Elapsed: 12s`
- Before the estimate is exceeded: `Estimated to end in about 13s`
- After the estimate is exceeded: `6s over estimate`

The over-estimate value uses the existing danger text token. The estimate and elapsed time remain informational; they never end, delay, or otherwise control a match. If the duration estimate is unknown, the card shows `Estimated duration: Unknown` and continues showing elapsed time without a predicted end or over-estimate state.

### Ready Check

The ready card retains each participant's Ready or Waiting state and adds `Estimated duration: ~25s` or `Estimated duration: Unknown`. It does not show a start ETA because participant readiness controls when advancement occurs.

### Queued Duel

Each queued card shows two separate concepts:

- Its own `Estimated duration: ~25s` or `Estimated duration: Unknown`.
- Its cumulative `Starts in about 50s` or `Starts in: Unknown`.

A queued duel's start ETA excludes its own duration and includes every active, ready, and queued segment ahead of it. If an earlier segment, such as RPS, has fewer than ten qualifying duration samples, later start ETAs remain unknown even when the later duel type has sufficient history. The panel intentionally keeps the text plain `Unknown`; displaying each duel's own estimate makes the source of propagation visible without adding explanatory copy or inventing a partial estimate.

### Formatting

Durations use compact units:

- `25s`
- `1m`
- `1m 5s`

Approximate known estimates include `about` or `~` as shown above. Elapsed and over-estimate values do not use approximation markers because they are calculated from the authoritative server start timestamp.

## Testing

Regression coverage will prove:

- Matching `game.accepted` clears recipient and challenger challenge state.
- Stale or mismatched offer IDs do not clear a newer challenge.
- Accepted challenge buttons disappear before they can send stale commands.
- The swords badge uses the standard active treatment for the local player's queued and ready states.
- The badge remains unhighlighted for observers and for an active-only local match.
- Active, ready, and queued wire entries expose their own full-duration estimate.
- Snapshot construction reuses estimates for repeated configurations rather than issuing duplicate sample queries.
- The live timer displays elapsed and estimated remaining time, then changes to danger-styled time over estimate.
- Unknown live duration still displays elapsed time without a predicted end.
- Ready and queued cards display their own estimated duration.
- A Deathroll rematch behind an insufficient-sample RPS segment shows a known Deathroll estimated duration but an unknown cumulative start ETA.
- Minute formatting covers exact and mixed minute values.
- Existing badge click behavior still does not select or join the channel.
