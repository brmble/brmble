# Arena Knockout Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a knockout a visible consequence — the loser slides over the lip of the arena, falls away and puffs out — and give the arena a floor to fall off.

**Architecture:** Entirely client-side presentation. The knocked-out position is structurally unobservable on the wire, so the victim, position and velocity are inferred from the last snapshot before the round reset. A new pure module owns detection and time-sampling; `useArenaState` holds one ref; `ArenaRenderer` draws the falling body and suppresses the victim's normal draw. No protocol, server or determinism change.

**Tech Stack:** React 19 + TypeScript, Canvas 2D, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-06-arena-knockout-presentation-design.md`

**Branch:** `docs/arena-knockoff-revision` (already checked out). Do not commit to `main`. Do not push or open a PR without asking.

## Global Constraints

- **No server change, no protocol change, no determinism-hash change.** If a task appears to need one, stop and escalate. The client validator is arity-strict (`arenaProtocol.ts:126-130`), so any wire field is a breaking change.
- **Presentation must never write back** into `predictedRef`, `presentedRef`, `renderedBaseRef`, snapshots, pending inputs or the correction origin. Same rule as `constrainLocalDisplay`.
- World space is `±10_000`. Positions are integers. `playerRadius` is `600`; diameter `1200`. Never hardcode `600`, `1200`, `9000` in production code — read from `view.prediction` / `view.arena.radius`.
- `--bg-deep` is the void, `--bg-surface` is the arena floor. No hardcoded colours, sizes, spacing or durations: all from CSS custom property tokens per `docs/UI_GUIDE.md`.
- Reduced motion drops movement and scaling, never information. One rule for all triggers.
- One `requestAnimationFrame` loop, owned by `useArenaState`. No second loop, no new per-frame React state publication.
- Tests: Vitest, explicit named imports, lowercase behavioural names, exact assertions where derivable.
- Every test must be able to fail for the reason it claims. Verify by mutation before reporting.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts` | Modify | Paint order (floor/void); draw falling body and puff; suppress victim. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts` | Modify | Harness records `fillStyle`; background and knockout draw tests. |
| `src/Brmble.Web/src/components/Games/Arena/arenaKnockout.ts` | **Create** | Pure detector + time sampler. No React, no canvas. |
| `src/Brmble.Web/src/components/Games/Arena/arenaKnockout.test.ts` | **Create** | Exact-value sampler and detector tests. |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts` | Modify | One ref, one detector call, one frame field. |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx` | Modify | Lifecycle and non-leakage tests. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx` | Modify | Pass `knockout` into the render view. |

Verification (from `src/Brmble.Web` via `workdir`):

```powershell
npm test --prefix src/Brmble.Web
npm run type-check --prefix src/Brmble.Web
npm run build --prefix src/Brmble.Web
```

---

### Task 1: Give the arena a floor and a void

Prerequisite for everything else: today `render()` fills the whole square with `--bg-surface` and strokes the ring on top, so inside and outside the ring are the same colour and there is nothing to fall into.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts:91-100`
- Test: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts`

**Interfaces:**
- Consumes: `view.arena.radius`, the existing `point`/`scale` helpers.
- Produces: no new exports. The `Recorded` test type gains a `fillStyle` field.

- [ ] **Step 1: Teach the test harness to record `fillStyle`**

The harness records `strokeStyle` but not `fillStyle`, so fills cannot be asserted today. In `ArenaRenderer.test.ts`, extend the type and the proxy:

```ts
type Recorded = { op: string; args: unknown[]; strokeStyle?: string; fillStyle?: string; lineWidth?: number };
```

and in `setup()`'s proxy `get` trap:

```ts
      return (...args: unknown[]) => calls.push({
        op: String(property), args,
        strokeStyle: String(target.strokeStyle),
        fillStyle: String(target.fillStyle),
        lineWidth: target.lineWidth,
      });
```

Add `'--bg-deep': 'deep'` to the `getPropertyValue` mock map alongside the existing `'--bg-surface': 'surface'`.

- [ ] **Step 2: Write the failing test**

