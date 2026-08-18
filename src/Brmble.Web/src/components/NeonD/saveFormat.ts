import {
  EQUIPMENT_CATALOG,
  MARKET_MULTIPLIER_MAX,
  MARKET_MULTIPLIER_MIN,
  MUSCLE_CATALOG,
  NEON_D_SAVE_KEY,
  PRODUCT_CATALOG,
  ZONE_CITY_CATALOG,
} from './constants';
import type {
  Captain,
  Dealer,
  DealerTransfer,
  EquipmentId,
  GameState,
  MarketEvent,
  OfflineEarningsSummary,
  ProductId,
  ProductState,
  Zone,
  ZoneCityId,
  ZoneDealerSlot,
} from './types';
import { isTalentStateValid } from './talents';
import { createAmsterdamZone } from './zones';

export const NEON_D_SAVE_FORMAT = NEON_D_SAVE_KEY;
export const NEON_D_SAVE_VERSION = 4;

type SaveEnvelope = {
  format: typeof NEON_D_SAVE_FORMAT;
  version: typeof NEON_D_SAVE_VERSION;
  state: GameState;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

const PRODUCT_IDS_IN_ORDER = PRODUCT_CATALOG.map((product) => product.id);
const PRODUCT_IDS = new Set(PRODUCT_IDS_IN_ORDER);
const EQUIPMENT_IDS = new Set(EQUIPMENT_CATALOG.map((equipment) => equipment.id));
const MUSCLE_WORKER_IDS_IN_ORDER = MUSCLE_CATALOG.map((worker) => worker.id);
const MUSCLE_WORKER_IDS = new Set(MUSCLE_WORKER_IDS_IN_ORDER);
const ZONE_CITY_IDS = new Set(ZONE_CITY_CATALOG.map((city) => city.id));

function matchesCatalogPrefix(
  values: unknown,
  catalogIds: readonly string[],
): boolean {
  return Array.isArray(values)
    && values.every((value, index) => value === catalogIds[index]);
}

function hasUniqueValues<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function isProductId(value: unknown): value is ProductId {
  return typeof value === 'string' && PRODUCT_IDS.has(value as (typeof PRODUCT_CATALOG)[number]['id']);
}

function isEquipmentId(value: unknown): value is EquipmentId {
  return typeof value === 'string' && EQUIPMENT_IDS.has(value as EquipmentId);
}

function isZoneCityId(value: unknown): value is ZoneCityId {
  return typeof value === 'string' && ZONE_CITY_IDS.has(value as ZoneCityId);
}

function isEquipmentIdArray(value: unknown): value is EquipmentId[] {
  return Array.isArray(value)
    && value.every(isEquipmentId);
}

function isProductState(value: unknown): value is ProductState {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, ['stock', 'producersOwned', 'purchasedUpgradeIds'])) return false;
  return isNonNegativeFiniteNumber(value.stock)
    && isNonNegativeInteger(value.producersOwned);
}

function isUnlockedProductPrefix(value: unknown): value is ProductId[] {
  return Array.isArray(value)
    && value.length > 0
    && value[0] === 'weed'
    && matchesCatalogPrefix(value, PRODUCT_IDS_IN_ORDER);
}

function isKnownCanonicalEquipmentPrefix(value: unknown): value is EquipmentId[] {
  if (!isEquipmentIdArray(value)) return false;
  return hasUniqueValues(value);
}

function isDealer(
  value: unknown,
  unlockedProducts: readonly string[],
): value is Dealer {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, ['id', 'name', 'selling', 'volumeMultiplier', 'marginMultiplier', 'equipmentIds', 'isProtected', 'isArrested', 'earningsPerSecondAtArrest'])) return false;
  const selling = value.selling;
  if (!isProductId(selling) || !unlockedProducts.includes(selling)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isFiniteNumber(value.volumeMultiplier)
    && value.volumeMultiplier >= 0.5
    && value.volumeMultiplier <= 1.5
    && isFiniteNumber(value.marginMultiplier)
    && value.marginMultiplier >= 0.5
    && value.marginMultiplier <= 1.5
    && isKnownCanonicalEquipmentPrefix(value.equipmentIds)
    && typeof value.isProtected === 'boolean'
    && typeof value.isArrested === 'boolean'
    && isNonNegativeFiniteNumber(value.earningsPerSecondAtArrest);
}

