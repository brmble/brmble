import { describe, expect, it } from 'vitest';
import { createServerClock, DEFAULT_SAMPLE_WINDOW } from './serverClock';
import { sampleTimeline } from './arenaMath';
import type { ArenaSnapshot } from './arenaProtocol';

describe('createServerClock', () => {
  it('is the identity before any sample, and says so', () => {
    const clock = createServerClock();
    expect(clock.calibrated).toBe(false);
    expect(clock.offsetMs).toBe(0);
    expect(clock.now(5_000)).toBe(5_000);
  });

  it('takes the offset from a single sample', () => {
    const clock = createServerClock();
    clock.observe(1_400, 1_000);
    expect(clock.calibrated).toBe(true);
    expect(clock.offsetMs).toBe(400);
    expect(clock.now(1_000)).toBe(1_400);
  });

  it('keeps the largest sample, because that is the one with the least latency', () => {
    const clock = createServerClock();
    // True offset is +400. Each sample is understated by its one-way latency.
    clock.observe(1_000 + 400 - 90, 1_000); // 90 ms of latency
    clock.observe(2_000 + 400 - 12, 2_000); // 12 ms — the fastest packet
    clock.observe(3_000 + 400 - 55, 3_000); // 55 ms
    expect(clock.offsetMs).toBe(388);
    // A mean would land near 348 and bake the average latency into every frame.
    expect(clock.offsetMs).toBeGreaterThan(348);
  });

  it('never lets a late sample drag the estimate down', () => {
    const clock = createServerClock();
    clock.observe(1_400, 1_000);
    clock.observe(2_100, 2_000); // 300 ms of queuing delay
    expect(clock.offsetMs).toBe(400);
  });

  it('drops samples out of the window so one lucky packet cannot latch forever', () => {
    const clock = createServerClock(3);
    clock.observe(1_000 + 900, 1_000); // wildly early outlier
    expect(clock.offsetMs).toBe(900);
    clock.observe(2_400, 2_000);
    clock.observe(3_400, 3_000);
    expect(clock.offsetMs).toBe(900); // still in the window
    clock.observe(4_400, 4_000); // pushes the outlier out
    expect(clock.offsetMs).toBe(400);
  });

  it('recovers from a clock step within one window', () => {
    const clock = createServerClock(4);
    for (let i = 0; i < 4; i++) clock.observe(1_000 * i + 400, 1_000 * i);
    expect(clock.offsetMs).toBe(400);
    // The client's clock jumps forward 5 s (an NTP correction, a laptop waking),
    // so every sample from here on reads 5 s lower.
    for (let i = 4; i < 8; i++) clock.observe(1_000 * i + 400, 1_000 * i + 5_000);
    expect(clock.offsetMs).toBe(-4_600);
  });

  it('ignores non-finite samples rather than poisoning the estimate', () => {
    const clock = createServerClock();
    clock.observe(1_400, 1_000);
    clock.observe(Number.NaN, 2_000);
    clock.observe(3_000, Number.POSITIVE_INFINITY);
    expect(clock.offsetMs).toBe(400);
  });

  it('refuses a nonsensical window', () => {
    expect(() => createServerClock(0)).toThrow(RangeError);
    expect(() => createServerClock(-1)).toThrow(RangeError);
    expect(() => createServerClock(2.5)).toThrow(RangeError);
    expect(DEFAULT_SAMPLE_WINDOW).toBe(40);
  });
});

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
