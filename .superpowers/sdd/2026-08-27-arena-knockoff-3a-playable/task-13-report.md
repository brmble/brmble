# Task 13 Report: Typed Browser Connection, Sequenced Input And Reconnect

## Status

Complete on `docs/arena-knockoff-revision`.

Commit: `26f802a5` (`feat: connect browser directly to arena realtime`)

## Implemented

- Added participant-only `requestRealtimeTicket` with the existing correlated WebView bridge or direct fetch transport and structured error handling.
- Added exact protocol-v1 client/server discriminated unions and strict runtime parsing for complete payloads, integer fields, enums, duplicate identifiers, unknown fields/types, malformed JSON, and terminal inner state.
- Added direct browser-owned WebSocket attachment and acknowledgement after a complete valid welcome.
- Added welcome-acknowledged monotonic input sequencing, immediate held/edge sends, 34 ms aim coalescing, complete 250 ms heartbeats, and exact pending prediction intervals.
- Added acknowledgement pruning, backward snapshot rejection, synchronous final-state handling, fresh-ticket reconnect at 250/500/1000/2000 ms within five seconds, neutral installation, and generation/socket-safe teardown.
- Added protocol and hook regression tests covering the Task 13 behavior.

## Verification

- `npm test -- --run src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`: 2 files, 18 tests passed.
- `npm run type-check`: passed.
- `npm test -- --run`: 166 files, 2,057 tests passed.
- `npx eslint src/components/Games/Arena/arenaProtocol.ts src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.ts src/components/Games/Arena/useArenaConnection.test.tsx`: passed.
- `git diff --check`: passed before commit.

## Concerns

- The full suite continues to emit existing jsdom `scrollIntoView is not a function` stderr from `App.spectator.test.tsx`; all associated tests pass and Task 13 does not touch that code.
- Whole-file lint of existing `src/api/games.ts` reports its pre-existing `prefer-const` finding at the bridge request timer. New Task 13 files lint clean.
- The unrelated untracked `.opencode/plans` files were left untouched.

## Fix Round 1

Status: complete.

### Changes

- Enforced one reconnect deadline across retry delays, stalled ticket promises, CONNECTING sockets and OPEN sockets awaiting welcome. Attempt generations suppress late promise and socket callbacks.
- Defined `PendingArenaInput` as an inclusive replay interval, with `fromTick > toTick` representing no held-state replay while preserving edge flags for one-time replay. The first interval starts at `welcome.serverTick + 1`, and same-tick sends do not duplicate simulation steps.
- Unified heartbeat and aim-send timing: heartbeats send current held/aim state without edges, cancel queued aim sends and rebase the 34 ms aim limit.
- Built socket URLs with `URL` and `searchParams.set`, preserving existing query parameters and fragments while replacing a prior ticket exactly once.
- Froze protocol-v1 ruleset, timing and prediction constants in both TypeScript types and runtime guards.
- Treat duplicate welcome on an active socket as protocol-invalid: timers are cleared, the socket closes and status becomes `failed`.
- Added direct ticket API coverage for bridge/fetch success and structured errors.

### RED Evidence

The first focused run after adding review regressions produced 17 expected failures: nine frozen-protocol guard failures and eight connection failures covering interval boundaries, stalled reconnects, URL construction, heartbeat/aim interaction, duplicate welcome and realistic socket state. Ticket bridge/fetch tests passed against the existing API path.

### Mutation Evidence

- Changing any frozen timing or prediction constant causes a guard test to fail.
- Removing the reconnect deadline, attempt generation or stale-socket checks fails stalled ticket, CONNECTING, OPEN-without-welcome or late-completion tests.
- Starting prediction at the welcome tick or clamping prior intervals to non-empty fails first-tick and same-tick interval assertions.
- Retaining the queued aim timer or failing to rebase on heartbeat creates an extra send before 34 ms and fails the race test.
- Returning to string concatenation for the URL breaks the existing-query/fragment test.
- Accepting a second welcome leaks/reset intervals and fails the duplicate-welcome test.

### Fix Verification

- `npm test -- --run src/api/games.realtime.test.ts src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`: 3 files, 39 tests passed.
- `npm run type-check`: passed.
- Changed-file ESLint: passed for all Fix Round 1 files.
- `npm test -- --run`: 167 files, 2,078 tests passed.
- Full suite retains the pre-existing jsdom stderr noted above; no tests failed.

## Fix Round 2

Status: complete.

### Changes

- Separated desired input aim from the last transmitted aim and its legal 34 ms slot.
- Immediate movement, charging, fire and dash frames retain immediate held/edge delivery. When their requested aim is too early, they carry the prior transmitted aim and queue only the latest desired aim.
- Queued aim flushes use the latest held state and are always edge-free, so fire and dash are transmitted exactly once while Task 14 retains their original pending records.
- Heartbeats use complete desired held state, obey the same aim slot, clear a queued aim only when they can transmit it, and otherwise preserve its legal timer. The cadence path is tested to satisfy a queued aim exactly at the legal slot.
- Added sent-frame history for rejection recovery. A rejected newest sequence rewinds `nextSequence`, pending state and transmitted aim safely. A rejection with later frames closes and reconnects because the server did not acknowledge the rejected sequence and local rewind would create ambiguity.

### RED Evidence

The first Fix Round 2 hook run produced seven expected failures: movement+aim, dash+aim, fire+aim, latest queued aim coalescing, heartbeat/aim interaction, newest-sequence rejection and rejection with later frames.

### Mutation Evidence