```ts
  it('fills the void behind the arena and the floor inside it with different colours', () => {
    const { renderer, calls } = setup();

    renderer.render(view(), { reducedMotion: false });

    // The square is the void; the disc drawn on top of it is the floor.
    const square = calls.find(call => call.op === 'fillRect');
    expect(square?.fillStyle).toBe('deep');
    const floor = calls.find(call => call.op === 'fill' && call.fillStyle === 'surface');
    expect(floor).toBeDefined();
    // The floor is filled before the ring is stroked, so the lip sits on the seam.
    expect(calls.indexOf(floor!)).toBeLessThan(calls.findIndex(call => call.op === 'stroke'));
  });
```

- [ ] **Step 3: Run it and watch it fail**

Run (`workdir: src/Brmble.Web`): `npx vitest run src/components/Games/Arena/ArenaRenderer.test.ts -t "fills the void"`
Expected: FAIL — `fillRect` records `fillStyle` `'surface'`, not `'deep'`.

- [ ] **Step 4: Invert the paint order**

In `render()`, read the new token alongside the others (`ArenaRenderer.ts:82-86`):

```ts
    const deep = color('--bg-deep');
```

then replace lines 91-100 with:

```ts
    ctx.clearRect(0, 0, this.layout.cssWidth, this.layout.cssHeight);
    // The void first, then the arena floor on top of it: the ring is the lip
    // between them, and a knocked-out player falls from one into the other.
    ctx.fillStyle = deep;
    ctx.fillRect(this.layout.offsetX, this.layout.offsetY, this.layout.size, this.layout.size);

    const center = point({ x: 0, y: 0 });
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.arc(center.x, center.y, view.arena.radius * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = view.arena.shrinkPhase === 'collapse' ? danger : neutral;
    ctx.lineWidth = line(view.arena.shrinkPhase === 'hold' ? 60 : 100);
    ctx.beginPath();
    ctx.arc(center.x, center.y, view.arena.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
```

- [ ] **Step 5: Run the renderer suite**

Run: `npx vitest run src/components/Games/Arena/ArenaRenderer.test.ts`
Expected: PASS. If a pre-existing test counted `arc` or `fill` calls, its expectation shifts by exactly one arc and one fill — verify that is the only reason before updating it.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts
git commit -m "feat: give the arena a floor distinct from the void outside it"
```

---

### Task 2: The knockout sampler

A pure function of elapsed time. No React, no canvas, no snapshots — so it can be tested with exact values at fixed offsets.

Stages, over `KNOCKOUT_DURATION_MS`:

1. **Slide** (first 30%) — outward along the radial normal, ease-out.
2. **Fall** (30%–70%) — scale 1 → 0 while drifting a little further out.
3. **Puff** (70%–100%) — body gone; dust ring expands and fades.

**Files:**
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaKnockout.ts`
- Test: `src/Brmble.Web/src/components/Games/Arena/arenaKnockout.test.ts`

**Interfaces:**
- Consumes: `ArenaStateSnapshot`, `ArenaPlayerSnapshot` from `./arenaProtocol`.
- Produces:

```ts
export const KNOCKOUT_DURATION_MS = 1400;
export const SLIDE_END = 0.3;
export const FALL_END = 0.7;

export interface ArenaKnockoutVictim {
  sessionId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ArenaKnockout {
  victims: ArenaKnockoutVictim[];
  startedAt: number;
  /** Forfeit and abandon vanish in place with no slide or fall. */
  vanishOnly: boolean;
}

export interface ArenaKnockoutFrame {
  sessionId: number;
  x: number;
  y: number;
  /** Body scale, 1 at the lip down to 0 when fallen. */
  scale: number;
  /** Dust ring radius in world units; 0 before the puff. */
  puffRadius: number;
  /** Dust ring opacity, 0 outside the puff window. */
  puffOpacity: number;
}

export function sampleKnockout(
  knockout: ArenaKnockout,
  nowMs: number,
  playerRadius: number,
  reducedMotion: boolean,
): ArenaKnockoutFrame[];
```

- [ ] **Step 1: Write the failing tests**

