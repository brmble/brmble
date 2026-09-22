import { describe, expect, it } from 'vitest';
import type { ArenaInputState, ArenaPredictionConstants } from './arenaProtocol';
import { runLatencyScenario, type LatencyScenarioOptions, type LatencyScenarioResult } from './arenaLatencyHarness';

const prediction: ArenaPredictionConstants = {
  unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
  momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30, forcedFireTicks: 30,
  shotCooldownTicks: 24, projectileRadius: 180, projectilePerTick: 240,
  projectileBaseKnockback: 130, projectileBonusKnockback: 220, recoilBase: 45,
  recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
};

const right: ArenaInputState = { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false };
const still: ArenaInputState = { ...right, moveX: 0 };

/** Press right at tick 30, release at tick 120. */
const pressAndRelease = [
  { atClientTick: 30, input: right },
  { atClientTick: 120, input: still },
];

const latencies: Array<[number, number]> = [[0, 0], [3, 3], [6, 6], [12, 12]];

function run(overrides: Partial<LatencyScenarioOptions> & { upTicks: number; downTicks: number }): LatencyScenarioResult {
  return runLatencyScenario({
    script: pressAndRelease, durationTicks: 200, constants: prediction, ...overrides,
  });
}

function summarise(label: string, results: Array<[[number, number], LatencyScenarioResult]>): string {
  const rows = results.map(([[up, down], result]) =>
    `  (${up},${down})  snaps=${result.snapCount}  maxCorrection=${result.maxCorrection.toFixed(0)}`
    + `  pullbacks=${result.pullbackCount}  ticksUntilFirstMovement=${result.ticksUntilFirstMovement}`);
  return [label, ...rows].join('\n');
}

describe('arena latency harness', () => {
  it('completes a press-and-release at every latency and reports finite totals', () => {
    for (const [upTicks, downTicks] of latencies) {
      const result = run({ upTicks, downTicks });
      expect(result.ticks).toHaveLength(200);
      expect(Number.isFinite(result.maxCorrection)).toBe(true);
      expect(Number.isFinite(result.snapCount)).toBe(true);
      // The server moved the player: authority is not stuck.
      expect(result.ticks[199].authorityX).toBeGreaterThan(0);
    }
  });

  it('at zero latency today\'s client neither snaps nor corrects by more than one tick of movement', () => {
    const result = run({ upTicks: 0, downTicks: 0 });
    expect(result.snapCount).toBe(0);
    expect(result.maxCorrection).toBeLessThanOrEqual(prediction.baseMovePerTick);
  });

  it('installs on arrival today and at the stamp under scheduling', () => {
    const onArrival = run({ upTicks: 6, downTicks: 6, application: 'onArrival' });
    const pressFrame = Number(Object.entries(onArrival.sentAtBySequence).find(([, tick]) => tick === 30)![0]);
    expect(onArrival.installedAtBySequence[pressFrame]).toBe(30 + 6);

    const atStamp = run({ upTicks: 6, downTicks: 6, application: 'atStamp', leadTicks: 14 });
    // Stamped S_last + elapsed + 14, which is ahead of arrival, so it waits for its tick.
    expect(atStamp.installedAtBySequence[pressFrame]).toBeGreaterThan(30 + 6);
  });

  // ---- Phase B: baseline numbers. These log rather than assert; the assertions on
  // them live in the Phase C block below once the design is implemented.
  it('records the baseline for today\'s client (onArrival, byAck, lead 0)', () => {
    const results = latencies.map(latency => [latency, run({ upTicks: latency[0], downTicks: latency[1] })] as [[number, number], LatencyScenarioResult]);
    console.log(summarise('BASELINE today (onArrival, byAck, lead 0):', results));
    // The mechanism the spec describes: with latency, the display is pulled back on
    // snapshots for roughly the round trip after the press.
    const [, laggy] = results[2];
    expect(laggy.pullbackCount).toBeGreaterThan(0);
    expect(laggy.ticksUntilFirstMovement).toBeGreaterThanOrEqual(6);
  });

  it('records the previous plan\'s half-RTT proposal (onArrival, byAck, lead RTT/2)', () => {
    const results = latencies.map(latency => [latency, run({
      upTicks: latency[0], downTicks: latency[1], leadTicks: Math.round((latency[0] + latency[1]) / 2),
    })] as [[number, number], LatencyScenarioResult]);
    console.log(summarise('HALF-RTT proposal (onArrival, byAck, lead RTT/2):', results));
    // Moving the stamp without changing when the server applies the input turns the
    // pullbacks into snaps from a 100 ms round trip upward.
    expect(results[1][1].snapCount).toBeGreaterThan(0);
    expect(results[3][1].snapCount).toBeGreaterThan(results[1][1].snapCount);
  });
});

