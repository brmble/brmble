# Task 14 Report: Prediction, Reconciliation And Interpolation

## Status

Complete on `docs/arena-knockoff-revision`.

Commit: `7766cc67` (`feat: predict and reconcile arena client state`)

## Implementation

- Added integer-only local prediction for movement, charge slowdown, forced fire, dash, recoil, cooldowns, and immediate own-projectile presentation using the welcome prediction constants.
- Added authoritative reconciliation with acknowledgement pruning, exact inclusive interval replay, exact `replayedTicks`, and accumulation of empty-interval fire/dash edges into the next stepped interval.
- Added the 300-unit correction threshold, 100 ms visual correction blending, and mandatory snaps for radius, overlap, phase, score, local KO, cooldown, and dash contradictions.
- Added ordered 100 ms timeline sampling, matching-ID interpolation, normalized shortest-path aim interpolation, capped 50 ms velocity extrapolation, and discrete-state/projectile lifetime safeguards.
- Added exact 20,000-unit world/letterbox layout transforms.
- Added `useArenaState` handling welcome, ordered snapshots, current-session self lookup, final state, state-only updates, immediate predicted projectiles, and RAF cleanup.
- Preserved the Task 4 golden vectors unchanged.

## TDD Evidence

- Initial focused RED run failed because `reconcile`, `stepLocal`, `sampleTimeline`, layout helpers, and `useArenaState` did not exist; the 13 existing golden vectors remained green.
- Added regression coverage for the parked same-tick empty interval edge case before implementing replay behavior.
- Added RED hook coverage for immediate own-projectile presentation and 100 ms correction blending before implementing those render behaviors.
- Added forced-fire countdown coverage after simulation-order review.

## Verification

- `npm test -- --run src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`: PASS, 33 tests.
- `npm run type-check`: PASS.
- `npx eslint src/components/Games/Arena/arenaMath.ts src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.ts src/components/Games/Arena/useArenaState.test.tsx`: PASS.
- `npm test`: PASS, 168 files and 2,119 tests.
- `git diff --check`: PASS.

## Concerns

- The full web test suite emits existing expected stderr from local-storage parse coverage and `ChatPanel` tests where jsdom lacks `scrollIntoView`; all tests pass.
- Repository-wide lint remains red on 173 pre-existing errors outside the Task 14 files. The four Task 14 files pass isolated lint.
- The participant protocol exposes quantized charge and dash availability, not hidden authoritative charge/dash tick counters. Prediction reconstructs charge ticks from `chargePermille` and resets active dash ticks from authority before replay, while mandatory contradictions force a snap.

## Fix Round 1

### Changes

- Correction magnitude now compares the prior predicted/render target with the newly replayed target. Reconciliation runs only when authority or input content changes, so the 100 ms blend remains stable across RAF cycles and semantically identical prop instances.
- Replay clips every inclusive interval to ticks strictly after `authority.serverTick`; historical intervals and their edge flags are discarded, while eligible empty intervals still carry edges to exactly one future step.
- Prediction records an internal absolute dash end tick. New authoritative snapshots reconstruct remaining dash ticks from previous prediction history without changing the wire protocol, including snapshots that acknowledge a dash midway through its six-tick burst.
- Timeline interpolation now keeps all discrete fields and projectile/player membership from the latest frame at or before the render timestamp. Continuous interpolation is limited to matching IDs, with creation/removal switching at the right frame timestamp.
- Welcome, match, and current-session replacement reset timeline, prediction, correction, snap state, and snap count.
- KO remains authority-owned: local stepping never changes KO state, while reconciliation compares consecutive authoritative KO states independently from predicted outside-radius snapping.
- Local stepping now mirrors server phase gates and order: Loading skips input installation and movement; Positioning installs aim/input and movement only; Live additionally decrements timers, processes dash/fire, integrates velocity, and damps.
- Equal-timestamp frames retain the highest sequence, and interpolation preserves a zero aim vector as zero.

### RED And Mutation Evidence

- The initial Fix Round 1 RED run produced 10 failures covering clipped replay, acknowledged mid-dash continuation, replay-target correction, authority-only KO, Loading/Positioning/Live gates, left-frame discrete interpolation, equal-timestamp ordering/zero aim, and session replacement reset.
- A dedicated RED mutation test proved Loading incorrectly changed aim before the phase gate; moving the gate before input normalization made it pass.
- A dedicated RED test recreated unchanged snapshots and empty pending arrays with new object identities during a correction. It exposed premature blend termination, which was fixed by content-keying reconciliation dirtiness.
- The correction test uses an authority offset of 210 plus one 90-unit replay tick, proving the correction and 300/301 snap boundary are measured against the replayed target rather than bare authority.
- The dash continuation test snapshots authority after three dash ticks and verifies exactly three remaining dash movements, zero remaining ticks, and unchanged mandatory contradiction behavior.
- Mutation checks cover removing server-tick clipping, carrying historical edges, resetting dash history, using right-frame discretes/membership, retaining stale reconnect state, predicting KO, moving the Loading gate, choosing the lower equal-time sequence, and normalizing zero aim.

### Verification

- `npm test -- --run src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`: PASS, 42 tests.
- `npm run type-check`: PASS.
- `npx eslint src/components/Games/Arena/arenaMath.ts src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.ts src/components/Games/Arena/useArenaState.test.tsx`: PASS.
- `npm test`: PASS, 168 files and 2,128 tests.
- `git diff --check`: PASS.

## Fix Round 2

### Changes

