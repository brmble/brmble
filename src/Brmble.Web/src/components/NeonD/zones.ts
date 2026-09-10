import { ZONE_CITY_CATALOG } from './constants';
import type { Captain, Dealer, GameState, Zone, ZoneCityId, ZoneDealerSlot } from './types';
import { isCaptain, isDealer } from './sellers';

export type ActiveDealerEntry = {
  dealer: Dealer;
  zoneId: ZoneCityId | null;
  slotId: string | null;
};

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

export const getTotalDealerCapacity = (
  state: Pick<GameState, 'activeDealers' | 'zones'>,
) => state.zones.length === 0
  ? state.activeDealers.length
  : state.zones.reduce((sum, zone) => sum + zone.dealerSlots.length, 0);

export const getAvailableZoneDealerSlots = (
  state: Pick<GameState, 'zones'>,
) => state.zones.flatMap((zone) =>
  zone.dealerSlots.flatMap((slot) =>
    slot.dealer === null && slot.reservedTransferId === null
      ? [{ zoneId: zone.id, slotId: slot.id }]
      : [],
  ),
);

export const getActiveDealerEntries = (
  state: Pick<GameState, 'activeDealers' | 'zones'>,
): ActiveDealerEntry[] => {
  if (state.zones.length === 0) {
    return state.activeDealers.flatMap((seller, slotIndex) =>
      isDealer(seller)
        ? [{ dealer: seller, zoneId: null, slotId: `legacy-${slotIndex}` }]
        : [],
    );
  }

  return state.zones.flatMap((zone) =>
    zone.dealerSlots.flatMap((slot) =>
      slot.dealer
        ? [{ dealer: slot.dealer, zoneId: zone.id, slotId: slot.id }]
        : [],
    ),
  );
};

export const getActiveCaptainEntries = (
  state: Pick<GameState, 'captains' | 'zones'> & Partial<Pick<GameState, 'activeDealers'>>,
) => {
  if (state.zones.length === 0) {
    return (state.activeDealers ?? []).flatMap((seller) => {
      if (!isCaptain(seller)) return [];
      const captain = state.captains.find((candidate) => candidate.id === seller.id) ?? seller;
      return [{ captain, zoneId: null }];
    });
  }

  return state.zones.flatMap((zone) => {
    if (!zone.captainId) return [];
    const captain = state.captains.find((candidate) => candidate.id === zone.captainId);
    return captain ? [{ captain, zoneId: zone.id }] : [];
  });
};

export const getZoneEarningsPerSecond = (
  state: Pick<GameState, 'zones' | 'captains' | 'lastEarningsPerSeller'>,
  zoneId: ZoneCityId,
): number => {
  const zone = state.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return 0;

  const sellerIds = [
    ...(zone.captainId ? [zone.captainId] : []),
    ...zone.dealerSlots.flatMap((slot) => slot.dealer ? [slot.dealer.id] : []),
  ];

  return sellerIds.reduce(
    (sum, sellerId) => sum + (state.lastEarningsPerSeller[sellerId] ?? 0),
    0,
  );
};

export const findActiveDealer = (
  state: Pick<GameState, 'activeDealers' | 'zones'>,
  dealerId: string,
): Dealer | null =>
  getActiveDealerEntries(state).find((entry) => entry.dealer.id === dealerId)?.dealer ?? null;

export const updateActiveDealer = (
  state: Pick<GameState, 'activeDealers' | 'zones'>,
  dealerId: string,
  updater: (dealer: Dealer) => Dealer,
): Pick<GameState, 'activeDealers' | 'zones'> => {
  if (state.zones.length === 0) {
    return {
      activeDealers: state.activeDealers.map((seller) =>
        isDealer(seller) && seller.id === dealerId ? updater(seller) : seller,
      ),
      zones: state.zones,
    };
  }

  return {
    activeDealers: state.activeDealers,
    zones: state.zones.map((zone) => {
      const dealerSlots = zone.dealerSlots.map((slot) =>
        slot.dealer?.id === dealerId ? { ...slot, dealer: updater(slot.dealer) } : slot,
      );
      return dealerSlots.some((slot, index) => slot !== zone.dealerSlots[index])
        ? { ...zone, dealerSlots }
        : zone;
    }),
  };
};

export const removeActiveDealer = (
  state: Pick<GameState, 'activeDealers' | 'zones'>,
  dealerId: string,
): Pick<GameState, 'activeDealers' | 'zones'> => {
  if (state.zones.length === 0) {
    return {
      activeDealers: state.activeDealers.map((seller) =>
        isDealer(seller) && seller.id === dealerId ? null : seller,
      ),
      zones: state.zones,
    };
  }

  return {
    activeDealers: state.activeDealers,
    zones: state.zones.map((zone) => {
      const dealerSlots = zone.dealerSlots.map((slot) =>
        slot.dealer?.id === dealerId ? { ...slot, dealer: null } : slot,
      );
      return dealerSlots.some((slot, index) => slot !== zone.dealerSlots[index])
        ? { ...zone, dealerSlots }
        : zone;
    }),
  };
};
