# Arena Hit Lag Compensation — Design

**Status:** implemented on `refactor/continuous-coordinator-extraction` (2026-09-22), the
last piece of the realtime netcode stack before its PR. Playtested at 50/10, 100/20 and
200/40 ms transport delay.

**Origin:** the three-setting playtest of the input-scheduling work
(`docs/superpowers/plans/2026-09-13-arena-input-scheduling.md`, *Status*). With movement and
shooting fixed, the one thing the player still saw was the knockback: their shot vanished at
the opponent and the opponent moved 300-450 ms later.

**Related:** `docs/superpowers/specs/2026-09-13-realtime-acknowledgement-and-latency-design.md`
(the frames this design reasons in) and
`docs/superpowers/specs/2026-09-01-arena-local-reconciliation-design.md` (*Superseded detail*,
2026-09-22: own projectiles drawn in the prediction frame, hidden once they reach the displayed
opponent).

---

## The two frames

The local player and their shots are drawn in the **prediction frame**: local tick
`P = serverTick + elapsed + lead`, ahead of the server by the lead. The opponent is drawn in the
**view frame**: the snapshot timeline sampled at server-now minus the 100 ms buffer, at view
tick `V`. The gap `P - V` is roughly `lead + downlink + 6` ticks: 15 at a 100 ms round trip,
almost 50 at 450 ms.

The player aims at the opponent as displayed, `o(V)`. The server resolves the hit at tick `P`
against the opponent as it is, `o(P)`. Two consequences:

1. **Fairness.** On a moving opponent `o(P)` and `o(V)` differ by the opponent's movement
   over the gap - 1350 units at 100 ms, more than a body width - so a shot at where the
   opponent is seen misses where they are, and vice versa. Without compensation the shooter has
   to lead a target they cannot see moving.
2. **Delay.** The verdict returns one round trip plus the lead after the shot reached the
   displayed body, and the knockback is then drawn through the 100 ms buffer. Nothing on the
   shooter's machine moves the opponent until then.

## Design

### Server: judge the hit in the shooter's frame

- The fire input carries **`viewTick`**: the view tick the shooter's frame was showing when
  they released. Optional on the wire (a 13th field on `input`; heartbeats never carry it; an
  absent or zero value means "no compensation"), so an older client is unaffected. The
  coordinator sanitises it the way it sanitises the stamp: it keeps the *gap* to the stamp,
  bounded to `[0, 120]` ticks, so a stamp that is clamped drags the view tick with it.
- `ArenaSimulation` keeps a **64-tick position history** per player, recorded at the end of
  every step. A projectile fired from an input with a view tick records
  `RewindTicks = clamp(firedTick - viewTick, 0, 60)`; the hit test for that projectile uses the
  opponent's position `RewindTicks` ago (falling back to the current position when the history
  does not reach that far, which only happens right after a round reset). The knockback itself
  is applied to the opponent's current state, as before.
- A late input installed on arrival rather than at its stamp rewinds by the extra lateness as
  well, which is right: the shooter's view was that much older relative to the actual spawn.
- The rewind is part of the projectile and of the input, so both enter the deterministic hash.
  The recorded fixture changes once for that reason; the stream's behaviour does not.

### Client: predict the knockback, then hand over without a jump

- When an own shot reaches the displayed opponent (the same test that already hides the shot,
  `projectileReachedBody`), the client records a **predicted hit**: the impulse the server will
  apply (projectile direction times the charge-scaled knockback), the view tick `V0` of the hit,
  and the gap `P - V0` at that moment.
- The displayed opponent is offset by
  `D(V - V0) - D(V - V0 - gap)`, where `D(n)` is the displacement a knockback impulse produces
  in `n` ticks under the server's integrate-then-damp physics. The first term is the knockback
  as the shooter should see it: starting the tick after the visual hit. The second is the
  knockback the authority will have applied by the same view tick: it starts `gap` ticks later,
  because the server's hit at tick `P` reaches the view frame at `V = P`. As the timeline
  catches up the two converge and the offset decays to zero on its own, so the handover from
  prediction to authority has no jump.
- If the server rules a miss, the second term is never realised in the snapshots but the
  formula still decays: the opponent is seen pushed and then eases back over half a second.
  With the server judging in the shooter's frame this needs the displayed and rewound positions
  to disagree by more than the hit radius, i.e. half a tick of rounding, so it is rare.
- Predicted hits are keyed by the shot's line of flight (`x·vy - y·vx` is invariant along it),
  not by projectile id, so the predicted-to-authoritative id handover cannot register a second
  hit. They are dropped three seconds after the hit.

## What does not change

- Wire messages from the server. `ArenaProjectileView` does not expose the rewind.
- The strip-don't-reject contract, the scheduling of inputs at their stamp, the lead.
- The opponent's own shots: they are drawn in the view frame with their owner, as before.

## Trade-offs, stated

- **Favours the shooter.** A player can be hit by a shot they saw themselves dodge, by up to
  the shooter's frame gap. This is the standard trade in every shooter with lag compensation and
  is the price of the shooter's aim meaning what they see. The rewind is capped at one second.
- **Two views of one hit.** The victim sees the knockback when the authority reaches their
  view frame; the shooter sees it at once. Both see the same final positions.

## Testing

- Server: a rewound hit lands on the opponent's past position and the same shot without a view
  tick misses; the rewind is recorded from the view tick, capped, and zero without one; the
  coordinator keeps the gap through a stamp clamp and bounds it; the endpoint accepts the 13th
  field and still accepts the 12-field input. Determinism fixture re-recorded.
- Client: `sampleTimeline` reports the view tick; the offset is zero at the hit, grows by the
  server's knockback physics, and returns to zero after the gap; the state hook pushes the
  displayed opponent on a visual hit and keys hits by trajectory; the input hook stamps the fire
  with the view tick; the arena codec keeps it off heartbeats and held frames.