Create `arenaKnockout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sampleKnockout, type ArenaKnockout } from './arenaKnockout';

const victim = (overrides: Partial<ArenaKnockout['victims'][number]> = {}) => ({
  sessionId: 10, x: 9000, y: 0, vx: 0, vy: 0, ...overrides,
});
const knockout = (overrides: Partial<ArenaKnockout> = {}): ArenaKnockout => ({
  victims: [victim()], startedAt: 1000, vanishOnly: false, ...overrides,
});

describe('sampleKnockout', () => {
  it('starts the body at the exit point at full scale', () => {
    const [frame] = sampleKnockout(knockout(), 1000, 600, false);
    expect(frame.x).toBe(9000);
    expect(frame.scale).toBe(1);
    expect(frame.puffOpacity).toBe(0);
  });

  it('clears a zero-velocity victim by one diameter along the outward normal', () => {
    // Slide completes at 30% of 1400ms = 420ms. Exit is due +x, so the normal
    // is (1, 0) and the minimum clearance is playerRadius * 2 = 1200.
    const [frame] = sampleKnockout(knockout(), 1000 + 420, 600, false);
    expect(frame.x).toBe(10200);
    expect(frame.y).toBe(0);
  });

  it('throws a fast victim proportionally further than a walk-off', () => {
    const slow = sampleKnockout(knockout(), 1420, 600, false)[0];
    const fast = sampleKnockout(
      knockout({ victims: [victim({ vx: 300 })] }), 1420, 600, false,
    )[0];
    expect(fast.x).toBeGreaterThan(slow.x + 1000);
  });

  it('shrinks the body to nothing by the end of the fall', () => {
    const [frame] = sampleKnockout(knockout(), 1000 + 1000, 600, false);
    expect(frame.scale).toBe(0);
  });

  it('puffs only after the body has gone', () => {
    const falling = sampleKnockout(knockout(), 1000 + 700, 600, false)[0];
    expect(falling.puffOpacity).toBe(0);
    const puffing = sampleKnockout(knockout(), 1000 + 1100, 600, false)[0];
    expect(puffing.puffOpacity).toBeGreaterThan(0);
    expect(puffing.puffRadius).toBeGreaterThan(0);
  });

  it('vanishes in place with no slide when the match was forfeited', () => {
    const [frame] = sampleKnockout(knockout({ vanishOnly: true }), 1420, 600, false);
    expect(frame.x).toBe(9000);
    expect(frame.y).toBe(0);
  });

  it('starts the dust immediately when there is no fall to overlap', () => {
    const [frame] = sampleKnockout(knockout({ vanishOnly: true }), 1000 + 140, 600, false);
    expect(frame.puffOpacity).toBeGreaterThan(0);
    expect(frame.puffRadius).toBeGreaterThan(0);
  });

  it('shows the mark from the first frame under reduced motion', () => {
    const [frame] = sampleKnockout(knockout(), 1000, 600, true);
    expect(frame.puffOpacity).toBe(1);
    expect(frame.puffRadius).toBe(1800);
  });

  it('keeps the mark in place and skips slide and fall under reduced motion', () => {
    const [frame] = sampleKnockout(knockout({ victims: [victim({ vx: 300 })] }), 1420, 600, true);
    expect(frame.x).toBe(9000);
    expect(frame.scale).toBe(0);
    expect(frame.puffOpacity).toBeGreaterThan(0);
  });

  it('samples every victim of a double knockout', () => {
    const frames = sampleKnockout(
      knockout({ victims: [victim(), victim({ sessionId: 20, x: -9000 })] }), 1200, 600, false,
    );
    expect(frames.map(frame => frame.sessionId)).toEqual([10, 20]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/Games/Arena/arenaKnockout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sampler**

```ts
export const KNOCKOUT_DURATION_MS = 1400;
export const SLIDE_END = 0.3;
export const FALL_END = 0.7;

