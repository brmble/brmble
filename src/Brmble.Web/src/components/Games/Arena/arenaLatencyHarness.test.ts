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
    expect(results.every(([, result]) => Number.isFinite(result.maxCorrection))).toBe(true);
  });
});
