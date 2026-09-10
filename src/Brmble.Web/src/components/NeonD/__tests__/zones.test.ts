import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import { createAmsterdamZone, createZoneDealerSlots, getZoneEarningsPerSecond } from '../zones';
import { makeReferenceCaptain } from './testFixtures';
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

  it('aggregates exact visible seller earnings and excludes missing or travelling dealers', () => {
    const state = createBaseGameState(0);
    const captain = makeReferenceCaptain({ id: 'captain-1' });
    const dealer = makeReferenceDealer({ id: 'dealer-1' });
    const travellingDealer = makeReferenceDealer({ id: 'dealer-travelling' });
    state.captains = [captain];
    state.zones = [{
      ...createAmsterdamZone(captain.id, 2, [dealer]),
      dealerSlots: [
        { id: 'amsterdam-slot-0', dealer, reservedTransferId: null },
        { id: 'amsterdam-slot-1', dealer: null, reservedTransferId: 'transfer-1' },
      ],
    }];
    state.dealerTransfers = [{
      id: 'transfer-1',
      dealer: travellingDealer,
      sourceZoneId: 'paris',
      sourceSlotId: 'paris-slot-0',
      destinationZoneId: 'amsterdam',
      destinationSlotId: 'amsterdam-slot-1',
      completesAt: 120_000,
      riskResolved: false,
    }];
    state.lastEarningsPerSeller = {
      'captain-1': 11,
      'dealer-1': 7.5,
      'dealer-travelling': 99,
      'missing-dealer': 500,
    };

    expect(getZoneEarningsPerSecond(state, 'amsterdam')).toBe(18.5);
    expect(getZoneEarningsPerSecond(state, 'paris')).toBe(0);
  });
});
