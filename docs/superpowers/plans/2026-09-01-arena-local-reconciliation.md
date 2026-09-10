# Arena Local Reconciliation and Collision Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local arena movement continuous across server snapshots and make player-player contact stop bumping the local player, by mirroring the server's body-overlap stage in client prediction and adding a local-only display constraint.

**Architecture:** Three layers change. (1) `stepLocal` gains a server-parity `resolveBodyOverlap` stage against a dead-reckoned opponent, so prediction converges during contact. (2) `useArenaState` stops resetting the sub-tick presentation phase on ordinary snapshots and unifies the correction clock onto the animation-frame clock. (3) A display-only constraint pushes the presented local player clear of the buffered remote player without ever writing back into prediction.

**Tech Stack:** React 19 + TypeScript, Vitest 4 + @testing-library/react (client); C# / MSTest (server, read-only reference for parity).

**Spec:** `docs/superpowers/specs/2026-09-01-arena-local-reconciliation-design.md`

**Branch:** `fix/arena-local-movement-cadence` (already checked out; base `eaed73f9`). Do not commit to `main`. Do not push or open a PR without asking the user.

## Global Constraints

- Fixed-point world units. Player positions are integers. World space is `±10_000`.
- `AimQuantizationMax` / Q15 scale is exactly `32_767`.
- `constants.playerRadius` is `600`; diameter is `playerRadius * 2` = `1200`. Never hardcode `600` or `1200` in new code — read from `constants` / `view.prediction`.
- Tick rate `60`, snapshot rate `20`, `interpolationMs` `100`, `maxExtrapolationMs` `50`.
- Correction blend window is exactly `100` ms.
- Large-correction snap threshold is unchanged: `correctionSquared > 90_000n` (300 units).
- Side ordering: side `0` is the lower session id ("low"), side `1` is the higher ("high"). The overlap normal points low → high.
- Truncation in the predicted overlap stage is toward zero (`Math.trunc`), never `Math.floor`, because normal components are signed.
- The predicted overlap stage must not renormalize the Q15 normal — the server does not, and a single call may under-separate. Reproduce that exactly.
- Presentation must never mutate `predictedRef`, `presentedRef`, snapshots, pending inputs, or the correction origin.
- Exactly one `requestAnimationFrame` loop, owned by `useArenaState`. No new per-frame React state publication.
- All UI/renderer work follows `docs/UI_GUIDE.md`: no hardcoded colors, sizes, spacing.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts` | Modify | Add `resolveBodyOverlap` (server parity), `deadReckon`, `constrainLocalDisplay`; call overlap from `stepLocal`; retune the overlap snap condition in `reconcile`. |
| `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts` | Modify | Parity vectors, display-constraint tests, retuned snap tests. |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts` | Modify | Tick-phase preservation, unified frame clock, apply display constraint before publishing. |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx` | Modify | Cadence, sustained-contact, constraint-isolation tests; update correction tests to the frame clock. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts` | Modify | Source `playerRadius` / `projectileRadius` / `shotCooldownTicks` from `welcome.prediction` instead of local duplicates. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx` | Modify | Pass `prediction` into the render view. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts` | Modify | Supply `prediction` in the test render view. |

Verification commands (run from `src/Brmble.Web` via `workdir`, or with `--prefix src/Brmble.Web`):

```powershell
npm test --prefix src/Brmble.Web
npm run type-check --prefix src/Brmble.Web
npm run lint --prefix src/Brmble.Web
npm run build --prefix src/Brmble.Web
```

Single file: `npx vitest run src/components/Games/Arena/arenaMath.test.ts` with `workdir: src/Brmble.Web`.

---

### Task 1: Server-parity `resolveBodyOverlap` in `arenaMath`

This is the exact JavaScript mirror of `ArenaSimulation.ResolveBodyOverlap()` (`src/Brmble.Server/Games/Arena/ArenaSimulation.cs:396-428`). It feeds deterministic replay, so it must be bit-exact. Reference server source for this task:

```csharp
var low = Players[0];
var high = Players[1];
var dx = checked(high.X - (long)low.X);
var dy = checked(high.Y - (long)low.Y);
var distanceSquared = checked(dx * dx + dy * dy);
var diameter = checked(ArenaRulesetV1.PlayerRadius * 2);
if (distanceSquared >= checked((long)diameter * diameter))
    return;
var distance = FixedVec.IntegerSqrt(distanceSquared);
var normal = distance == 0
    ? new FixedVec(ArenaRulesetV1.AimQuantizationMax, 0)
    : new FixedVec(
        checked((int)(dx * ArenaRulesetV1.AimQuantizationMax / distance)),
        checked((int)(dy * ArenaRulesetV1.AimQuantizationMax / distance)));
var penetration = diameter - distance;
var lowShare = penetration / 2;
var highShare = penetration - lowShare;
low.X = checked(low.X - (int)(normal.X * (long)lowShare / ArenaRulesetV1.AimQuantizationMax));
low.Y = checked(low.Y - (int)(normal.Y * (long)lowShare / ArenaRulesetV1.AimQuantizationMax));
high.X = checked(high.X + (int)(normal.X * (long)highShare / ArenaRulesetV1.AimQuantizationMax));
high.Y = checked(high.Y + (int)(normal.Y * (long)highShare / ArenaRulesetV1.AimQuantizationMax));
```