- Sending requested aim on an immediate held/edge frame before 34 ms fails the movement, dash and fire table tests.
- Dropping or repeating an edge during queued aim flush fails the exact-one edge assertions.
- Keeping the first queued aim instead of the latest fails the coalescing test.
- Letting heartbeat or queued aim violate the shared slot fails the 33/34 ms boundary assertions.
- Ignoring `inputRejected` fails contiguous rewind; rewinding when later frames exist fails the reconnect assertion. Leaving the aim timer armed after rejection fails the no-implicit-retry assertion.

### Fix Verification

- `npm test -- --run src/api/games.realtime.test.ts src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`: 3 files, 47 tests passed.
- `npm run type-check`: passed.
- ESLint for the two changed source/test files: passed.
- `npm test -- --run`: 167 files, 2,086 tests passed.
- Full suite retains the pre-existing jsdom stderr noted above; no tests failed.

## Fix Round 3

Status: complete.

### Changes

- Classified `inputRejected` reasons by recoverability. `staleSequence` and `sequenceGap` always reconnect for a fresh ticket and authoritative welcome acknowledgement; they never rewind or resend the rejected sequence.
- `wrongMatch` and `wrongRole` are terminal client failures: timers stop, transport closes and no retry is scheduled.
- `invalidRange`, `rateLimited`, `phaseDenied`, `cooldown` and `dashSpent` may rewind only when the rejection names the newest sent sequence. Any later frame makes recovery ambiguous and forces reconnect.
- Safe rewind removes the rejected pending/prediction record and sequence reservation without automatically resending an edge.
- Wire aim direction and last wire aim-change timestamp are irreversible client-rate state. Rejection rollback no longer restores either from server-accepted or pending history, so a rejected aim still consumes the 34 ms client slot.

### RED Evidence

The initial Round 3 hook run produced ten expected failures: stale/gap reconnect, wrong-match/wrong-role terminal handling, five recoverable-reason cases and rejected wire-aim spacing. The five recoverable cases also exposed and corrected a test assertion that expected an omitted heartbeat edge property to exist as `undefined`.

### Mutation Evidence

- Routing `staleSequence` or `sequenceGap` through local rewind fails fresh-ticket/reconnect and no-repeat assertions.
- Retrying `wrongMatch` or `wrongRole` fails terminal status and ticket-count assertions.
- Rewinding a recoverable rejection with later frames fails the existing ambiguous-history reconnect test.
- Restoring pre-rejection wire aim direction or timestamp lets an immediate edge carry an illegal aim change and fails the 33/34 ms wire-history test.
- Automatically resending a rejected dash fails the exact-one edge assertion.

### Fix Verification

- `npm test -- --run src/api/games.realtime.test.ts src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`: 3 files, 57 tests passed.
- `npm run type-check`: passed.
- ESLint for the two changed source/test files: passed.
- `npm test -- --run`: 167 files, 2,096 tests passed.
- Full suite retains pre-existing intentional error-path/jsdom stderr; no tests failed.

## Fix Round 4

Status: complete.

### Changes

- Made `matchClosed` atomically terminate client input production by invalidating the next sequence, clearing pending and sent-frame history, and cancelling aim, heartbeat, retry and reconnect-deadline timers.
- Guarded public `sendInput` and `sendHeartbeat`, the shared send path, and already-queued aim/heartbeat callbacks so terminal runtimes cannot send frames or mutate pending state.
- Preserved the terminal socket reference so a later browser close remains `closed`, does not reconnect and does not clear the synchronously installed final state.

### RED Evidence

The initial Round 4 hook run produced two expected failures: public sends after `matchClosed` emitted two frames and repopulated pending input, while manually invoking an already-queued aim callback after terminal delivery emitted another frame.

### Mutation Evidence

- Removing the public or shared terminal guards sends post-terminal input/heartbeat frames and fails the public-send regression.
- Removing terminal guards from queued callbacks lets a captured aim or heartbeat callback send after its timer was cancelled and fails the queued-callback regression.
- Retaining pending history or sequence production at terminal delivery fails the empty-pending assertions.
- Reconnecting or clearing terminal state on socket close fails the final-state-through-close assertions.

### Fix Verification

- `npm test -- --run src/api/games.realtime.test.ts src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`: 3 files, 59 tests passed.
- `npm run type-check`: passed.
- ESLint for the two changed source/test files: passed.
- `git diff --check`: passed.
- `npm test -- --run`: 167 files, 2,098 tests passed.
- Full suite retains pre-existing intentional error-path/jsdom stderr; no tests failed.

## Fix Round 5

Status: complete.

### Changes

- Captured the active attempt generation when scheduling each retry and required the runtime, terminal state and generation to remain valid when its callback executes.
- Added the same terminal and generation checks at `connect` entry before ticket acquisition, and retained terminal validation after the ticket promise resolves before socket creation.
- Advanced the attempt generation on `matchClosed`, invalidating both queued retry callbacks and in-flight ticket completions while preserving terminal status, pending state and final state.

### RED Evidence

The initial Round 5 hook run produced the expected failure: manually invoking a captured retry callback after a valid replacement socket delivered `matchClosed` made a third realtime-ticket request.

### Mutation Evidence

- Removing the retry-callback terminal or generation guard permits a captured stale callback to enter `connect` and fails the ticket-count assertion.
- Removing the `connect` entry terminal or generation guard permits direct stale re-entry to acquire a ticket.
- Removing terminal generation invalidation or the post-ticket terminal/generation guard permits an in-flight stale ticket completion to create a socket.
- Any stale callback mutation of status, pending input or closed final state fails the terminal-state assertions.

### Fix Verification

- `npm test -- --run src/api/games.realtime.test.ts src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`: 3 files, 60 tests passed.
- `npm run type-check`: passed.
- ESLint for the two changed source/test files: passed.
- `git diff --check`: passed.
- `npm test -- --run`: 167 files, 2,099 tests passed.
- Full suite retains pre-existing intentional error-path/jsdom stderr; no tests failed.
