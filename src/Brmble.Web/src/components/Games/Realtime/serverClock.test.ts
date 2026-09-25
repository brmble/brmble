import { describe, expect, it } from 'vitest';
import { createServerClock, DEFAULT_SAMPLE_WINDOW } from './serverClock';

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