C# integer division truncates toward zero, which is `Math.trunc` in JS — not `Math.floor`. All intermediate magnitudes here are far below `2**53` (max `|dx| * 32767` ≈ `6.6e8`), so plain `number` arithmetic is exact; only `integerSqrt` needs BigInt, and `arenaMath.ts:31` already provides it.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`
- Test: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`

**Interfaces:**
- Consumes: `integerSqrt(value: bigint): bigint` (existing, `arenaMath.ts:31`); `ArenaPlayerSnapshot` from `./arenaProtocol`.
- Produces:
  - `export const Q15 = 32_767;`
  - `export function resolveBodyOverlap(a: ArenaPlayerSnapshot, b: ArenaPlayerSnapshot, playerRadius: number): { a: ArenaPlayerSnapshot; b: ArenaPlayerSnapshot }` — returns new objects in the same argument slots as passed in, with all non-position fields preserved.

- [ ] **Step 1: Write the failing tests**

Append to `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`. Add `resolveBodyOverlap` to the existing import from `./arenaMath`, and add `import type { ArenaPlayerSnapshot } from './arenaProtocol';` if it is not already imported.

```ts
describe('resolveBodyOverlap', () => {
  const body = (overrides: Partial<ArenaPlayerSnapshot> = {}): ArenaPlayerSnapshot => ({
    sessionId: 10, side: 0, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0,
    chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0,
    dashAvailable: true, acknowledgedInput: 0, ...overrides,
  });
  const low = (x: number, y = 0) => body({ sessionId: 10, side: 0, x, y });
  const high = (x: number, y = 0) => body({ sessionId: 20, side: 1, x, y });

  it('leaves separated bodies untouched', () => {
    const result = resolveBodyOverlap(low(0), high(2000), 600);
    expect([result.a.x, result.b.x]).toEqual([0, 2000]);
  });

  it('does not push bodies that exactly touch at one diameter', () => {
    const result = resolveBodyOverlap(low(0), high(1200), 600);
    expect([result.a.x, result.b.x]).toEqual([0, 1200]);
  });

  it('splits even penetration in half', () => {
    // distance 1000, penetration 200, lowShare 100, highShare 100.
    // normal.x = trunc(1000 * 32767 / 1000) = 32767, push = trunc(32767 * 100 / 32767) = 100.
    const result = resolveBodyOverlap(low(0), high(1000), 600);
    expect([result.a.x, result.b.x]).toEqual([-100, 1100]);
  });

  it('assigns the odd penetration unit to side 1', () => {
    // distance 1001, penetration 199, lowShare 99, highShare 100.
    const result = resolveBodyOverlap(low(0), high(1001), 600);
    expect([result.a.x, result.b.x]).toEqual([-99, 1101]);
  });

  it('orders by side, not by argument order', () => {
    const result = resolveBodyOverlap(high(1000), low(0), 600);
    expect([result.a.x, result.b.x]).toEqual([1100, -100]);
  });

  it('separates coincident centers along positive x', () => {
    // distance 0, normal (32767, 0), penetration 1200, lowShare 600, highShare 600.
    const result = resolveBodyOverlap(low(0), high(0), 600);
    expect([result.a.x, result.a.y, result.b.x, result.b.y]).toEqual([-600, 0, 600, 0]);
  });

  it('truncates negative normal components toward zero', () => {
    // low at (500, 500), high at (0, 0): dx = -500, dy = -500.
    // distanceSquared 500000, distance = integerSqrt = 707, penetration 493,
    // lowShare 246, highShare 247.
    // normal.x = trunc(-500 * 32767 / 707) = trunc(-23173.6...) = -23173 (toward zero).
    // lowPush = trunc(-23173 * 246 / 32767) = trunc(-173.98...) = -173.
    // highPush = trunc(-23173 * 247 / 32767) = trunc(-174.68...) = -174.
    const result = resolveBodyOverlap(body({ sessionId: 10, side: 0, x: 500, y: 500 }), high(0, 0), 600);
    expect([result.a.x, result.a.y]).toEqual([673, 673]);
    expect([result.b.x, result.b.y]).toEqual([-174, -174]);
  });

  it('does not renormalize, so one call can under-separate diagonally', () => {
    const result = resolveBodyOverlap(body({ sessionId: 10, side: 0, x: 500, y: 500 }), high(0, 0), 600);
    const dx = result.a.x - result.b.x;
    const dy = result.a.y - result.b.y;
    expect(dx * dx + dy * dy).toBeLessThan(1200 * 1200);
  });

  it('preserves velocity and every non-position field', () => {
    const source = body({ sessionId: 10, side: 0, x: 0, y: 0, vx: 41, vy: -17, aimX: 100, aimY: -200, chargePermille: 333, forcedFireTicks: 4, cooldownTicks: 7, dashAvailable: false, acknowledgedInput: 12 });
    const result = resolveBodyOverlap(source, high(1000), 600);
    expect(result.a).toEqual({ ...source, x: -100 });
    expect(source.x).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (workdir `src/Brmble.Web`): `npx vitest run src/components/Games/Arena/arenaMath.test.ts -t resolveBodyOverlap`
Expected: FAIL — `resolveBodyOverlap is not exported` / import error.

- [ ] **Step 3: Implement `resolveBodyOverlap`**

In `arenaMath.ts`, add near the other fixed-point primitives (after `integerSqrt`, around line 56):

```ts
export const Q15 = 32_767;

/**
 * Exact mirror of ArenaSimulation.ResolveBodyOverlap (stage 9 of the server tick).
 * Feeds deterministic replay, so every truncation here must match C# integer
 * division, which truncates toward zero. Do not renormalize the Q15 normal:
 * the server does not, so a single call may leave the bodies slightly overlapped.
 */
export function resolveBodyOverlap(
  a: ArenaPlayerSnapshot,
  b: ArenaPlayerSnapshot,
  playerRadius: number,
): { a: ArenaPlayerSnapshot; b: ArenaPlayerSnapshot } {
  const aIsLow = a.side === 0;
  const low = aIsLow ? a : b;
  const high = aIsLow ? b : a;
  const dx = high.x - low.x;
  const dy = high.y - low.y;
  const distanceSquared = dx * dx + dy * dy;
  const diameter = playerRadius * 2;
  if (distanceSquared >= diameter * diameter) return { a, b };

  const distance = Number(integerSqrt(BigInt(distanceSquared)));
  const normalX = distance === 0 ? Q15 : Math.trunc(dx * Q15 / distance);
  const normalY = distance === 0 ? 0 : Math.trunc(dy * Q15 / distance);
  const penetration = diameter - distance;
  const lowShare = Math.trunc(penetration / 2);
  const highShare = penetration - lowShare;

  const nextLow: ArenaPlayerSnapshot = {
    ...low,
    x: low.x - Math.trunc(normalX * lowShare / Q15),
    y: low.y - Math.trunc(normalY * lowShare / Q15),
  };
  const nextHigh: ArenaPlayerSnapshot = {
    ...high,
    x: high.x + Math.trunc(normalX * highShare / Q15),
    y: high.y + Math.trunc(normalY * highShare / Q15),
  };
  return aIsLow ? { a: nextLow, b: nextHigh } : { a: nextHigh, b: nextLow };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Games/Arena/arenaMath.test.ts -t resolveBodyOverlap`
Expected: PASS, 9 tests.

- [ ] **Step 5: Cross-check the parity vectors against the server**

Add a matching MSTest to `tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs` so the two implementations cannot drift. Use the existing `ArenaHarness` in that file (`Live()`, `Place`, `Step`, `Player`, `DistanceSquared`). Session ids `[10, 20]` give side 0 = 10, side 1 = 20.

```csharp
    [TestMethod]
    public void BodyOverlapSplitsEvenPenetrationInHalf()
    {
        var harness = ArenaHarness.Live();
        harness.Place(10, 0, 0);
        harness.Place(20, 1000, 0);
        harness.Step();
        Assert.AreEqual(-100, harness.Player(10).X);
        Assert.AreEqual(1100, harness.Player(20).X);
    }

    [TestMethod]
    public void BodyOverlapAssignsTheOddUnitToSideOne()
    {
        var harness = ArenaHarness.Live();
        harness.Place(10, 0, 0);
        harness.Place(20, 1001, 0);
        harness.Step();
        Assert.AreEqual(-99, harness.Player(10).X);
        Assert.AreEqual(1101, harness.Player(20).X);
    }

    [TestMethod]
    public void BodyOverlapTruncatesNegativeNormalComponentsTowardZero()
    {
        var harness = ArenaHarness.Live();
        harness.Place(10, 500, 500);
        harness.Place(20, 0, 0);
        harness.Step();
        Assert.AreEqual(673, harness.Player(10).X);
        Assert.AreEqual(673, harness.Player(10).Y);
        Assert.AreEqual(-174, harness.Player(20).X);
        Assert.AreEqual(-174, harness.Player(20).Y);
    }
```

These assume no neutral-input movement or velocity on the tick. `Live()` leaves both players with zero velocity and neutral input, so stages 5-8 are no-ops. Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter BodyOverlap`.

Expected: PASS. **If any server assertion disagrees with the client expectation, the client is wrong — fix the client, never the server.**

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs
git commit -m "feat: mirror server body overlap in arena client math"
```

---

### Task 2: Run predicted body overlap inside `stepLocal`

`stepLocal` (`arenaMath.ts:184-263`) currently covers server stages 1-8 and stops after velocity damping. The overlap stage runs at server stage 9, immediately after damping, so it goes at the end of `stepLocal`.

The opponent is dead-reckoned linearly from the reconcile snapshot at one tick per step, exactly as `sampleTimeline` extrapolates (`arenaMath.ts:416-424`): position advances by velocity, velocity is unchanged, and no opponent input, dash, or fire is simulated. The pushed opponent stays in `next.opponent` so successive replayed ticks see a consistent opponent.

`stepLocal` already early-returns for `awaitingParticipants`, `loading` and `ended`, which matches the server skipping overlap only in `Loading`.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts:184-263`
- Test: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`

**Interfaces:**
- Consumes: `resolveBodyOverlap` from Task 1.
- Produces: no new exports. `stepLocal`'s returned `PredictedArenaState.opponent` is now dead-reckoned and overlap-resolved rather than a frozen copy of the authoritative opponent.

- [ ] **Step 1: Write the failing tests**

Append to `arenaMath.test.ts`. Use the file's existing `snapshot()` / `authority()` / `pending()` helpers where convenient; these tests drive `stepLocal` directly, so build the state from `reconcile` with no pending input.

```ts
describe('stepLocal body overlap', () => {
  const liveState = (localX: number, opponentX: number) => reconcile(
    authority(snapshot({
      phase: 'live',
      players: [
        { ...snapshot().players[0], sessionId: 10, side: 0, x: localX, y: 0, vx: 0, vy: 0 },
        { ...snapshot().players[1], sessionId: 20, side: 1, x: opponentX, y: 0, vx: 0, vy: 0 },
      ],
    })),
    [],
    prediction,
  ).local;

  const idle = { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false };

  it('separates the predicted local player from an overlapping opponent', () => {
    const next = stepLocal(liveState(0, 1000), idle, prediction);
    expect(next.player.x).toBe(-100);
    expect(next.opponent?.x).toBe(1100);
  });

  it('does not touch positions when the bodies are clear', () => {
    const next = stepLocal(liveState(0, 4000), idle, prediction);
    expect(next.player.x).toBe(0);
    expect(next.opponent?.x).toBe(4000);
  });

  it('dead-reckons the opponent forward by its velocity before resolving overlap', () => {
    const state = liveState(0, 1300);
    state.opponent = { ...state.opponent!, vx: -200 };
    // Opponent dead-reckons to 1100, penetration 100, lowShare 50, highShare 50.
    const next = stepLocal(state, idle, prediction);
    expect(next.player.x).toBe(-50);
    expect(next.opponent?.x).toBe(1150);
    expect(next.opponent?.vx).toBe(-200);
  });

  it('skips the overlap stage when there is no opponent', () => {
    const state = liveState(0, 1000);
    state.opponent = null;
    expect(stepLocal(state, idle, prediction).player.x).toBe(0);
  });

  it('keeps prediction error bounded through sustained contact', () => {
    let state = liveState(0, 1000);
    for (let tick = 0; tick < 120; tick++) state = stepLocal(state, idle, prediction);
    const dx = state.player.x - state.opponent!.x;
    // Never drifts far past a single separation; nowhere near the 300-unit snap threshold.
    expect(Math.abs(dx)).toBeLessThan(1300);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Games/Arena/arenaMath.test.ts -t "stepLocal body overlap"`
Expected: FAIL — the first test reports `next.player.x` is `0`, not `-100`.

- [ ] **Step 3: Add the stage to `stepLocal`**

In `arenaMath.ts`, replace the tail of `stepLocal` — the block starting at the `if (live) {` that integrates and damps velocity, through `return next;` — with:

```ts
  if (live) {
    player.x += player.vx;
    player.y += player.vy;
    player.vx = multiplyDivideTruncated(player.vx, constants.momentumRetentionPermille, 1000);
    player.vy = multiplyDivideTruncated(player.vy, constants.momentumRetentionPermille, 1000);
  }

  // Server stage 9. The opponent is dead-reckoned from authority, never simulated:
  // no opponent input, dash, or fire is inferred. Same linear extrapolation
  // sampleTimeline already uses.
  if (next.opponent !== null) {
    const opponent = live
      ? { ...next.opponent, x: next.opponent.x + next.opponent.vx, y: next.opponent.y + next.opponent.vy }
      : { ...next.opponent };
    const resolved = resolveBodyOverlap(player, opponent, constants.playerRadius);
    next.player = resolved.a;
    next.opponent = resolved.b;
  }

  return next;
```

Note `next.player = resolved.a` replaces the object the local `player` alias points at; do not read `player` after this line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Games/Arena/arenaMath.test.ts`
Expected: PASS for the new block. Existing `arenaMath` tests that place players closer than `1200` units apart will now shift. Inspect each such failure: if the expectation was written for a state with overlapping bodies, update the expected coordinates to the new server-correct values; if it was not, the implementation is wrong. Do not relax an assertion to make it pass.

- [ ] **Step 5: Run the full frontend suite**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS. `useArenaState.test.tsx` fixtures place players at `x = 1000` and `x = -1000` (2000 apart), which is clear of the diameter, so they should be unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts
git commit -m "feat: resolve predicted body overlap during arena replay"
```

---

### Task 3: Retune the overlap snap condition

With prediction now mirroring the server, ordinary contact no longer produces the overlap that currently forces a hard snap (`arenaMath.ts:358-360`). Shallow overlap becomes expected and must stop snapping; deep overlap still indicates real desynchronisation and still snaps.

Threshold: snap when centers are closer than three quarters of a diameter. A single server separation leaves the bodies at or just under one diameter, so ordinary sustained contact never approaches `0.75`.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts:271-276` and `:358-360`
- Test: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`

**Interfaces:**
- Produces: `bodiesOverlap` is replaced by `function deeplyOverlapping(left: FixedVec, right: FixedVec, playerRadius: number): boolean` (module-private). No public API change to `reconcile`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('overlap snap tuning', () => {
  const contact = (opponentX: number) => {
    const base = snapshot({
      phase: 'live',
      players: [
        { ...snapshot().players[0], sessionId: 10, side: 0, x: 0, y: 0, vx: 0, vy: 0 },
        { ...snapshot().players[1], sessionId: 20, side: 1, x: opponentX, y: 0, vx: 0, vy: 0 },
      ],
    });
    const previous = reconcile(authority(base), [], prediction).local;
    return reconcile({ ...authority(base), previous }, [], prediction);
  };

  it('does not snap for ordinary shallow contact', () => {
    expect(contact(1150).snapped).toBe(false);
  });

  it('snaps when the bodies are deeply interpenetrated', () => {
    expect(contact(400).snapped).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Games/Arena/arenaMath.test.ts -t "overlap snap tuning"`
Expected: FAIL on the first test — shallow contact currently snaps.

- [ ] **Step 3: Retune the condition**

Replace `bodiesOverlap` in `arenaMath.ts` with:

```ts
/**
 * Deep interpenetration threshold, as a fraction of the player diameter.
 * Shallow overlap is expected: the local player is displayed at approximately
 * now while the remote player comes from a 100 ms buffer, and the server's
 * un-renormalized push can itself leave the bodies slightly overlapped.
 * Only genuine desynchronisation reaches this depth.
 */
const DEEP_OVERLAP_DIAMETER_FRACTION = 3 / 4;

function deeplyOverlapping(left: FixedVec, right: FixedVec, playerRadius: number): boolean {
  const dx = BigInt(left.x - right.x);
  const dy = BigInt(left.y - right.y);
  const limit = BigInt(Math.trunc(playerRadius * 2 * DEEP_OVERLAP_DIAMETER_FRACTION));
  return dx * dx + dy * dy < limit * limit;
}
```

Then in `reconcile`, change the `invalidPosition` expression to use it:

```ts
  const invalidPosition = !insideRadius(local.player, authoritative.arena.radius)
    || (local.opponent !== null && deeplyOverlapping(local.player, local.opponent, constants.playerRadius));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts
git commit -m "fix: snap arena prediction only on deep body overlap"
```

---

### Task 4: Display-space local constraint

The residual after prediction is corrected is purely a timeline mismatch: the local player is displayed at approximately now, the remote from a 100 ms buffer. The error is entirely on the local side, so the constraint moves **only** the local player, and moves it **fully** clear — unlike the predicted stage, which reproduces the server's partial push.

Exact integer parity is not required here; both inputs are already non-authoritative and time-mismatched. Clearing by `diameter + 1` absorbs rounding so the result is always at or beyond one diameter.

The constrained position is then clamped inward to the arena radius. A purely presentational push must never render the local player outside the ring without an authoritative knockout.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`
- Test: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`

**Interfaces:**
- Produces: `export function constrainLocalDisplay(local: ArenaPlayerSnapshot, remote: ArenaPlayerSnapshot | null, playerRadius: number, arenaRadius: number): ArenaPlayerSnapshot`

- [ ] **Step 1: Write the failing tests**

```ts
describe('constrainLocalDisplay', () => {
  const body = (overrides: Partial<ArenaPlayerSnapshot> = {}): ArenaPlayerSnapshot => ({
    sessionId: 10, side: 0, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0,
    chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0,
    dashAvailable: true, acknowledgedInput: 0, ...overrides,
  });
  const clear = (local: ArenaPlayerSnapshot, remote: ArenaPlayerSnapshot) => {
    const dx = local.x - remote.x;
    const dy = local.y - remote.y;
    return dx * dx + dy * dy;
  };

  it('pushes the local player fully clear of the remote circle', () => {
    const remote = body({ sessionId: 20, side: 1, x: 0, y: 0 });
    const result = constrainLocalDisplay(body({ x: 400, y: 0 }), remote, 600, 9000);
    expect(clear(result, remote)).toBeGreaterThanOrEqual(1200 * 1200);
    expect(result.y).toBe(0);
  });

  it('clears diagonal overlap fully', () => {
    const remote = body({ sessionId: 20, side: 1, x: 100, y: -250 });
    const result = constrainLocalDisplay(body({ x: 500, y: 300 }), remote, 600, 9000);
    expect(clear(result, remote)).toBeGreaterThanOrEqual(1200 * 1200);
  });

  it('leaves an already separated local player untouched', () => {
    const local = body({ x: 3000, y: 0 });
    const result = constrainLocalDisplay(local, body({ sessionId: 20, side: 1, x: 0, y: 0 }), 600, 9000);
    expect(result).toBe(local);
  });

  it('separates coincident centers along positive x', () => {
    const result = constrainLocalDisplay(body({ x: 0, y: 0 }), body({ sessionId: 20, side: 1, x: 0, y: 0 }), 600, 9000);
    expect(result.x).toBeGreaterThanOrEqual(1200);
    expect(result.y).toBe(0);
  });

  it('never renders the local player outside the arena radius', () => {
    const remote = body({ sessionId: 20, side: 1, x: 8800, y: 0 });
    const result = constrainLocalDisplay(body({ x: 8900, y: 0 }), remote, 600, 9000);
    expect(result.x * result.x + result.y * result.y).toBeLessThanOrEqual(9000 * 9000);
  });

  it('returns the local player unchanged when there is no remote player', () => {
    const local = body({ x: 10, y: 20 });
    expect(constrainLocalDisplay(local, null, 600, 9000)).toBe(local);
  });

  it('never mutates its inputs and preserves every non-position field', () => {
    const local = body({ x: 400, vx: 31, vy: -9, aimX: 12, aimY: -34, chargePermille: 500, cooldownTicks: 3, dashAvailable: false, acknowledgedInput: 8 });
    const remote = body({ sessionId: 20, side: 1, x: 0, y: 0 });
    const result = constrainLocalDisplay(local, remote, 600, 9000);
    expect(local.x).toBe(400);
    expect(remote.x).toBe(0);
    expect({ ...result, x: 0, y: 0 }).toEqual({ ...local, x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Games/Arena/arenaMath.test.ts -t constrainLocalDisplay`
Expected: FAIL — `constrainLocalDisplay` is not exported.

- [ ] **Step 3: Implement the constraint**

Add to `arenaMath.ts`, near `resolveBodyOverlap`:

```ts
/**
 * Display filter, not client authority. The local player is presented at
 * approximately now while the remote player is replayed from a 100 ms buffer,
 * so displayed bodies can overlap even when both source states are valid.
 * The error is entirely local, so only the local player moves; the remote
 * player must never deviate from its authoritative interpolated path.
 *
 * The result is never written back into prediction, presentation, snapshots,
 * pending inputs, or the correction origin.
 */
export function constrainLocalDisplay(
  local: ArenaPlayerSnapshot,
  remote: ArenaPlayerSnapshot | null,
  playerRadius: number,
  arenaRadius: number,
): ArenaPlayerSnapshot {
  if (remote === null) return local;
  const dx = local.x - remote.x;
  const dy = local.y - remote.y;
  const distanceSquared = dx * dx + dy * dy;
  const diameter = playerRadius * 2;
  if (distanceSquared >= diameter * diameter) return local;

  const distance = Math.sqrt(distanceSquared);
  const unitX = distance === 0 ? 1 : dx / distance;
  const unitY = distance === 0 ? 0 : dy / distance;
  // One extra unit absorbs the rounding below, so the result always clears a
  // full diameter rather than landing a unit short of it.
  let x = Math.round(remote.x + unitX * (diameter + 1));
  let y = Math.round(remote.y + unitY * (diameter + 1));

  const radiusSquared = x * x + y * y;
  if (radiusSquared > arenaRadius * arenaRadius) {
    const length = Math.sqrt(radiusSquared);
    x = Math.trunc(x * arenaRadius / length);
    y = Math.trunc(y * arenaRadius / length);
  }
  return { ...local, x, y };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/Games/Arena/arenaMath.test.ts -t constrainLocalDisplay`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts
git commit -m "feat: add arena local display separation constraint"
```

---

### Task 5: Unify the presentation clock on the animation-frame timestamp

Today the presentation advance uses the animation-frame `frameTime` (`useArenaState.ts:231, 242`) while the correction blend uses `Date.now()` (`:216, 249`). Task 6 couples the two tightly enough that the drift between the clocks becomes visible, so unify them first as an isolated, behaviour-preserving change.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts:216, 249`
- Test: `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`

**Interfaces:**
- Produces: no API change. `correctionRef` still holds `{ x, y, startedAt }`; `startedAt` is now an animation-frame timestamp rather than a wall-clock one.

- [ ] **Step 1: Update the existing correction test to drive the frame clock**

`useArenaState.test.tsx` currently drives the correction blend with `vi.setSystemTime(1000 / 1050 / 1100 / 1250)` while calling `frame?.(...)`. Rewrite that test (the one named `blends small corrections for 100ms and presents predicted own projectiles immediately`, around `:169-196`) so the elapsed correction time is carried by the `frameTime` argument instead:

```ts
  it('blends small corrections over 100ms on the animation-frame clock', () => {
    const startedAt = 1_000;
    vi.setSystemTime(1_000);
    let latestFrame: ArenaRenderState | null = null;
    const hook = renderHook(props => useArenaState({ ...props, onFrame: state => { latestFrame = state; } }), {
      initialProps: { welcome: welcome(), latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [], selfSessionId: 10 },
    });
    act(() => { frame?.(startedAt); });
    hook.rerender({ welcome: welcome(), latestSnapshot: snapshot(1, 1_000, 1_200), pendingInputs: [], selfSessionId: 10 });
    act(() => { frame?.(startedAt); });
    const corrected = latestFrame!.localPlayer!.x;
    act(() => { frame?.(startedAt + 50); });
    const halfway = latestFrame!.localPlayer!.x;
    act(() => { frame?.(startedAt + 100); });
    const settled = latestFrame!.localPlayer!.x;
    expect(halfway).toBeGreaterThan(corrected);
    expect(settled).toBeGreaterThan(halfway);
  });
```

Keep the predicted-projectile assertion from the original test if it was in the same `it` block; move it to its own `it` if that is cleaner. Do not delete coverage.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Games/Arena/useArenaState.test.tsx -t "animation-frame clock"`
Expected: FAIL — with the system clock frozen, `Date.now()` never advances, so `remaining` stays at `1` and the position never settles.

- [ ] **Step 3: Move the correction clock onto `frameTime`**

In `useArenaState.ts`, change line 216 from `startedAt: Date.now()` to `startedAt: frameTime`:

```ts
            correctionRef.current = result.correction
              ? { x: result.correction.x, y: result.correction.y, startedAt: frameTime }
              : null;
```

and line 249 from `Date.now()` to `frameTime`:

```ts
        const remaining = correction ? Math.max(0, 1 - (frameTime - correction.startedAt) / 100) : 0;
```

Leave the `sampleTimeline` call at `:247` on `Date.now()` — the snapshot timeline is keyed on `generatedAtUnixMs`, which is wall-clock, and must stay there.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS. Other correction-related tests in `useArenaState.test.tsx` that relied on `vi.setSystemTime` for blending must be converted the same way.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaState.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx
git commit -m "refactor: blend arena corrections on the animation-frame clock"
```

---

### Task 6: Preserve the local tick phase across ordinary snapshots

`useArenaState.ts:221` currently sets `presentedAtRef.current = frameTime` on every reconcile. That discards fractional progress toward the next 60 Hz tick, so a normal 20 Hz correction introduces a repeated pause or uneven step.

The invariant to establish:

> The local tick-phase clock is monotonic. An ordinary snapshot never resets it.
> Only a mandatory snap resets it.

`presentedAtRef` is the tick anchor: `frameTime - presentedAtRef.current` is elapsed time since the last completed presented tick, and the advance step consumes whole ticks out of it. Preserving phase therefore means carrying only the remainder *within one tick*, so the advance step that runs later in the same frame cannot re-apply ticks that `reconcile` already replayed.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts:212-224`
- Test: `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`

**Interfaces:**
- Produces: no API change. `presentedAtRef` now carries a preserved sub-tick phase rather than being reset each reconcile.

- [ ] **Step 1: Write the failing tests**

Add to `useArenaState.test.tsx`. `welcome().tickRate` is `60`, so one tick is `16.666...` ms.

```ts
  it('does not lose a frame of local movement when an ordinary snapshot lands', () => {
    const startedAt = 1_000;
    vi.setSystemTime(1_000);
    const held = { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false };
    const positions: number[] = [];
    const props = (latestSnapshot: ArenaSnapshot | null) => ({
      welcome: welcome(), latestSnapshot, pendingInputs: [], currentInput: held, selfSessionId: 10,
      onFrame: (state: ArenaRenderState) => { positions.push(state.localPlayer!.x); },
    });
    const hook = renderHook(p => useArenaState(p), { initialProps: props(null) });
    // Sample at ~144 Hz across a snapshot boundary at t+56 (a non-tick-aligned time).
    for (let i = 0; i < 8; i++) act(() => { frame?.(startedAt + i * 7); });
    hook.rerender(props(snapshot(1, 1_000, 1_000)));
    for (let i = 8; i < 16; i++) act(() => { frame?.(startedAt + i * 7); });
    const deltas = positions.slice(1).map((x, index) => x - positions[index]);
    // No frame stalls (repeats the previous position) and none double-steps.
    expect(Math.min(...deltas)).toBeGreaterThan(0);
    expect(Math.max(...deltas)).toBeLessThan(2 * Math.min(...deltas) + 2);
  });

  it('resets the tick phase on a mandatory snap', () => {
    const startedAt = 1_000;
    vi.setSystemTime(1_000);
    const hook = renderHook(p => useArenaState(p), {
      initialProps: {
        welcome: welcome(), latestSnapshot: null as ArenaSnapshot | null,
        pendingInputs: [], selfSessionId: 10,
      },
    });
    act(() => { frame?.(startedAt); });
    // A score change is a mandatory discrete snap condition.
    const scored = { ...snapshot(1, 1_000, 1_000), score: [1, 0] as [number, number] };
    hook.rerender({ welcome: welcome(), latestSnapshot: scored, pendingInputs: [], selfSessionId: 10 });
    act(() => { frame?.(startedAt + 40); });
    expect(hook.result.current.snapCount).toBe(1);
  });
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `npx vitest run src/components/Games/Arena/useArenaState.test.tsx -t "does not lose a frame"`
Expected: FAIL — the delta at the snapshot boundary collapses to `0` because the phase is reset.

- [ ] **Step 3: Preserve the phase**

In `useArenaState.ts`, replace the reconcile result block (`:212-224`) with:

```ts
          const tickMs = 1000 / welcome.tickRate;
          if (authorityChanged) {
            if (result.snapped && predictedRef.current && !snappedRef.current) snapCountRef.current++;
            snappedRef.current = result.snapped;
            correctionRef.current = result.correction
              ? { x: result.correction.x, y: result.correction.y, startedAt: frameTime }
              : null;
          }
          // The local tick-phase clock is monotonic. Reconcile supplies completed
          // ticks; the phase clock supplies only the remainder within the current
          // tick. Carrying the whole elapsed time would double-apply ticks that
          // reconcile has already replayed. Only a mandatory snap resets the phase.
          const phaseMs = predictedRef.current && !result.snapped
            ? Math.max(0, (frameTime - presentedAtRef.current) % tickMs)
            : 0;
          predictedRef.current = result.local;
          presentedRef.current = result.local;
          presentedAtRef.current = frameTime - phaseMs;
          authorityDirtyRef.current = false;
          inputDirtyRef.current = false;
```

`predictedRef.current &&` guards the very first reconcile, where `presentedAtRef.current` is still `0` and the modulo would be meaningless.

- [ ] **Step 4: Run to verify both tests pass**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS. If a pre-existing cadence test now expects an exact integer that shifted by a unit or two, verify by hand that the new value is on a smooth trajectory before updating it.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaState.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx
git commit -m "fix: preserve arena sub-tick phase across ordinary snapshots"
```

---

### Task 7: Apply the display constraint in the frame loop

Wire `constrainLocalDisplay` into `useArenaState` at step 7 of the frame flow: after the correction blend, before publishing to Canvas and `localPlayerRef`.

Critically, `renderedLocalRef` must keep the **unconstrained** presented position, because it is the correction origin for the next reconcile (`useArenaState.ts:207`). Feeding the constrained position back would measure prediction against a client-only display artifact and oscillate against the constraint.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts:248-263`
- Test: `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`

**Interfaces:**
- Consumes: `constrainLocalDisplay` from Task 4.
- Produces: `ArenaRenderState.localPlayer` is now the constrained display position. `ArenaBoard` already assigns `localPlayer` to `localPlayerRef` and passes it to the renderer (`ArenaBoard.tsx:118-127`), so both automatically use the same constrained center — no change is needed there.

- [ ] **Step 1: Write the failing tests**

```ts
  it('never displays overlapping player bodies', () => {
    vi.setSystemTime(1_000);
    let latestFrame: ArenaRenderState | null = null;
    const contact = (sequence: number, at: number): ArenaSnapshot => ({
      ...snapshot(sequence, at, 0),
      players: [
        { ...state(0).players[0], sessionId: 10, side: 0, x: 0, y: 0 },
        { ...state(0).players[1], sessionId: 20, side: 1, x: 700, y: 0 },
      ],
    });
    const hook = renderHook(p => useArenaState({ ...p, onFrame: s => { latestFrame = s; } }), {
      initialProps: { welcome: welcome(), latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [], selfSessionId: 10 },
    });
    act(() => { frame?.(1_000); });
    hook.rerender({ welcome: welcome(), latestSnapshot: contact(1, 1_000), pendingInputs: [], selfSessionId: 10 });
    vi.setSystemTime(1_050);
    act(() => { frame?.(1_050); });
    const local = latestFrame!.localPlayer!;
    const remote = latestFrame!.remotePlayer!;
    const dx = local.x - remote.x;
    const dy = local.y - remote.y;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(1200 * 1200);
  });

  it('never moves the displayed remote player away from its interpolated path', () => {
    // Same setup as above; assert the remote x equals the sampled authoritative x.
    // The constraint must only ever move the local player.
  });

  it('does not generate a correction from a constraint-only offset', () => {
    // Drive several identical contact snapshots. snapCount must stay at 0 and the
    // local display position must settle rather than oscillate, proving the
    // constrained position never reaches renderedLocalRef / the correction origin.
  });
```

Fill in the two stubbed tests with the same fixture shape as the first before running. The second asserts `latestFrame.remotePlayer.x` is exactly the value `sampleTimeline` produces for that frame (compute it by calling `sampleTimeline` directly in the test with the same arguments). The third drives at least six identical snapshots at 50 ms spacing and asserts `hook.result.current.snapCount === 0` and that the last three local x values are equal.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/Games/Arena/useArenaState.test.tsx -t "displays overlapping"`
Expected: FAIL — the displayed bodies overlap.

- [ ] **Step 3: Apply the constraint before publishing**

In `useArenaState.ts`, replace lines `248-263` with:

```ts
        const correction = correctionRef.current;
        const remaining = correction ? Math.max(0, 1 - (frameTime - correction.startedAt) / 100) : 0;
        const local = correction ? {
          ...interpolatedPlayer,
          x: Math.trunc(interpolatedPlayer.x - correction.x * remaining),
          y: Math.trunc(interpolatedPlayer.y - correction.y * remaining),
        } : interpolatedPlayer;
        // The unconstrained presented position is the correction origin for the
        // next reconcile. The display constraint below must never reach it.
        renderedLocalRef.current = local;
        const remote = sampled.players.find(player => player.sessionId !== current.selfSessionId) ?? null;
        const displayedLocal = constrainLocalDisplay(
          local, remote, welcome.prediction.playerRadius, sampled.arena.radius,
        );
        const predictedProjectiles = presented.projectiles.filter(projectile => projectile.id < 0);
        const nextRendered: ArenaRenderState = {
          localPlayer: displayedLocal, remotePlayer: remote,
          projectiles: [...sampled.projectiles, ...predictedProjectiles],
          arena: sampled.arena, phase: sampled.phase, phaseEndsAtTick: sampled.phaseEndsAtTick,
          score: [sampled.score[0], sampled.score[1]], consecutiveDoubleKos: sampled.consecutiveDoubleKos,
          snapCount: snapCountRef.current,
        };
```

Add `constrainLocalDisplay` to the existing import from `./arenaMath` at line 6.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaState.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx
git commit -m "feat: constrain displayed arena local player against the remote body"
```

---

### Task 8: Sustained-contact hook tests from both perspectives

The acceptance criteria require measured, not visual, evidence that prediction error stays bounded through contact of arbitrary duration. These tests are the measurement.

**Files:**
- Test: `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-7. No production change expected. If a test fails, fix the production code, not the threshold.

- [ ] **Step 1: Write the sustained-contact tests**

```ts
  describe('sustained contact', () => {
    const contactSnapshot = (sequence: number, at: number, localX: number, remoteX: number): ArenaSnapshot => ({
      ...snapshot(sequence, at, localX),
      players: [
        { ...state(0).players[0], sessionId: 10, side: 0, x: localX, y: 0 },
        { ...state(0).players[1], sessionId: 20, side: 1, x: remoteX, y: 0 },
      ],
    });

    it('never overlaps or hard-snaps while the local player pushes the opponent', () => {
      vi.setSystemTime(1_000);
      const held = { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false };
      const frames: ArenaRenderState[] = [];
      const props = (latestSnapshot: ArenaSnapshot | null) => ({
        welcome: welcome(), latestSnapshot, pendingInputs: [], currentInput: held, selfSessionId: 10,
        onFrame: (s: ArenaRenderState) => { frames.push(s); },
      });
      const hook = renderHook(p => useArenaState(p), { initialProps: props(null) });
      let localX = 0;
      let remoteX = 1_200;
      // 40 snapshots at 50 ms = 2 seconds of sustained contact.
      for (let sequence = 1; sequence <= 40; sequence++) {
        const at = 1_000 + sequence * 50;
        localX += 90;
        remoteX = Math.max(remoteX, localX + 1_200);
        hook.rerender(props(contactSnapshot(sequence, at, localX, remoteX)));
        for (let step = 0; step < 3; step++) {
          vi.setSystemTime(at + step * 16);
          act(() => { frame?.(at + step * 16); });
        }
      }
      expect(hook.result.current.snapCount).toBe(0);
      for (const rendered of frames.filter(f => f.remotePlayer !== null)) {
        const dx = rendered.localPlayer!.x - rendered.remotePlayer!.x;
        const dy = rendered.localPlayer!.y - rendered.remotePlayer!.y;
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(1200 * 1200);
      }
      const xs = frames.map(f => f.localPlayer!.x);
      const deltas = xs.slice(1).map((x, index) => x - xs[index]);
      // No periodic hard-snap spike: no single frame jumps by more than a few ticks
      // of movement (baseMovePerTick is 90).
      expect(Math.max(...deltas.map(Math.abs))).toBeLessThan(4 * 90);
    });

    it('never overlaps or hard-snaps while the opponent pushes the local player', () => {
      // Same harness, but the local player holds neutral input and the authoritative
      // remote x walks toward it, driving the local authoritative x outward.
      // Assert the same three properties: snapCount 0, no displayed overlap,
      // no delta spike.
    });
  });
```

Fill in the second test by mirroring the first: `currentInput` neutral, `remoteX` decreasing by `90` per snapshot from `2_400`, and `localX` set to `remoteX - 1_200` so authority reflects the server pushing the local player.

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/components/Games/Arena/useArenaState.test.tsx -t "sustained contact"`
Expected: PASS. If `snapCount` is non-zero, the predicted overlap stage or the retuned threshold is wrong — debug that, do not raise the threshold.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx
git commit -m "test: cover sustained arena contact from both perspectives"
```

---

### Task 9: Source renderer constants from `welcome.prediction`

`ArenaRenderer.ts:23-28` duplicates `BODY_RADIUS = 600`, `PROJECTILE_RADIUS = 180` and `SHOT_COOLDOWN_TICKS = 24` locally. This change makes `playerRadius` load-bearing in two new places, so the duplication is removed. `welcome.prediction` is already validated for exact equality against `PREDICTION_V1` (`arenaProtocol.ts:169-191`), so it is a safe single source.

`WORLD_SIZE = 20_000`, `CHARGE_LENGTH` and `AIM_LENGTH` are pure rendering constants with no server counterpart and stay where they are.

Per `docs/UI_GUIDE.md`, do not touch colors, spacing, or any other visual token in this task — geometry constants only.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts:7-14, 23-28, 76-250`
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx:118-127`
- Test: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts`

**Interfaces:**
- Produces: `ArenaRenderView` gains `prediction: ArenaPredictionConstants`. `ArenaBoard` supplies `welcome.prediction`.

- [ ] **Step 1: Read the renderer**

Read `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts` in full and list every use of `BODY_RADIUS`, `PROJECTILE_RADIUS` and `SHOT_COOLDOWN_TICKS`. There are uses in `render` (`:76-133`) and `drawPlayer` (`:149-250`).

- [ ] **Step 2: Update the test first**

In `ArenaRenderer.test.ts`, add `prediction: PREDICTION_V1` to every `ArenaRenderView` literal the tests construct, importing `PREDICTION_V1` from `./arenaProtocol`.

Run: `npx vitest run src/components/Games/Arena/ArenaRenderer.test.ts`
Expected: FAIL — TypeScript / runtime error, `prediction` is not a property of `ArenaRenderView`.

- [ ] **Step 3: Thread `prediction` through**

In `ArenaRenderer.ts`:

```ts
import type { ArenaPredictionConstants } from './arenaProtocol';

export interface ArenaRenderView {
  // ...existing fields...
  prediction: ArenaPredictionConstants;
}
```

Delete the `BODY_RADIUS`, `PROJECTILE_RADIUS` and `SHOT_COOLDOWN_TICKS` constants. In `render`, destructure once at the top:

```ts
    const { playerRadius, projectileRadius, shotCooldownTicks } = view.prediction;
```

and replace each former constant use with the corresponding local. Pass `playerRadius` and `shotCooldownTicks` into `drawPlayer` as parameters rather than reading a module constant.

In `ArenaBoard.tsx`, add `prediction: welcome.prediction` to the object passed to `rendererRef.current?.render(...)` at `:121`. `welcome` is already in scope there; if it is nullable at that point, the surrounding `if (current.arena)` guard is the right place to also require `welcome`.

- [ ] **Step 4: Run the tests**

Run: `npm test --prefix src/Brmble.Web` and `npm run type-check --prefix src/Brmble.Web`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx
git commit -m "refactor: source arena renderer geometry from prediction constants"
```

---

### Task 10: Full verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Frontend test suite**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS, zero failures. Confirm the pre-existing prediction, fire, dash, correction, session-replacement, terminal-state, renderer, input and connection suites all still run — do not accept a reduced test count.

- [ ] **Step 2: Type check**

Run: `npm run type-check --prefix src/Brmble.Web`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `npm run lint --prefix src/Brmble.Web`
Expected: clean.

- [ ] **Step 4: Production build**

Run: `npm run build --prefix src/Brmble.Web`
Expected: succeeds.

- [ ] **Step 5: Server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: PASS, including the new parity tests. `ArenaDeterminismTests` hashes cover player X/Y — they must be **unchanged**, because this plan does not modify server behaviour. A moved determinism hash means server code was edited by mistake; revert it.

- [ ] **Step 6: Solution build**

Run: `dotnet build`
Expected: succeeds.

- [ ] **Step 7: Manual two-client validation**

Per `CLAUDE.md`, Debug builds allow multiple instances. Build the frontend, then start two clients:

```powershell
npm run build --prefix src/Brmble.Web
dotnet run --project src/Brmble.Client
```

(twice, in separate terminals, plus the server). Start an Arena Knockoff match and check each acceptance criterion by hand:

- hold a movement key with no contact — the local player moves smoothly with no periodic stall;
- walk into the opponent and hold — no bump, no snap, from **both** clients;
- displayed bodies never visually interpenetrate;
- the remote player never visibly jitters or gets shoved off its path;
- aim, fire and dash still feel immediate;
- push the opponent toward the ring edge — the local player is never drawn outside the ring without a knockout.

- [ ] **Step 8: Report to the user**

Summarise results and ask before pushing the branch or opening a PR. Do not push automatically.

---

## Notes for the implementer

- **The server is authority, always.** If a client parity test disagrees with the server, the client is wrong.
- **Never write presentation back into prediction.** The single most likely bug in this change is the constrained display position leaking into `renderedLocalRef` (the correction origin), which produces a slow oscillation against the constraint that is easy to miss visually and obvious in the "does not generate a correction from a constraint-only offset" test.
- **The client does not infer opponent input.** Dead reckoning position from authoritative velocity is permitted and is what `sampleTimeline` already does. Simulating the opponent's movement, dash or fire is not.
- **Out of scope:** remote input prediction, dual-player client simulation, server tick/snapshot/protocol changes, Canvas visual changes, projectile lag compensation, transport diagnostics.