/** Minimum outward travel, in body diameters. */
const CLEARANCE_DIAMETERS = 1;
/** How far one unit of per-tick velocity carries the body, in world units. */
const VELOCITY_TRAVEL = 12;
/** Dust ring size at full expansion, in body diameters. */
const PUFF_DIAMETERS = 1.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export interface ArenaKnockoutVictim {
  sessionId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ArenaKnockout {
  victims: ArenaKnockoutVictim[];
  startedAt: number;
  vanishOnly: boolean;
}

export interface ArenaKnockoutFrame {
  sessionId: number;
  x: number;
  y: number;
  scale: number;
  puffRadius: number;
  puffOpacity: number;
}

/**
 * Pure function of elapsed time. Presentation only: the result is never written
 * back into prediction, presentation or authority state.
 */
export function sampleKnockout(
  knockout: ArenaKnockout,
  nowMs: number,
  playerRadius: number,
  reducedMotion: boolean,
): ArenaKnockoutFrame[] {
  const progress = clamp01((nowMs - knockout.startedAt) / KNOCKOUT_DURATION_MS);
  const diameter = playerRadius * 2;

  return knockout.victims.map(victim => {
    const immediate = reducedMotion || knockout.vanishOnly;
    const puffProgress = immediate
      ? progress
      : progress <= FALL_END ? 0 : (progress - FALL_END) / (1 - FALL_END);
    const puffRadius = reducedMotion
      ? diameter * PUFF_DIAMETERS
      : puffProgress === 0 ? 0 : diameter * PUFF_DIAMETERS * easeOut(puffProgress);
    const puffOpacity = immediate
      ? 1 - puffProgress
      : puffProgress === 0 ? 0 : 1 - puffProgress;

    // Reduced motion keeps the information — where the player left — and drops
    // the movement and scaling that the setting exists to prevent.
    if (immediate) {
      return {
        sessionId: victim.sessionId,
        x: victim.x,
        y: victim.y,
        scale: (reducedMotion || progress > 0) ? 0 : 1,
        puffRadius, puffOpacity,
      };
    }

    // The exit normal points outward from the arena centre. Coincident with the
    // centre is impossible for a knockout, but guard rather than divide by zero.
    const distance = Math.hypot(victim.x, victim.y) || 1;
    const normalX = victim.x / distance;
    const normalY = victim.y / distance;
    const speed = Math.hypot(victim.vx, victim.vy);
    const travel = diameter * CLEARANCE_DIAMETERS + speed * VELOCITY_TRAVEL;

    const slide = easeOut(clamp01(progress / SLIDE_END)) * travel;
    const fallProgress = progress <= SLIDE_END
      ? 0
      : clamp01((progress - SLIDE_END) / (FALL_END - SLIDE_END));
    const drift = fallProgress * diameter;

    return {
      sessionId: victim.sessionId,
      x: Math.round(victim.x + normalX * (slide + drift)),
      y: Math.round(victim.y + normalY * (slide + drift)),
      scale: 1 - fallProgress,
      puffRadius, puffOpacity,
    };
  });
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/components/Games/Arena/arenaKnockout.test.ts`
Expected: PASS, 8 tests. If an expected coordinate disagrees, re-derive it by hand — do not fit the expectation to the output.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaKnockout.ts src/Brmble.Web/src/components/Games/Arena/arenaKnockout.test.ts
git commit -m "feat: add the arena knockout animation sampler"
```

---

### Task 3: The knockout detector

Infers a knockout from a snapshot transition. The victim is the side whose score did **not** increase; on a double knockout both sides are victims and `consecutiveDoubleKos` increments.

Position and velocity come from the **previous** snapshot, because the next one has already respawned everyone.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaKnockout.ts`
- Test: `src/Brmble.Web/src/components/Games/Arena/arenaKnockout.test.ts`

**Interfaces:**
- Produces:

```ts
export function detectKnockout(
  previous: ArenaStateSnapshot | null,
  next: ArenaStateSnapshot,
  startedAt: number,
): ArenaKnockout | null;

export function vanishInPlace(
  state: ArenaStateSnapshot,
  sessionIds: readonly number[],
  startedAt: number,
): ArenaKnockout | null;
```

- [ ] **Step 1: Write the failing tests**

Append to `arenaKnockout.test.ts`. Build snapshot fixtures locally rather than importing another suite's helpers.

```ts
describe('detectKnockout', () => {
  const player = (sessionId: number, side: 0 | 1, x: number, vx = 0) => ({
    sessionId, side, x, y: 0, vx, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0,
    forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput: 0,
  });
  const snapshot = (
    phase: ArenaStateSnapshot['phase'], score: [number, number], doubleKos = 0,
  ): ArenaStateSnapshot => ({
    phase, phaseEndsAtTick: null, score, consecutiveDoubleKos: doubleKos,
    arena: { radius: 9000, shrinkPhase: 'normal' },
    players: [player(10, 0, 9000, 300), player(20, 1, -3000)],
    projectiles: [],
  });

  it('names the side that did not score as the victim', () => {
    const result = detectKnockout(snapshot('live', [0, 0]), snapshot('loading', [0, 1]), 5);
    expect(result?.victims.map(v => v.sessionId)).toEqual([10]);
    expect(result?.startedAt).toBe(5);
    expect(result?.vanishOnly).toBe(false);
  });

  it('takes position and velocity from before the respawn', () => {
    const result = detectKnockout(snapshot('live', [0, 0]), snapshot('loading', [0, 1]), 5);
    expect(result?.victims[0]).toMatchObject({ x: 9000, vx: 300 });
  });

  it('animates both players on a double knockout', () => {
    const result = detectKnockout(snapshot('live', [0, 0]), snapshot('loading', [0, 0], 1), 5);
    expect(result?.victims.map(v => v.sessionId)).toEqual([10, 20]);
  });

  it('detects the deciding knockout that ends the match', () => {
    const result = detectKnockout(snapshot('live', [1, 1]), snapshot('ended', [1, 2]), 5);
    expect(result?.victims.map(v => v.sessionId)).toEqual([10]);
  });

  it('ignores a phase change that scored nothing', () => {
    expect(detectKnockout(snapshot('loading', [0, 0]), snapshot('positioning', [0, 0]), 5)).toBeNull();
  });

  it('ignores the ordinary start of a round', () => {
    expect(detectKnockout(snapshot('positioning', [0, 0]), snapshot('live', [0, 0]), 5)).toBeNull();
  });

  it('returns null without a previous snapshot to read positions from', () => {
    expect(detectKnockout(null, snapshot('loading', [0, 1]), 5)).toBeNull();
  });
});

describe('vanishInPlace', () => {
  it('vanishes the named player where they stand', () => {
    const result = vanishInPlace(snapshot('ended', [1, 2]), [10], 5);
    expect(result?.vanishOnly).toBe(true);
    expect(result?.victims.map(v => v.sessionId)).toEqual([10]);
    expect(result?.victims[0]).toMatchObject({ x: 9000, y: 0 });
  });

  it('returns null when the named player is not in the state', () => {
    expect(vanishInPlace(snapshot('ended', [1, 2]), [999], 5)).toBeNull();
  });
});
```

Hoist the `player` and `snapshot` helpers above both `describe` blocks so they are shared.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/Games/Arena/arenaKnockout.test.ts -t detectKnockout`
Expected: FAIL — `detectKnockout` is not exported.

- [ ] **Step 3: Implement the detector**

```ts
const toVictim = (player: ArenaStateSnapshot['players'][number]): ArenaKnockoutVictim => ({
  sessionId: player.sessionId, x: player.x, y: player.y, vx: player.vx, vy: player.vy,
});

/**
 * A knockout is inferred, not reported: the server resets the round in the same
 * tick it detects the boundary crossing, so the out-of-bounds position never
 * reaches the wire. The score names the winner, so the other side is the victim,
 * and the previous snapshot still holds where they were and how fast.
 */
export function detectKnockout(
  previous: ArenaStateSnapshot | null,
  next: ArenaStateSnapshot,
  startedAt: number,
): ArenaKnockout | null {
  if (previous === null || previous.phase !== 'live') return null;
  if (next.phase !== 'loading' && next.phase !== 'ended') return null;

  const scored = next.score.findIndex((value, side) => value > previous.score[side]);
  const doubled = next.consecutiveDoubleKos > previous.consecutiveDoubleKos;
  if (scored === -1 && !doubled) return null;

  const victims = previous.players
    .filter(player => doubled || player.side !== scored)
    .map(toVictim);
  return victims.length === 0 ? null : { victims, startedAt, vanishOnly: false };
}

/** Forfeit and abandon: the player disappears where they stand. */
export function vanishInPlace(
  state: ArenaStateSnapshot,
  sessionIds: readonly number[],
  startedAt: number,
): ArenaKnockout | null {
  const victims = state.players
    .filter(player => sessionIds.includes(player.sessionId))
    .map(toVictim);
  return victims.length === 0 ? null : { victims, startedAt, vanishOnly: true };
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/components/Games/Arena/arenaKnockout.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the detector discriminates**

Temporarily make `detectKnockout` return `null` unconditionally and confirm the seven detector tests that expect a result fail, while the three null-expecting tests still pass. Restore. Record both outputs.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaKnockout.ts src/Brmble.Web/src/components/Games/Arena/arenaKnockout.test.ts
git commit -m "feat: infer arena knockouts from the snapshot transition"
```

---

### Task 4: Hold the knockout in the frame loop

`useArenaState` gains one ref and one frame field. Keep the footprint minimal: the reconciliation code in this hook is subtle and must not be disturbed.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts`
- Test: `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`

**Interfaces:**
- Consumes: `detectKnockout`, `sampleKnockout`, `KNOCKOUT_DURATION_MS` from `./arenaKnockout`.
- Produces: `ArenaRenderState` gains `knockout: ArenaKnockoutFrame[]` — empty when nothing is animating.

- [ ] **Step 1: Write the failing tests**

```tsx
  it('animates the losing player after a round is decided', () => { /* drive a live -> loading
    transition with a score change and assert the frame's knockout array names the loser */ });

  it('clears the knockout when it has run its course', () => { /* advance past
    KNOCKOUT_DURATION_MS and assert the knockout array is empty again */ });

  it('re-arms on a second knockout that lands mid-animation', () => { /* drive a second
    live -> loading transition before KNOCKOUT_DURATION_MS elapses and assert the frame
    follows the NEW victim from the new startedAt, rather than queueing or ignoring it */ });

  it('never lets the knockout reach prediction or the correction origin', () => { /* assert
    snapCount stays 0 across the knockout and the local player's predicted position is
    unaffected by the animation */ });
```

Author these three against the file's existing harness — `state.useReal`, the captured `frame` callback and the `atPhase` helper. Follow the fixture rules already documented in this suite: hoist `welcome()` to a stable identity, keep snapshot sequences above `welcome.snapshotSequence`, never drive a frame at `performance.now()` = 0, and drive both `Date.now()` and the `frameTime` argument coherently.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/Games/Arena/useArenaState.test.tsx -t knockout`
Expected: FAIL — `knockout` is not on the render frame.

- [ ] **Step 3: Wire it in**

Add the ref beside the other presentation refs:

```ts
  const knockoutRef = useRef<ArenaKnockout | null>(null);
```

Clear it wherever `renderedBaseRef` is cleared — the session-change effect and the `[welcome]` effect — so a new match never inherits an old animation.

In the frame loop, after `reconcile` has produced the new authority and **before** the frame is published, detect on authority change and expire on time:

```ts
        if (authorityChanged) {
          const detected = detectKnockout(previousAuthority, authority, frameTime);
          if (detected !== null) knockoutRef.current = detected;
        }
        if (knockoutRef.current !== null
          && frameTime - knockoutRef.current.startedAt > KNOCKOUT_DURATION_MS) {
          knockoutRef.current = null;
        }
        const knockout = knockoutRef.current === null
          ? []
          : sampleKnockout(knockoutRef.current, frameTime, welcome.prediction.playerRadius, reducedMotion);
```

`previousAuthority` is the snapshot the previous frame reconciled against; hold it in a ref alongside `knockoutRef` rather than deriving it, so the detector sees a true pair. Add `knockout` to `nextRendered`.

`reducedMotion` is not currently known to the hook — thread it in as an option from `ArenaBoard`, which already holds it in state.

- [ ] **Step 4: Run and watch them pass**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS. If any reconciliation test moves, stop — the knockout must not affect prediction.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaState.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx
git commit -m "feat: carry the arena knockout animation on the render frame"
```

---

### Task 5: Draw the fall

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts`
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx`
- Test: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts`

**Interfaces:**
- Consumes: `ArenaKnockoutFrame[]` from the render frame.
- Produces: `ArenaRenderView` gains `knockout: ArenaKnockoutFrame[]`.

- [ ] **Step 1: Write the failing tests**

```ts
  it('suppresses the falling player and draws them at the animated position instead', () => {
    const { renderer, calls } = setup();
    renderer.render(view({
      knockout: [{ sessionId: 10, x: 10200, y: 0, scale: 0.5, puffRadius: 0, puffOpacity: 0 }],
    }), { reducedMotion: false });
    // The victim's avatar clip arc is drawn at the animated point, not at its
    // authoritative position.
    const clips = calls.filter(call => call.op === 'arc');
    expect(clips.some(call => call.args[0] === 500 + 10200 * 0.03)).toBe(true);
  });

  it('leaves the surviving player untouched during a knockout', () => { /* assert the
    opponent's body arc is drawn at its authoritative position */ });

  it('draws the dust ring once the body has gone', () => { /* puffRadius > 0 and scale 0
    produces an arc of the puff radius and no body */ });
```

Author the second and third against the same harness as the first, asserting on recorded `arc` calls.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/Games/Arena/ArenaRenderer.test.ts -t knockout`
Expected: FAIL — `knockout` is not a property of `ArenaRenderView`.

- [ ] **Step 3: Implement**

Add `knockout: ArenaKnockoutFrame[]` to `ArenaRenderView`. In `render()`, build a lookup once:

```ts
    const falling = new Map(view.knockout.map(frame => [frame.sessionId, frame]));
```

In the player loop, pass the victim's frame to `drawPlayer` and, inside it, when a frame is present: draw at the animated position, multiply `playerRadius` by `frame.scale`, skip the name label, the aim stick, the charge stick and the rear marker, and skip the body entirely when `scale` is 0. Draw the dust ring when `puffOpacity > 0`, using `ctx.globalAlpha` restored afterwards.

`ArenaBoard` passes `current.knockout` into the render view alongside the existing fields.

- [ ] **Step 4: Run the full suite**

Run: `npm test --prefix src/Brmble.Web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx
git commit -m "feat: render the arena knockout fall and dust"
```

---

### Task 6: Vanish on forfeit and abandon

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx`
- Test: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.test.tsx`

**Interfaces:**
- Consumes: `vanishInPlace` from `./arenaKnockout`.

- [ ] **Step 1: Write the failing test**

```tsx
  it('vanishes the forfeiting player rather than freezing them in place', () => { /* render
    with a forfeited ended payload and assert the render frame carries a vanishOnly
    knockout naming the player who did not win */ });
```

The forfeiting player is the one who is **not** `ended.winnerId`. Recall from the outcome work that `winnerId` is a session id despite its name.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/components/Games/Arena/ArenaBoard.test.tsx -t forfeiting`
Expected: FAIL.

- [ ] **Step 3: Implement**

When the match ends forfeited or abandoned and `finalState` is available, call `vanishInPlace` with the losing session id and feed the result through the same render-frame path as a knockout.

- [ ] **Step 4: Run and commit**

```bash
npm test --prefix src/Brmble.Web
git add src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx src/Brmble.Web/src/components/Games/Arena/ArenaBoard.test.tsx
git commit -m "feat: vanish a forfeiting arena player instead of freezing them"
```

---

### Task 7: Full verification

- [ ] **Step 1:** `npm test --prefix src/Brmble.Web` — expect all green, and confirm the reconciliation, prediction and correction suites still run.
- [ ] **Step 2:** `npm run type-check --prefix src/Brmble.Web` — clean.
- [ ] **Step 3:** `npx eslint` on every changed file. The count must not rise above its pre-change baseline; verify by stashing rather than asserting.
- [ ] **Step 4:** `npm run build --prefix src/Brmble.Web` — succeeds.
- [ ] **Step 5:** `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj` — expect **no change whatsoever**, including determinism hashes. Any movement means server code was touched and must be reverted.
- [ ] **Step 6: Manual two-client check.** Build the frontend and run two Debug clients. Verify: a walk-off knockout clears the lip rather than falling half-in; a charged hit throws the loser markedly further; the arena floor reads as distinct from the void; both players animate on a double knockout; a forfeit vanishes rather than freezes; and with Windows animation effects disabled the mark still shows where the player left.
- [ ] **Step 7:** Report and ask before pushing.

---

## Notes for the implementer

- **The knockout is inferred, and that is deliberate.** The server resets the round in the same tick it detects the boundary crossing, so the out-of-bounds position is structurally unobservable. Do not try to add a wire field; the client validator is arity-strict and it would be a breaking protocol change. If the inferred position looks wrong in play, report it — the spec records the exact alternative.
- **Never write the animation back** into prediction or presentation state. The sampler is pure and its output is display-only.
- **Movement and dash do not touch velocity** — only recoil and projectile impulse do. That is why the slide needs a floor as well as a velocity term, and why a walk-off arrives with `vx = vy = 0`.
- **Reduced motion keeps the information.** Drop movement and scaling, never the fact that a knockout happened.
- The tuning constants in `arenaKnockout.ts` (`VELOCITY_TRAVEL`, `PUFF_DIAMETERS`, the stage boundaries) are presentation values with no server meaning. Expect to adjust them after seeing it move.