- Extended Task 13's connection result with bounded `recentInputs` containing only dash-edge records. Acknowledged edges remain for six server ticks and are cleared on rejection, reconnect/neutral installation, welcome replacement, terminal state, disable, and match change.
- Dash reconstruction now works before the first RAF. When an authority snapshot acknowledges a spent dash, its deterministic start is `min(predictedTick, acknowledgedAtTick)`, preventing future-skewed predicted ticks from postponing a dash already accepted by the server.
- Split hook dirtiness into authority and input changes. Authority updates may replace a correction; input-only updates advance prediction immediately without creating an authority correction.
- Replacement corrections start from the current rendered/blended local position. Midpoint replacement therefore has no visual jump and proceeds to the new target over a fresh 100 ms interval.
- Independent `selfSessionId` changes reset predicted/rendered local state, correction, dash history inputs, snap state, and snap count even when the welcome object is unchanged.
- `stepLocal` now no-ops for `awaitingParticipants`, `loading`, and `ended`; `positioning` remains movement-only and `live` retains the full fixed-step path.

### RED And Mutation Evidence

- The initial Fix Round 2 focused run produced eight failures across Task 13 and Task 14: missing recent history, dash reconstruction under skew, awaiting/ended movement, correction replacement continuity, input-only correction masking, and independent session reset.
- The Task 13 regression sends a dash, acknowledges it before Task 14 can render, verifies it remains available, advances beyond six ticks to verify eviction, then verifies terminal clearing.
- The dash reconstruction test uses `predictedTick=110` with acknowledgement at server tick 103 and verifies the burst is anchored to tick 103 rather than postponed by client skew.
- The correction replacement test samples the first correction at 50 ms, installs new authority, and asserts the first replacement frame remains at that exact midpoint before progressing toward the new target.
- The input-only test adds a pending movement interval without changing authority and asserts immediate predicted movement rather than a correction back to the old rendered point.
- Phase mutation coverage now includes all five relevant gates: awaiting participants, loading, positioning, live, and ended.

### Verification

- `npm test -- --run src/components/Games/Arena/useArenaConnection.test.tsx src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`: PASS, 86 tests.
- `npm run type-check`: PASS.
- Six changed Task 13/14 files via `npx eslint`: PASS.
- `npm test`: PASS, 168 files and 2,136 tests.
- `git diff --check`: PASS.

## Fix Round 3

### Changes

- Bounded acknowledged-dash inference now clamps the candidate start into the active acknowledgement window from `acknowledgedAtTick - (dashTicks - 1)` through `acknowledgedAtTick`. Future `predictedTick` skew is capped at acknowledgement; lagging values are raised into the latest possible active window.
- Inferred dash end is exclusive and capped at `acknowledgedAtTick + dashTicks`, guaranteeing conservative continuation when the first spent snapshot arrives while preventing any history or later snapshot from extending the burst beyond six authoritative ticks.
- A `selfSessionId` generation baseline now suppresses caller-owned pending and recent arrays from the old session until each array identity changes for the new session. Old movement, dash edges, and correction state cannot enter new-session reconciliation even if the welcome object is unchanged.

### Protocol Inference

The wire protocol exposes `dashAvailable` and acknowledged input sequence but not the server tick at which the dash edge was installed, active dash ticks, or remaining duration. Therefore exact reconstruction is impossible when `predictedTick` is skewed. The client uses the acknowledgement snapshot as the authoritative bound: a spent dash first observed there is treated as active for at least the next eligible prediction step, but never beyond the six-tick authoritative dash window. Subsequent authority and prior predicted end history can shorten this estimate but cannot extend it.

### RED And Mutation Evidence

- The initial Round 3 focused run failed on lagging `predictedTick` and stale old-session arrays while all prior Task 13/14 cases remained green.
- Dash tests cover a far-behind predicted tick, future skew, the exact inferred end, and a subsequent snapshot beyond six authoritative ticks to prove no extension.
- Session-generation coverage supplies nonempty old pending and recent arrays while changing only `selfSessionId`; it verifies authoritative position/dash state is used until new empty array identities arrive.
- Mutation checks include removing either start bound, removing the absolute end cap, and immediately accepting unchanged old-session array references.

### Verification

- `npm test -- --run src/components/Games/Arena/useArenaConnection.test.tsx src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`: PASS, 90 tests.
- `npm run type-check`: PASS.
- Six Task 13/14 files via `npx eslint`: PASS.
- `npm test`: PASS, 168 files and 2,140 tests.
- `git diff --check`: PASS.

## Fix Round 4

### Changes

- Inferred dash ends are now strictly exclusive at `inferredStart + dashTicks`; conservative acknowledgment handling no longer extends the configured six-tick duration.
- Far-behind inferred starts move forward to `acknowledgedAtTick - (dashTicks - 2)`, preserving one eligible post-acknowledgment movement tick while keeping the total inferred interval at six ticks.
- Dash regression coverage enumerates movement ticks for far-behind, exact, and future-skewed predictions, plus a lagging in-window discriminator, and verifies zero dash movement at every exclusive end.

### RED And Mutation Evidence

- The initial three-case table passed against the defective implementation because the separate authority cap masked `+ 1` for far-behind, exact, and future-skewed extremes.
- Adding the lagging in-window case produced the intended RED failure: predicted tick 100 reconstructed exclusive end 107 instead of 106.
- The table independently asserts literal inferred ends and movement tick lists. Restoring `inferredStart + dashTicks + 1` fails the lagging case, while all cases assert at most six inferred ticks and no dash movement on the exclusive-end tick.

### Verification

- `npm test -- --run src/components/Games/Arena/useArenaConnection.test.tsx src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`: PASS, 92 tests.
- `npm run type-check`: PASS.
- Six Task 13/14 files via `npx eslint`: PASS.
- `npm test`: PASS, 168 files and 2,142 tests.
- `git diff --check`: PASS.
