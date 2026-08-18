import { ZONE_CITY_CATALOG } from './constants';
import type { Captain, Dealer, GameState, Zone, ZoneCityId, ZoneDealerSlot } from './types';

export const getZoneCity = (zoneId: ZoneCityId) => {
  const city = ZONE_CITY_CATALOG.find((item) => item.id === zoneId);
  if (!city) throw new Error(`Unknown Neon-D zone: ${zoneId}`);
  return city;
};

export const createZoneDealerSlots = (
  zoneId: ZoneCityId,
  count: number,
  dealers: readonly (Dealer | null)[] = [],
): ZoneDealerSlot[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${zoneId}-slot-${index}`,
    dealer: dealers[index] ?? null,
    reservedTransferId: null,
  }));

export const createAmsterdamZone = (
  captainId: string | null,
  dealerCapacity = 1,
  dealers: readonly (Dealer | null)[] = [],
): Zone => ({
  id: 'amsterdam',
  displayName: 'Amsterdam',
  captainId,
  dealerSlots: createZoneDealerSlots('amsterdam', dealerCapacity, dealers),
  perkIds: [],
});

export const getAssignedCaptainIds = (
  state: Pick<GameState, 'zones'>,
): Set<string> =>
  new Set(state.zones.flatMap((zone) => zone.captainId ? [zone.captainId] : []));

export const getUnassignedCaptains = (
  state: Pick<GameState, 'zones' | 'captains'>,
): Captain[] => {
  const assigned = getAssignedCaptainIds(state);
  return state.captains.filter((captain) => !assigned.has(captain.id));
};
