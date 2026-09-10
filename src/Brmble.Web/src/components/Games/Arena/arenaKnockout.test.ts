import { describe, expect, it } from 'vitest';
import { detectKnockout, sampleKnockout, vanishInPlace, type ArenaKnockout } from './arenaKnockout';
import type { ArenaStateSnapshot } from './arenaProtocol';

const victim = (overrides: Partial<ArenaKnockout['victims'][number]> = {}) => ({
  sessionId: 10, x: 9000, y: 0, vx: 0, vy: 0, ...overrides,
});
const knockout = (overrides: Partial<ArenaKnockout> = {}): ArenaKnockout => ({
  victims: [victim()], startedAt: 1000, vanishOnly: false, ...overrides,
});

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

describe('detectKnockout', () => {
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

  // The three guards run in order — previous phase, next phase, then score —
  // and each one shadows the ones after it. A test only pins the guard that
  // actually rejects it, so each of the three below is shaped to fall through
  // every earlier guard and be stopped by exactly one.

  // Falls through the previous-phase guard (live) and the next-phase guard
  // (loading), so only the score check can reject it.
  it('ignores a round ending that neither scored nor counted a double knockout', () => {
    expect(detectKnockout(snapshot('live', [0, 0]), snapshot('loading', [0, 0]), 5)).toBeNull();
  });

  // Scored, so it clears the score check, and lands in loading, so it clears
  // the next-phase guard: only the previous-phase guard rejects it. The two
  // `ignores` cases further up are also stopped here, but they would fall
  // through to the next-phase guard if it were removed, so they do not pin it.
  it('ignores a scored transition that did not come from a live round', () => {
    expect(detectKnockout(snapshot('positioning', [0, 0]), snapshot('loading', [0, 1]), 5)).toBeNull();
  });

  // Scored and out of a live round, so only the next-phase guard rejects it.
  // `ResolveRound` moves a scoring round to Loading or Ended and nowhere else,
  // so this transition cannot occur on the wire today; the test defends the
  // guard against a future server change rather than catching a live bug.
  it('ignores a scored round that did not reset or end', () => {
    expect(detectKnockout(snapshot('live', [0, 0]), snapshot('positioning', [0, 1]), 5)).toBeNull();
  });

  // `ResolveRound` zeroes `consecutiveDoubleKos` on an ordinary knockout, so a
  // double-KO round followed by an ordinary one counts *down*. Only a strict
  // increase means a double knockout; equality-or-difference would animate a
  // spurious two-victim knockout here.
  it('names a single victim when an ordinary knockout resets the double knockout streak', () => {
    const result = detectKnockout(snapshot('live', [0, 0], 1), snapshot('loading', [0, 1], 0), 5);
    expect(result?.victims.map(v => v.sessionId)).toEqual([10]);
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
