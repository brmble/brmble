import type { Captain, Dealer } from '../types';

export const makeReferenceDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'test-dealer',
  name: 'Test Dealer',
  selling: 'weed',
  volumeMultiplier: 1,
  marginMultiplier: 1,
  equipmentIds: [],
  isProtected: false,
  isArrested: false,
  earningsPerSecondAtArrest: 0,
  ...overrides,
});

export const makeReferenceCaptain = (overrides: Partial<Captain> = {}): Captain => ({
  id: 'test-captain',
  name: 'Test Captain',
  selling: 'weed',
  equipmentIds: [],
  personalEarnings: 0,
  ...overrides,
});
