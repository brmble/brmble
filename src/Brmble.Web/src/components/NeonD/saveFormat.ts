import {
  EQUIPMENT_CATALOG,
  MARKET_MULTIPLIER_MAX,
  MARKET_MULTIPLIER_MIN,
  MUSCLE_CATALOG,
  NEON_D_SAVE_KEY,
  PRODUCT_CATALOG,
} from './constants';
import type {
  Captain,
  Dealer,
  EquipmentId,
  GameState,
  MarketEvent,
  OfflineEarningsSummary,
  ProductId,
  ProductState,
} from './types';

export const NEON_D_SAVE_FORMAT = NEON_D_SAVE_KEY;
export const NEON_D_SAVE_VERSION = 3;

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
  if (!hasExactKeys(value, ['id', 'name', 'selling', 'equipmentIds', 'personalEarnings'])) return false;
  const selling = value.selling;
  if (!isProductId(selling) || !unlockedProducts.includes(selling)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isKnownCanonicalEquipmentPrefix(value.equipmentIds)
    && isNonNegativeFiniteNumber(value.personalEarnings);
}

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

function isMuscleOwnedRecord(value: unknown): boolean {
  if (!isObject(value)) return false;

  return MUSCLE_CATALOG.every((worker) => isNonNegativeInteger(value[worker.id]))
    && Object.keys(value).every((key) => MUSCLE_WORKER_IDS.has(key as (typeof MUSCLE_CATALOG)[number]['id']));
}

function isNumericRecord(value: unknown): boolean {
  return isObject(value) && Object.values(value).every(isNonNegativeFiniteNumber);
}

function hasUniqueSellerIds(sellers: readonly { id: string }[]): boolean {
  return hasUniqueValues(sellers.map((seller) => seller.id));
}

function isGameState(value: unknown): value is GameState {
  if (!isObject(value)) return false;
  if (!hasExactKeys(value, [
    'schemaVersion', 'cash', 'runEarnings', 'respect', 'production', 'unlockedProducts',
    'muscleOwned', 'territoryLevel', 'discountLevel', 'activeDealers', 'availableDealers',
    'lastDealerRefreshAt', 'captains', 'kingpins', 'bulkUnlocked', 'lastBulkSellAt',
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

  const territoryLevel = value.territoryLevel;
  if (!isNonNegativeInteger(territoryLevel)) return false;
  if (activeDealers.length !== territoryLevel + 1) return false;
  if (!activeDealers.every((dealer) => dealer === null || isDealer(dealer, unlockedProducts))) return false;
  if (!availableDealers.every((dealer) => isDealer(dealer, unlockedProducts))) return false;
  if (!captains.every((captain) => isCaptain(captain, unlockedProducts))) return false;

  const activeDealerRecords = activeDealers.filter((dealer): dealer is Dealer => dealer !== null);

  return value.schemaVersion === 3
    && isNonNegativeFiniteNumber(value.cash)
    && isNonNegativeFiniteNumber(value.runEarnings)
    && isNonNegativeFiniteNumber(value.respect)
    && isProductionRecord(value.production, unlockedProducts)
    && isMuscleOwnedRecord(value.muscleOwned)
    && isNonNegativeInteger(value.discountLevel)
    && hasUniqueSellerIds([...activeDealerRecords, ...availableDealers, ...captains])
    && isNonNegativeFiniteNumber(value.lastDealerRefreshAt)
    && isNonNegativeInteger(value.kingpins)
    && typeof value.bulkUnlocked === 'boolean'
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
  if (parsed.version !== 2 && parsed.version !== NEON_D_SAVE_VERSION) {
    throw new Error('This Neon-D save version is not supported.');
  }
  let state = parsed.state;
  if (parsed.version === 2) {
    if (!isObject(state) || state.schemaVersion !== 2) {
      throw new Error('This Neon-D save is incomplete or corrupted.');
    }
    const legacyState = { ...state };
    delete legacyState.autoBulkEnabled;
    state = {
      ...legacyState,
      schemaVersion: 3,
      lastBulkSellAt: 0,
    };
  }
  if (!isGameState(state)) {
    throw new Error('This Neon-D save is incomplete or corrupted.');
  }

  return state;
}
