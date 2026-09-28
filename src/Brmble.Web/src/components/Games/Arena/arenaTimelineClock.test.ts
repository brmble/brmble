import { describe, expect, it } from 'vitest';
import { createServerClock } from '../Realtime/serverClock';
import { sampleTimeline } from './arenaMath';
import type { ArenaSnapshot } from './arenaProtocol';

/**
 * The arena's timeline sampled through the generic server clock. Lives here rather than
 * next to `serverClock.test.ts`: the realtime folder may not import from a game folder,
 * and that holds for its tests too.
 */
describe('sampling the timeline through the server clock', () => {
  // Snapshots 50 ms apart on the SERVER's clock, opponent walking 500 u per frame.
  const SERVER_NOW = 1_800_000_000_000;
  const frames: ArenaSnapshot[] = Array.from({ length: 20 }, (_, index) => ({
    type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: index,
    serverTick: 1_000 + index * 3, generatedAtUnixMs: SERVER_NOW - (19 - index) * 50,
    phase: 'live', phaseEndsAtTick: null, score: [0, 0], consecutiveDoubleKos: 0,
    arena: { radius: 9_000, shrinkPhase: 'hold' },
    players: [{
      sessionId: 20, side: 1, x: index * 500, y: 0, vx: 0, vy: 0, aimX: 32_767, aimY: 0,
      chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0,
      acknowledgedInput: 0,
    }],
    projectiles: [],
  }));

  const drawnAt = (clientNowMs: number, offsetMs: number) => {
    const clock = createServerClock();
    // One sample with zero latency states the offset exactly.
    clock.observe(clientNowMs + offsetMs, clientNowMs);
    return sampleTimeline(frames, clock.now(clientNowMs), 100, 50).players[0].x;
  };

  // In sync, a 100 ms buffer is two 50 ms frames back from the newest (x = 9500).
  const inSync = drawnAt(SERVER_NOW, 0);

  it('renders the same frame no matter how far the client clock is off', () => {
    expect(inSync).toBe(8_500);
    for (const skew of [-2_000, -400, -150, 0, 150, 400, 2_000]) {
      // A client whose clock is `skew` ahead of the server's sees the same instant.
      expect(drawnAt(SERVER_NOW - skew, skew)).toBe(inSync);
    }
  });

  it('is what an uncorrected Date.now() gets wrong', () => {
    // The pre-fix behaviour: the raw client clock passed straight to sampleTimeline.
    const uncorrected = (clientNowMs: number) => sampleTimeline(frames, clientNowMs, 100, 50).players[0].x;
    expect(uncorrected(SERVER_NOW - 400)).toBe(4_500);   // 4_000 u into the past
    expect(uncorrected(SERVER_NOW + 400)).toBe(9_500);   // pinned to newest, stutters
  });
});
