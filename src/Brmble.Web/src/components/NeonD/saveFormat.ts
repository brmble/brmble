import { EQUIPMENT_CATALOG, MUSCLE_CATALOG, NEON_D_SAVE_KEY, PRODUCT_CATALOG } from './constants';
import type {
  Captain,
  Dealer,
  EquipmentId,
  GameState,
  MarketEvent,
  OfflineEarningsSummary,
  ProductState,
} from './types';

export const NEON_D_SAVE_FORMAT = NEON_D_SAVE_KEY;
export const NEON_D_SAVE_VERSION = 2;

type SaveEnvelope = {
  format: typeof NEON_D_SAVE_FORMAT;
  version: typeof NEON_D_SAVE_VERSION;
  state: GameState;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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

function isProductId(value: unknown): boolean {
  return typeof value === 'string' && PRODUCT_IDS.has(value as (typeof PRODUCT_CATALOG)[number]['id']);
}

function isEquipmentId(value: unknown): value is EquipmentId {
  return typeof value === 'string' && EQUIPMENT_IDS.has(value as EquipmentId);
}

function isEquipmentIdArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.every(isEquipmentId);
}

function isProductState(value: unknown): value is ProductState {
  if (!isObject(value)) return false;
  return isFiniteNumber(value.stock)
    && isNonNegativeInteger(value.producersOwned);
}

function isDealer(value: unknown): value is Dealer {
  if (!isObject(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isProductId(value.selling)
    && isFiniteNumber(value.volumeMultiplier)
    && isFiniteNumber(value.marginMultiplier)
    && isEquipmentIdArray(value.equipmentIds)
    && typeof value.isProtected === 'boolean'
    && typeof value.isArrested === 'boolean'
    && isFiniteNumber(value.earningsPerSecondAtArrest);
}

function isCaptain(value: unknown): value is Captain {
  if (!isObject(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isProductId(value.selling)
    && isEquipmentIdArray(value.equipmentIds)
    && isFiniteNumber(value.personalEarnings);
}

function isMarketEvent(value: unknown): value is MarketEvent {
  if (!isObject(value)) return false;
  return isProductId(value.productId)
    && isFiniteNumber(value.multiplier)
    && isFiniteNumber(value.endsAt);
}

function isOfflineEarningsSummary(value: unknown): value is OfflineEarningsSummary {
  if (!isObject(value)) return false;
  return isFiniteNumber(value.actualAwayMs)
    && isFiniteNumber(value.simulatedMs)
    && isFiniteNumber(value.cashEarned)
    && isFiniteNumber(value.respectEarned);
}

function isProductionRecord(value: unknown): boolean {
  if (!isObject(value)) return false;

  return PRODUCT_CATALOG.every((product) => {
    const productState = value[product.id];
    return isProductState(productState)
      && matchesCatalogPrefix(
        productState.purchasedUpgradeIds,
        product.upgrades.map((upgrade) => upgrade.id),
      );
  })
    && Object.keys(value).every((key) => PRODUCT_IDS.has(key as (typeof PRODUCT_CATALOG)[number]['id']));
}

function isMuscleOwnedRecord(value: unknown): boolean {
  if (!isObject(value)) return false;

  return MUSCLE_CATALOG.every((worker) => isNonNegativeInteger(value[worker.id]))
    && Object.keys(value).every((key) => MUSCLE_WORKER_IDS.has(key as (typeof MUSCLE_CATALOG)[number]['id']));
}

function isNumericRecord(value: unknown): boolean {
  return isObject(value) && Object.values(value).every(isFiniteNumber);
}

function isGameState(value: unknown): value is GameState {
  if (!isObject(value)) return false;

  return value.schemaVersion === 2
    && isFiniteNumber(value.cash)
    && isFiniteNumber(value.runEarnings)
    && isFiniteNumber(value.respect)
    && isProductionRecord(value.production)
    && matchesCatalogPrefix(value.unlockedProducts, PRODUCT_IDS_IN_ORDER)
    && isMuscleOwnedRecord(value.muscleOwned)
    && isNonNegativeInteger(value.territoryLevel)
    && isNonNegativeInteger(value.discountLevel)
    && Array.isArray(value.activeDealers)
    && value.activeDealers.every((dealer) => dealer === null || isDealer(dealer))
    && Array.isArray(value.availableDealers)
    && value.availableDealers.every(isDealer)
    && isFiniteNumber(value.lastDealerRefreshAt)
    && Array.isArray(value.captains)
    && value.captains.every(isCaptain)
    && isNonNegativeInteger(value.kingpins)
    && typeof value.bulkUnlocked === 'boolean'
    && typeof value.autoBulkEnabled === 'boolean'
    && (value.activeMarketEvent === null || isMarketEvent(value.activeMarketEvent))
    && isFiniteNumber(value.nextMarketCheckAt)
    && isFiniteNumber(value.nextRiskCheckAt)
    && isNumericRecord(value.lastEarningsPerSeller)
    && isFiniteNumber(value.lastTickAt)
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

  if (!isObject(parsed) || parsed.format !== NEON_D_SAVE_FORMAT) {
    throw new Error('This file is not a Neon-D save.');
  }
  if (parsed.version !== NEON_D_SAVE_VERSION) {
    throw new Error('This Neon-D save version is not supported.');
  }
  if (!isGameState(parsed.state)) {
    throw new Error('This Neon-D save is incomplete or corrupted.');
  }

  return parsed.state;
}
