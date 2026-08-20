import { describe, expect, it } from 'vitest';
import { isCaptain, isDealer } from '../sellers';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';
import { createAmsterdamZone, getActiveCaptainEntries, getActiveDealerEntries } from '../zones';

describe('seller slot helpers', () => {
  it('identifies sellers by their structural fields rather than display names', () => {
    const captain = makeReferenceCaptain({ name: 'Dealer-shaped name' });
    const dealer = makeReferenceDealer({ name: 'Captain-shaped name' });

    expect(isCaptain(captain)).toBe(true);
    expect(isCaptain(dealer)).toBe(false);
    expect(isDealer(dealer)).toBe(true);
    expect(isDealer(captain)).toBe(false);
  });

  it('rejects null slots for either seller kind', () => {
    expect(isCaptain(null)).toBe(false);
    expect(isDealer(null)).toBe(false);
  });

  it('derives active dealers from zone slots once zones are present', () => {
    const dealer = makeReferenceDealer({ id: 'dealer-1' });

    expect(getActiveDealerEntries({
      activeDealers: [makeReferenceDealer({ id: 'legacy-dealer' })],
      zones: [{
        ...createAmsterdamZone(null),
        dealerSlots: [{ id: 'amsterdam-slot-0', dealer, reservedTransferId: null }],
      }],
    })).toEqual([{ dealer, zoneId: 'amsterdam', slotId: 'amsterdam-slot-0' }]);
  });

  it('does not treat an unassigned Captain as active', () => {
    const assignedCaptain = makeReferenceCaptain({ id: 'captain-assigned' });
    const unassignedCaptain = makeReferenceCaptain({ id: 'captain-unassigned' });

    expect(getActiveCaptainEntries({
      captains: [assignedCaptain, unassignedCaptain],
      zones: [createAmsterdamZone(assignedCaptain.id)],
    })).toEqual([{ captain: assignedCaptain, zoneId: 'amsterdam' }]);
  });
});