function isCaptain(
  value: unknown,
  unlockedProducts: readonly string[],
): value is Captain {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, [
    'id', 'name', 'selling', 'equipmentIds', 'personalEarnings',
    'lastLevelUpEarnings', 'level', 'talentPoints', 'talentRanks', 'ledgerUnlocked', 'kingpinAvailable',
    'zoneBulkSellAvailableAt',
  ])) return false;
  const selling = value.selling;
  if (!isProductId(selling) || !unlockedProducts.includes(selling)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isKnownCanonicalEquipmentPrefix(value.equipmentIds)
    && isNonNegativeFiniteNumber(value.personalEarnings)
    && isNonNegativeFiniteNumber(value.lastLevelUpEarnings)
    && value.lastLevelUpEarnings <= value.personalEarnings
    && isNonNegativeFiniteNumber(value.zoneBulkSellAvailableAt)
    && isTalentStateValid(value as unknown as Captain);
}

function isZoneDealerSlot(value: unknown, unlockedProducts: readonly string[]): value is ZoneDealerSlot {
  if (!isObject(value) || !hasExactKeys(value, ['id', 'dealer', 'reservedTransferId'])) return false;
  return typeof value.id === 'string'
    && (value.dealer === null || isDealer(value.dealer, unlockedProducts))
    && (value.reservedTransferId === null || typeof value.reservedTransferId === 'string');
}

function isZone(value: unknown, unlockedProducts: readonly string[]): value is Zone {
  if (!isObject(value) || !hasExactKeys(value, ['id', 'displayName', 'captainId', 'dealerSlots', 'perkIds'])) return false;
  if (!isZoneCityId(value.id) || !Array.isArray(value.dealerSlots) || !Array.isArray(value.perkIds)) return false;
  const city = ZONE_CITY_CATALOG.find((item) => item.id === value.id);
  return value.displayName === city?.name
    && (value.captainId === null || typeof value.captainId === 'string')
    && value.dealerSlots.every((slot) => isZoneDealerSlot(slot, unlockedProducts))
    && value.perkIds.every((perkId) => typeof perkId === 'string')
    && hasUniqueValues(value.dealerSlots.map((slot) => slot.id))
    && hasUniqueValues(value.perkIds);
}

function isDealerTransfer(value: unknown, unlockedProducts: readonly string[]): value is DealerTransfer {
  if (!isObject(value) || !hasExactKeys(value, [
    'id', 'dealer', 'sourceZoneId', 'sourceSlotId', 'destinationZoneId', 'destinationSlotId', 'completesAt', 'riskResolved',
  ])) return false;
  return typeof value.id === 'string'
    && isDealer(value.dealer, unlockedProducts)
    && isZoneCityId(value.sourceZoneId)
    && typeof value.sourceSlotId === 'string'
    && isZoneCityId(value.destinationZoneId)
    && typeof value.destinationSlotId === 'string'
    && isNonNegativeFiniteNumber(value.completesAt)
    && typeof value.riskResolved === 'boolean';
}

const isTransferReservationGraphValid = (
  zones: Zone[],
  transfers: DealerTransfer[],
  availableDealers: Dealer[],
): boolean => {
  if (!hasUniqueValues(transfers.map((transfer) => transfer.id))) return false;

  const zoneDealerIds = zones.flatMap((zone) => zone.dealerSlots.flatMap((slot) =>
    slot.dealer ? [slot.dealer.id] : [],
  ));
  const travellingDealerIds = transfers.map((transfer) => transfer.dealer.id);
  const locatedDealerIds = [...zoneDealerIds, ...travellingDealerIds];
  if (!hasUniqueValues(locatedDealerIds)) return false;
  if (locatedDealerIds.some((dealerId) => availableDealers.some((dealer) => dealer.id === dealerId))) return false;

  const reservations = zones.flatMap((zone) => zone.dealerSlots.flatMap((slot) =>
    slot.reservedTransferId === null ? [] : [{ zoneId: zone.id, slotId: slot.id, transferId: slot.reservedTransferId }],
  ));
  const transferIds = new Set(transfers.map((transfer) => transfer.id));
  if (reservations.some((reservation) => !transferIds.has(reservation.transferId))) return false;

  return transfers.every((transfer) => {
    if (transfer.sourceZoneId === transfer.destinationZoneId) return false;
    const source = zones.find((zone) => zone.id === transfer.sourceZoneId)
      ?.dealerSlots.find((slot) => slot.id === transfer.sourceSlotId);
    const destination = zones.find((zone) => zone.id === transfer.destinationZoneId)
      ?.dealerSlots.find((slot) => slot.id === transfer.destinationSlotId);
    const matchingReservations = reservations.filter((reservation) => reservation.transferId === transfer.id);
    if (!source || !destination) return false;

    return source.dealer === null
      && destination.dealer === null
      && source.reservedTransferId === transfer.id
      && destination.reservedTransferId === transfer.id
      && matchingReservations.length === 2
      && matchingReservations.some((reservation) =>
        reservation.zoneId === transfer.sourceZoneId && reservation.slotId === transfer.sourceSlotId,
      )
      && matchingReservations.some((reservation) =>
        reservation.zoneId === transfer.destinationZoneId && reservation.slotId === transfer.destinationSlotId,
      );
  });
};

