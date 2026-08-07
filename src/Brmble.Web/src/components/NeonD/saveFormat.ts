import type { Dealer, GameState, ProductionItem } from './types';

export const NEON_D_SAVE_FORMAT = 'brmble-neon-d-save';
export const NEON_D_SAVE_VERSION = 1;

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

function isProductionItem(value: unknown): value is ProductionItem {
  if (!isObject(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isFiniteNumber(value.stock)
    && isFiniteNumber(value.rate)
    && isFiniteNumber(value.yieldPerLevel)
    && isFiniteNumber(value.costMultiplier)
    && isFiniteNumber(value.level)
    && isFiniteNumber(value.upgradeCost);
}

function isDealerUpgrade(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.type === 'string'
    && typeof value.label === 'string'
    && typeof value.description === 'string'
    && isFiniteNumber(value.value)
    && (value.marginPenalty === undefined || isFiniteNumber(value.marginPenalty))
    && (value.sideVolumeValue === undefined || isFiniteNumber(value.sideVolumeValue));
}

function isDealer(value: unknown): value is Dealer {
  if (!isObject(value)) return false;
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.selling === 'string'
    && isFiniteNumber(value.volume)
    && isFiniteNumber(value.margin)
    && isFiniteNumber(value.volumeBonus)
    && isFiniteNumber(value.marginBonus)
    && isFiniteNumber(value.sideVolume)
    && isFiniteNumber(value.equipmentCount)
    && isFiniteNumber(value.baseVolumeGps)
    && isFiniteNumber(value.baseMarginMult)
    && isFiniteNumber(value.volumeStars)
    && isFiniteNumber(value.marginStars)
    && typeof value.isProtected === 'boolean'
    && typeof value.isArrested === 'boolean'
    && isFiniteNumber(value.nextArrestCheckAt)
    && typeof value.hasPendingUpgrade === 'boolean'
    && Array.isArray(value.pendingUpgradeOptions)
    && value.pendingUpgradeOptions.every(isDealerUpgrade);
}

function isGameState(value: unknown): value is GameState {
  if (!isObject(value)) return false;

  const production = value.production;
  const offlineSummary = value.offlineEarningsSummary;

  return isFiniteNumber(value.money)
    && isFiniteNumber(value.totalEarned)
    && isFiniteNumber(value.researchSpeed)
    && isObject(production)
    && Object.values(production).every(isProductionItem)
    && Array.isArray(value.unlockedProduction)
    && value.unlockedProduction.every(item => typeof item === 'string')
    && Array.isArray(value.activeDealers)
    && value.activeDealers.every(dealer => dealer === null || isDealer(dealer))
    && Array.isArray(value.availableDealers)
    && value.availableDealers.every(isDealer)
    && isFiniteNumber(value.unlockedSlots)
    && isFiniteNumber(value.lastRefreshTime)
    && isObject(value.lastEarningsPerDealer)
    && Object.values(value.lastEarningsPerDealer).every(isFiniteNumber)
    && isFiniteNumber(value.lastTickAt)
    && (offlineSummary === null
      || (isObject(offlineSummary) && isFiniteNumber(offlineSummary.awayMs) && isFiniteNumber(offlineSummary.earned)));
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