/**
 * The input-scheduling design: the server applies each input at its stamped tick,
 * the client stamps `S_last + elapsed + lead` with the lead covering the round trip
 * plus a two-tick margin, prunes pending by tick and replays the newest interval
 * through its local tick.
 */
describe('arena latency harness under input scheduling', () => {
  const scheduled = (overrides: Partial<LatencyScenarioOptions> & { upTicks: number; downTicks: number }) => run({
    application: 'atStamp', pruning: 'byTick', replayThroughCurrentTick: true,
    leadTicks: overrides.upTicks + overrides.downTicks + 2, ...overrides,
  });

  it('starts movement on the press with no snap and at most one tick of correction at every latency', () => {
    const results = latencies.map(latency => [latency, scheduled({ upTicks: latency[0], downTicks: latency[1] })] as [[number, number], LatencyScenarioResult]);
    console.log(summarise('SCHEDULED (atStamp, byTick, lead RTT + 2, replay through local tick):', results));
    for (const [[up, down], result] of results) {
      expect(result.snapCount, `snaps at (${up},${down})`).toBe(0);
      // One tick of base movement is the harness's own quantisation (the max(1, elapsed)
      // in the stamp against a tick-aligned server), not a prediction error.
      expect(result.maxCorrection, `correction at (${up},${down})`).toBeLessThanOrEqual(prediction.baseMovePerTick);
      expect(result.pullbackCount, `pullbacks at (${up},${down})`).toBe(0);
      expect(result.ticksUntilFirstMovement, `first movement at (${up},${down})`).toBe(0);
    }
  });

  it('absorbs a frame that arrives past the margin with a small correction and no snap', () => {
    const reference = scheduled({ upTicks: 6, downTicks: 6 });
    const pressFrame = Number(Object.entries(reference.sentAtBySequence).find(([, tick]) => tick === 30)![0]);
    // Margin is 2 ticks; 5 ticks of jitter on the press frame lands it 3 ticks late,
    // so the server applies it on arrival, three ticks after the client predicted.
    const late = scheduled({ upTicks: 6, downTicks: 6, uplinkJitterBySequence: { [pressFrame]: 5 } });
    expect(late.installedAtBySequence[pressFrame]).toBe(reference.installedAtBySequence[pressFrame] + 3);
    expect(late.snapCount).toBe(0);
    expect(late.maxCorrection).toBeLessThanOrEqual(3 * prediction.baseMovePerTick);
    // Fully absorbed: the display is monotone again well within two snapshots.
    expect(late.ticksUntilFirstMovement).toBeLessThanOrEqual(3 + 2 * 3 + 6 + 6);

    // Jitter inside the margin costs nothing.
    const inside = scheduled({ upTicks: 6, downTicks: 6, uplinkJitterBySequence: { [pressFrame]: 2 } });
    expect(inside.snapCount).toBe(0);
    expect(inside.pullbackCount).toBe(0);
  });

  it('degrades to a bounded correction, not a snap, when the lead runs away', () => {
    // A lead far past the round trip: the server clamps the stamp to arrival + 40 and
    // applies it then; the client predicted earlier, so the display runs ahead by the
    // clamped-off ticks and the correction stays bounded. Strictly worse than the right
    // lead, and the reason the client caps its own lead below the server clamp.
    const runaway = scheduled({ upTicks: 3, downTicks: 3, leadTicks: 50 });
    expect(runaway.snapCount).toBe(0);
    expect(runaway.maxCorrection).toBeLessThanOrEqual(3 * prediction.baseMovePerTick);
    expect(runaway.maxCorrection).toBeGreaterThan(scheduled({ upTicks: 3, downTicks: 3 }).maxCorrection);
  });

  it('degrades towards today\'s behaviour, not worse, when the lead is too small', () => {
    // Lead 8 against a 12-tick round trip: inputs arrive four ticks late and apply on
    // arrival, so the press shows the pullbacks the baseline shows - for the missing
    // four ticks rather than the whole round trip.
    const small = scheduled({ upTicks: 6, downTicks: 6, leadTicks: 8 });
    const today = run({ upTicks: 6, downTicks: 6 });
    expect(small.snapCount).toBe(0);
    expect(small.maxCorrection).toBeLessThanOrEqual(today.maxCorrection);
    expect(small.pullbackCount).toBeLessThanOrEqual(today.pullbackCount);
  });

  it('stops on the release without a pullback and lets authority catch up', () => {
    const result = scheduled({ upTicks: 6, downTicks: 6 });
    const afterRelease = result.ticks.filter(record => record.tick >= 121 && record.tick <= 140);
    const displayed = new Set(afterRelease.map(record => record.displayedX));
    expect(displayed.size).toBe(1);
    expect(afterRelease.at(-1)!.authorityX).toBe(afterRelease.at(-1)!.displayedX);
  });
});