const isPendingAmsterdamCaptainSelectionValid = (
  zones: Zone[],
  captains: Captain[],
): boolean => zones.length === 1
  && zones[0].id === 'amsterdam'
  && zones[0].captainId === null
  && captains.length > 1;

function isMarketEvent(
  value: unknown,
  unlockedProducts: readonly string[],
): value is MarketEvent {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, ['productId', 'multiplier', 'endsAt'])) return false;
  const productId = value.productId;
  if (!isProductId(productId) || !unlockedProducts.includes(productId)) return false;
  return isNonNegativeFiniteNumber(value.multiplier)
    && value.multiplier >= MARKET_MULTIPLIER_MIN
    && value.multiplier <= MARKET_MULTIPLIER_MAX
    && isNonNegativeFiniteNumber(value.endsAt);
}

function isOfflineEarningsSummary(value: unknown): value is OfflineEarningsSummary {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, ['actualAwayMs', 'simulatedMs', 'cashEarned', 'respectEarned'])) return false;
  return isNonNegativeFiniteNumber(value.actualAwayMs)
    && isNonNegativeFiniteNumber(value.simulatedMs)
    && value.simulatedMs <= value.actualAwayMs
    && isNonNegativeFiniteNumber(value.cashEarned)
    && isNonNegativeFiniteNumber(value.respectEarned);
}

function isProductionRecord(
  value: unknown,
  unlockedProducts: readonly string[],
): boolean {
  if (!isObject(value)) return false;

  return PRODUCT_CATALOG.every((product) => {
    const productState = value[product.id];
    if (!isProductState(productState)) return false;

    const upgradeIds = product.upgrades.map((upgrade) => upgrade.id);
    const isUnlocked = unlockedProducts.includes(product.id);
    return matchesCatalogPrefix(productState.purchasedUpgradeIds, upgradeIds)
      && (isUnlocked
        || (
          productState.stock === 0
          && productState.producersOwned === 0
          && productState.purchasedUpgradeIds.length === 0
        ));
  })
    && Object.keys(value).every((key) => PRODUCT_IDS.has(key as (typeof PRODUCT_CATALOG)[number]['id']));
}

function areBulkUnlockedProductsValid(
  production: unknown,
  unlockedProducts: readonly string[],
  bulkUnlockedProductIds: unknown,
): boolean {
  if (!Array.isArray(bulkUnlockedProductIds) || !hasUniqueValues(bulkUnlockedProductIds)) return false;

  return bulkUnlockedProductIds.every((productId) => {
    if (!isProductId(productId) || !unlockedProducts.includes(productId)) return false;

    const product = PRODUCT_CATALOG.find((candidate) => candidate.id === productId);
    const productState = isObject(production) ? production[productId] : undefined;
    if (!product || !isProductState(productState)) return false;

    const upgradeIds = product.upgrades.map((upgrade) => upgrade.id);
    return matchesCatalogPrefix(productState.purchasedUpgradeIds, upgradeIds)
      && productState.purchasedUpgradeIds.length === upgradeIds.length;
  });
}

function isMuscleOwnedRecord(value: unknown): boolean {
  if (!isObject(value)) return false;

  return MUSCLE_CATALOG.every((worker) => isNonNegativeInteger(value[worker.id]))
    && Object.keys(value).every((key) => MUSCLE_WORKER_IDS.has(key as (typeof MUSCLE_CATALOG)[number]['id']));
}

function isNumericRecord(value: unknown): boolean {
  return isObject(value) && Object.values(value).every(isNonNegativeFiniteNumber);
}

