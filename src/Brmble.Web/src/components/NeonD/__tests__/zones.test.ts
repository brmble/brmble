import { describe, expect, it } from 'vitest';
import { createAmsterdamZone, createZoneDealerSlots } from '../zones';
import { makeReferenceDealer } from './testFixtures';

describe('zones', () => {
  it('creates stable append-only dealer slot ids', () => {
    expect(createZoneDealerSlots('amsterdam', 3).map((slot) => slot.id)).toEqual([
      'amsterdam-slot-0',
      'amsterdam-slot-1',
      'amsterdam-slot-2',
    ]);
  });

  it('keeps the Captain position separate from dealer capacity', () => {
    const zone = createAmsterdamZone('captain-1', 1, [makeReferenceDealer({ id: 'dealer-1' })]);

    expect(zone.captainId).toBe('captain-1');
    expect(zone.dealerSlots).toHaveLength(1);
    expect(zone.dealerSlots[0].dealer?.id).toBe('dealer-1');
  });
});
