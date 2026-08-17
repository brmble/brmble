import type { ActiveSeller, Captain, Dealer } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isCaptain = (value: ActiveSeller | null): value is Captain =>
  isRecord(value)
  && 'talentPoints' in value
  && 'talentRanks' in value
  && 'ledgerUnlocked' in value;

export const isDealer = (value: ActiveSeller | null): value is Dealer =>
  isRecord(value)
  && !isCaptain(value as ActiveSeller)
  && 'volumeMultiplier' in value
  && 'marginMultiplier' in value
  && 'isArrested' in value;

export const getAssignedCaptainIds = (slots: (ActiveSeller | null)[]): Set<string> =>
  new Set(slots.flatMap((seller) => (isCaptain(seller) ? [seller.id] : [])));

export const syncAssignedCaptainSlots = (
  slots: (ActiveSeller | null)[],
  captains: Captain[],
): (ActiveSeller | null)[] => slots.map((seller) => {
  if (!isCaptain(seller)) return seller;
  return captains.find((captain) => captain.id === seller.id) ?? seller;
});