function isGameState(value: unknown): value is GameState {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, [
    'schemaVersion', 'cash', 'runEarnings', 'respect', 'production', 'unlockedProducts',
    'muscleOwned', 'territoryLevel', 'discountLevel', 'activeDealers', 'availableDealers',
    'zones', 'dealerTransfers', 'pendingAmsterdamCaptainSelection',
    'lastDealerRefreshAt', 'captains', 'kingpins', 'bulkUnlockedProductIds', 'lastBulkSellAt',
    'activeMarketEvent', 'nextMarketCheckAt', 'nextRiskCheckAt', 'lastEarningsPerSeller',
    'lastTickAt', 'offlineEarningsSummary',
  ])) return false;
  const unlockedProducts = value.unlockedProducts;
  if (!isUnlockedProductPrefix(unlockedProducts)) return false;

  const activeDealers = value.activeDealers;
  if (!Array.isArray(activeDealers)) return false;

  const availableDealers = value.availableDealers;
  if (!Array.isArray(availableDealers) || availableDealers.length !== 3) return false;

  const captains = value.captains;
  if (!Array.isArray(captains)) return false;

  const zones = value.zones;
  if (!Array.isArray(zones) || !zones.every((zone) => isZone(zone, unlockedProducts))) return false;
  const dealerTransfers = value.dealerTransfers;
  if (!Array.isArray(dealerTransfers) || !dealerTransfers.every((transfer) => isDealerTransfer(transfer, unlockedProducts))) return false;
  if (typeof value.pendingAmsterdamCaptainSelection !== 'boolean') return false;

  const territoryLevel = value.territoryLevel;
  if (!isNonNegativeInteger(territoryLevel)) return false;
  const totalDealerCapacity = zones.length > 0
    ? zones.reduce((sum, zone) => sum + zone.dealerSlots.length, 0)
    : activeDealers.length;
  if (totalDealerCapacity !== territoryLevel + 1) return false;
  if (!activeDealers.every((seller) => seller === null || isDealer(seller, unlockedProducts) || isCaptain(seller, unlockedProducts))) return false;
  if (!availableDealers.every((dealer) => isDealer(dealer, unlockedProducts))) return false;
  if (!captains.every((captain) => isCaptain(captain, unlockedProducts))) return false;

  const activeSellerRecords = activeDealers.filter((seller): seller is Dealer | Captain => seller !== null);
  const activeCaptainIds = new Set(
    activeSellerRecords.filter((seller): seller is Captain => isCaptain(seller, unlockedProducts)).map((captain) => captain.id),
  );
  const ownedCaptainIds = new Set(captains.map((captain) => captain.id));
  const zoneIds = zones.map((zone) => zone.id);
  const assignedCaptainIds = zones.flatMap((zone) => zone.captainId ? [zone.captainId] : []);
  const activeDealerIds = activeSellerRecords
    .filter((seller): seller is Dealer => isDealer(seller, unlockedProducts))
    .map((dealer) => dealer.id);
  const normalDealerIds = [
    ...activeDealerIds,
    ...availableDealers.map((dealer) => dealer.id),
    ...zones.flatMap((zone) => zone.dealerSlots.flatMap((slot) => slot.dealer ? [slot.dealer.id] : [])),
    ...dealerTransfers.map((transfer) => transfer.dealer.id),
  ];
  const activeCaptainRecords = activeSellerRecords
    .filter((seller): seller is Captain => isCaptain(seller, unlockedProducts));

  const bulkUnlockedProductIds = value.bulkUnlockedProductIds;

  return value.schemaVersion === 6
    && isNonNegativeFiniteNumber(value.cash)
    && isNonNegativeFiniteNumber(value.runEarnings)
    && isNonNegativeFiniteNumber(value.respect)
    && isProductionRecord(value.production, unlockedProducts)
    && areBulkUnlockedProductsValid(value.production, unlockedProducts, bulkUnlockedProductIds)
    && isMuscleOwnedRecord(value.muscleOwned)
    && isNonNegativeInteger(value.discountLevel)
    && hasUniqueValues(activeDealerIds)
    && hasUniqueValues(normalDealerIds)
    && normalDealerIds.every((id) => !ownedCaptainIds.has(id))
    && hasUniqueValues(zoneIds)
    && hasUniqueValues(assignedCaptainIds)
    && assignedCaptainIds.every((id) => ownedCaptainIds.has(id))
    && (zones.length !== 0 || captains.length === 0)
    && (zones.length === 0 || activeDealers.length === 0)
    && (zones.length === 0 || zones[0]?.id === 'amsterdam')
    && (value.pendingAmsterdamCaptainSelection
      ? isPendingAmsterdamCaptainSelectionValid(zones, captains)
      : zones.every((zone) => zone.captainId !== null))
    && (zones.length > 0
      ? isTransferReservationGraphValid(zones, dealerTransfers, availableDealers)
      : dealerTransfers.length === 0)
    && hasUniqueValues(captains.map((captain) => captain.id))
    && activeCaptainIds.size === activeCaptainRecords.length
    && [...activeCaptainIds].every((id) => ownedCaptainIds.has(id))
    && activeCaptainRecords.every((activeCaptain) => {
      const ownedCaptain = captains.find((captain) => captain.id === activeCaptain.id);
      return ownedCaptain !== undefined && JSON.stringify(ownedCaptain) === JSON.stringify(activeCaptain);
    })
    && isNonNegativeFiniteNumber(value.lastDealerRefreshAt)
    && isNonNegativeInteger(value.kingpins)
    && isNonNegativeFiniteNumber(value.lastBulkSellAt)
    && (value.activeMarketEvent === null || isMarketEvent(value.activeMarketEvent, unlockedProducts))
    && isNonNegativeFiniteNumber(value.nextMarketCheckAt)
    && isNonNegativeFiniteNumber(value.nextRiskCheckAt)
    && isNumericRecord(value.lastEarningsPerSeller)
    && isNonNegativeFiniteNumber(value.lastTickAt)
    && (value.offlineEarningsSummary === null
      || isOfflineEarningsSummary(value.offlineEarningsSummary));
}

