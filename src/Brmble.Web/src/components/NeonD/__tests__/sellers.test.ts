import { describe, expect, it } from 'vitest';
import { isCaptain, isDealer, getAssignedCaptainIds } from '../sellers';
import type { ActiveSeller } from '../types';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';

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

  it('derives unique assigned Captain ids from nullable slots', () => {
    const captain = makeReferenceCaptain({ id: 'captain-1' });
    const slots: (ActiveSeller | null)[] = [captain, null, { ...captain }, makeReferenceDealer()];

    expect(getAssignedCaptainIds(slots)).toEqual(new Set(['captain-1']));
  });
});
