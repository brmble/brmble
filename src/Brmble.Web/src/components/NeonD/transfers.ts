import {
  DEALER_TRANSFER_DURATION_MS,
  DEALER_TRANSFER_EQUIPMENT_LOSS_CHANCE,
} from './constants';
import type {
  Dealer,
  DealerTransfer,
  GameState,
  Zone,
  ZoneCityId,
  ZoneDealerSlot,
} from './types';
import { getActiveDealerEntries } from './zones';

const findZoneSlot = (
  zones: Zone[],
  zoneId: ZoneCityId,
  slotId: string,
): { zone: Zone; slot: ZoneDealerSlot } | null => {
  const zone = zones.find((candidate) => candidate.id === zoneId);
  if (!zone) return null;

  const slot = zone.dealerSlots.find((candidate) => candidate.id === slotId);
  return slot ? { zone, slot } : null;
};

const updateTransferSlots = (
  zones: Zone[],
  transfer: DealerTransfer,
  destinationDealer: Dealer | null,
): Zone[] => zones.map((zone) => {
  if (zone.id !== transfer.sourceZoneId && zone.id !== transfer.destinationZoneId) return zone;

  return {
    ...zone,
    dealerSlots: zone.dealerSlots.map((slot) => {
      if (zone.id === transfer.sourceZoneId && slot.id === transfer.sourceSlotId) {
        return {
          ...slot,
          dealer: null,
          reservedTransferId: destinationDealer ? null : transfer.id,
        };
      }

      if (zone.id === transfer.destinationZoneId && slot.id === transfer.destinationSlotId) {
        return {
          ...slot,
          dealer: destinationDealer,
          reservedTransferId: destinationDealer ? null : transfer.id,
        };
      }

      return slot;
    }),
  };
});

const resolveEquipmentRisk = (
  dealer: Dealer,
  rng: () => number,
): Dealer => ({
  ...dealer,
  equipmentIds: dealer.equipmentIds.filter(
    () => rng() >= DEALER_TRANSFER_EQUIPMENT_LOSS_CHANCE,
  ),
});

export const getOutgoingTransfers = (
  state: Pick<GameState, 'dealerTransfers'>,
  zoneId: ZoneCityId,
) => state.dealerTransfers.filter((transfer) => transfer.sourceZoneId === zoneId);

export const getIncomingTransfers = (
  state: Pick<GameState, 'dealerTransfers'>,
  zoneId: ZoneCityId,
) => state.dealerTransfers.filter((transfer) => transfer.destinationZoneId === zoneId);

export const getTransferRemainingMs = (
  transfer: Pick<DealerTransfer, 'completesAt'>,
  now: number,
) => Math.max(0, transfer.completesAt - now);

export const startDealerTransfer = (
  state: GameState,
  dealerId: string,
  destinationZoneId: ZoneCityId,
  destinationSlotId: string,
  now: number,
): GameState => {
  const source = getActiveDealerEntries(state).find((entry) => entry.dealer.id === dealerId);
  if (!source || source.zoneId === null || source.slotId === null) return state;
  if (source.zoneId === destinationZoneId) return state;
  if (source.dealer.isArrested) return state;

  const sourceLocation = findZoneSlot(state.zones, source.zoneId, source.slotId);
  const destinationLocation = findZoneSlot(state.zones, destinationZoneId, destinationSlotId);
  if (!sourceLocation || !destinationLocation) return state;

  const sourceSlot = sourceLocation.slot;
  const destinationSlot = destinationLocation.slot;
  if (sourceSlot.dealer?.id !== dealerId || sourceSlot.reservedTransferId !== null) return state;
  if (destinationSlot.dealer || destinationSlot.reservedTransferId) return state;

  const transferId = crypto.randomUUID();
  const transfer: DealerTransfer = {
    id: transferId,
    dealer: source.dealer,
    sourceZoneId: source.zoneId,
    sourceSlotId: source.slotId,
    destinationZoneId,
    destinationSlotId,
    completesAt: now + DEALER_TRANSFER_DURATION_MS,
    riskResolved: false,
  };

  return {
    ...state,
    zones: updateTransferSlots(state.zones, transfer, null),
    dealerTransfers: [...state.dealerTransfers, transfer],
    lastEarningsPerSeller: {
      ...state.lastEarningsPerSeller,
      [source.dealer.id]: 0,
    },
  };
};

export const resolveDueDealerTransfers = (
  state: GameState,
  now: number,
  rng: () => number = Math.random,
): GameState => {
  const dueTransfers = state.dealerTransfers.filter((transfer) => transfer.completesAt <= now);
  if (dueTransfers.length === 0) return state;

  const isCorrupt = dueTransfers.some((transfer) => {
    const source = findZoneSlot(state.zones, transfer.sourceZoneId, transfer.sourceSlotId)?.slot;
    const destination = findZoneSlot(state.zones, transfer.destinationZoneId, transfer.destinationSlotId)?.slot;

    return !source
      || !destination
      || source.dealer !== null
      || destination.dealer !== null
      || source.reservedTransferId !== transfer.id
      || destination.reservedTransferId !== transfer.id;
  });

  if (isCorrupt) return state;

  let zones = state.zones;
  let dealerTransfers = state.dealerTransfers;

  dueTransfers.forEach((transfer) => {
    const arrivedDealer = transfer.riskResolved
      ? transfer.dealer
      : resolveEquipmentRisk(transfer.dealer, rng);

    zones = updateTransferSlots(zones, transfer, arrivedDealer);
    dealerTransfers = dealerTransfers.filter((candidate) => candidate.id !== transfer.id);
  });

  return {
    ...state,
    zones,
    dealerTransfers,
  };
};