export function serializeNeonDSave(state: GameState): string {
  const envelope: SaveEnvelope = {
    format: NEON_D_SAVE_FORMAT,
    version: NEON_D_SAVE_VERSION,
    state,
  };
  return JSON.stringify(envelope, null, 2);
}

export function migrateNeonDState(value: unknown): unknown {
  if (!isObject(value)) return { schemaVersion: 6 };
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6) {
    return value;
  }

  let state: Record<string, unknown> = { ...value };
  if (state.schemaVersion === 2) {
    delete state.autoBulkEnabled;
    state = { ...state, schemaVersion: 3, lastBulkSellAt: 0 };
  }
  if (state.schemaVersion === 3) {
    delete state.bulkUnlocked;
    state = { ...state, schemaVersion: 4, bulkUnlockedProductIds: [] };
  }
  if (state.schemaVersion === 4) {
    const captains = Array.isArray(state.captains)
      ? state.captains.map((captain) => (
        isObject(captain)
          ? {
              ...captain,
              lastLevelUpEarnings: captain.personalEarnings,
              level: 0,
              talentPoints: 0,
              talentRanks: { red: [0, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
              ledgerUnlocked: false,
              kingpinAvailable: false,
            }
          : captain
      ))
      : state.captains;
    state = { ...state, schemaVersion: 5, captains };
  }

  if (state.schemaVersion === 5) {
    const legacyActiveDealers = Array.isArray(state.activeDealers) ? state.activeDealers : [];
    const captains = Array.isArray(state.captains)
      ? state.captains.map((captain) => (
        isObject(captain)
          ? { ...captain, zoneBulkSellAvailableAt: 0 }
          : captain
      ))
      : [];
    const normalDealers = legacyActiveDealers.map((seller) => (
      isObject(seller)
      && 'volumeMultiplier' in seller
      && 'marginMultiplier' in seller
      && !('talentPoints' in seller)
        ? seller
        : null
    ));
    const zones = captains.length > 0
      ? [createAmsterdamZone(
          isObject(captains[0]) && typeof captains[0].id === 'string' ? captains[0].id : null,
          legacyActiveDealers.length,
          normalDealers as (Dealer | null)[],
        )]
      : [];
    state = {
      ...state,
      schemaVersion: 6,
      captains,
      activeDealers: captains.length > 0 ? [] : legacyActiveDealers,
      zones,
      dealerTransfers: [],
      pendingAmsterdamCaptainSelection: false,
    };
  }

  const captains = Array.isArray(state.captains)
    ? state.captains.map((captain) => (
      isObject(captain) && !('lastLevelUpEarnings' in captain)
        ? { ...captain, lastLevelUpEarnings: captain.personalEarnings }
        : captain
    ))
    : state.captains;

  delete state.captainRecruitmentFund;
  return { ...state, schemaVersion: 6, captains };
}

export function parseNeonDSave(text: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (!isObject(parsed) || !hasExactKeys(parsed, ['format', 'version', 'state']) || parsed.format !== NEON_D_SAVE_FORMAT) {
    throw new Error('This file is not a Neon-D save.');
  }
  if (parsed.version !== 2 && parsed.version !== 3 && parsed.version !== NEON_D_SAVE_VERSION) {
    throw new Error('This Neon-D save version is not supported.');
  }
  const state = migrateNeonDState(parsed.state);
  if (!isGameState(state)) {
    throw new Error('This Neon-D save is incomplete or corrupted.');
  }

  return state;
}
