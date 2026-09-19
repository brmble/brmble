import { describe, expect, it } from 'vitest';
import { createInputLead } from './inputLead';

describe('inputLead', () => {
  it('starts at the minimum before any sample and reports no round trip', () => {
    const lead = createInputLead({ tickRate: 60 });
    expect(lead.leadTicks(0)).toBe(3);
    expect(lead.rttMs).toBeNull();
    expect(lead.targetTicks).toBe(3);
  });

  it('takes a low percentile of the window, not the mean', () => {
    const lead = createInputLead({ tickRate: 60, slewMs: 0 });
    // Nine samples at 100 ms and one spike at 900 ms: the mean is 180, the 20th
    // percentile is 100.
    for (let index = 0; index < 9; index++) lead.sample(100, index);
    lead.sample(900, 9);
    expect(lead.rttMs).toBe(100);
    // ceil(100 ms * 60 / 1000) = 6, plus the 2-tick margin.
    expect(lead.targetTicks).toBe(8);
  });

  it('does not move on a single outlier', () => {
    const lead = createInputLead({ tickRate: 60, slewMs: 0 });
    for (let index = 0; index < 20; index++) lead.sample(50, index);
    const before = lead.targetTicks;
    lead.sample(2000, 20);
    expect(lead.targetTicks).toBe(before);
  });

  it('slews no faster than one tick per slew interval in either direction', () => {
    const lead = createInputLead({ tickRate: 60, slewMs: 500 });
    lead.sample(200, 0); // target ceil(12) + 2 = 14
    expect(lead.targetTicks).toBe(14);
    expect(lead.leadTicks(0)).toBe(4);
    expect(lead.leadTicks(100)).toBe(4);
    expect(lead.leadTicks(500)).toBe(5);
    expect(lead.leadTicks(999)).toBe(5);
    expect(lead.leadTicks(1000)).toBe(6);

    for (let index = 0; index < 40; index++) lead.sample(0, 1000 + index);
    expect(lead.targetTicks).toBe(3);
    expect(lead.leadTicks(1400)).toBe(6);
    expect(lead.leadTicks(1500)).toBe(5);
  });

  it('clamps the target to the configured range', () => {
    const lead = createInputLead({ tickRate: 60, slewMs: 0, minTicks: 3, maxTicks: 20 });
    lead.sample(5000, 0);
    expect(lead.targetTicks).toBe(20);
    const low = createInputLead({ tickRate: 60, slewMs: 0 });
    low.sample(0, 0);
    expect(low.targetTicks).toBe(3);
  });

  it('ages samples out of the window so a recovered network lowers the lead', () => {
    const lead = createInputLead({ tickRate: 60, slewMs: 0, windowSize: 10 });
    for (let index = 0; index < 10; index++) lead.sample(300, index);
    expect(lead.targetTicks).toBe(20);
    for (let index = 0; index < 10; index++) lead.sample(30, 10 + index);
    expect(lead.rttMs).toBe(30);
    expect(lead.targetTicks).toBe(4);
  });

  it('ignores non-finite or negative samples', () => {
    const lead = createInputLead({ tickRate: 60 });
    lead.sample(Number.NaN, 0);
    lead.sample(-5, 1);
    lead.sample(Number.POSITIVE_INFINITY, 2);
    expect(lead.sampleCount).toBe(0);
  });
});
