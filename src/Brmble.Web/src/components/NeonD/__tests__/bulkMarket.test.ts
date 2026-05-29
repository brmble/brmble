import { describe, expect, it } from 'vitest';
import { canUseBulkMarket, formatBulkCooldown, getBestBulkStreetValue, getBulkSaleConfig, sellBulkStock } from '../bulkMarket';
import type { Dealer } from '../types';

const makeDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'dealer-1',
  name: 'Dealer One',
  selling: 'weed',
  volume: 1,
  margin: 1,
  volumeBonus: 0,
  marginBonus: 0,
  sideVolume: 0,
  equipmentCount: 0,
  maxEquipmentSlots: 3,
  riskBonus: 0,
  bulkStreetValue: 0,
  baseVolumeGps: 1,
  baseMarginMult: 1,
  volumeStars: 3,
  marginStars: 3,
  isProtected: false,
  isArrested: false,
  nextArrestCheckAt: Date.now() + 60_000,
  hasPendingUpgrade: false,
  pendingUpgradeOptions: [],
  ...overrides,
});

describe('bulkMarket', () => {
  it('blocks sale while the market is cooling down', () => {
    expect(canUseBulkMarket({ cooldownUntil: 1000, lastSaleAt: 0 }, 999)).toBe(false);
    expect(canUseBulkMarket({ cooldownUntil: 1000, lastSaleAt: 0 }, 1000)).toBe(true);
  });

  it('sells capped stock at bulk street value and starts cooldown', () => {
    const sale = sellBulkStock({
      stock: 250,
      maxStock: 100,
      sellPrice: 4.2,
      streetValuePercent: 0.2,
      now: 10_000,
      cooldownMs: 60_000,
    });

    expect(sale.soldStock).toBe(100);
    expect(sale.remainingStock).toBe(150);
    expect(sale.earned).toBeCloseTo(84, 5);
    expect(sale.bulkMarket.cooldownUntil).toBe(70_000);
  });

  it('uses the best dealer bulk value or operation network floor', () => {
    expect(getBestBulkStreetValue([makeDealer({ bulkStreetValue: 0.2 })], 1)).toBeCloseTo(0.2, 5);
    expect(getBestBulkStreetValue([makeDealer({ bulkStreetValue: 0 })], 1)).toBeCloseTo(0.13, 5);
    expect(getBestBulkStreetValue([makeDealer({ bulkStreetValue: 0 })], 0)).toBe(0);
  });

  it('scales bulk sale config from bulk network level', () => {
    expect(getBulkSaleConfig(0).maxStock).toBe(100);
    expect(getBulkSaleConfig(2).maxStock).toBe(200);
    expect(getBulkSaleConfig(2).cooldownMs).toBe(4 * 60_000);
  });

  it('formats cooldown for UI display', () => {
    expect(formatBulkCooldown(61_000)).toBe('1:01');
  });
});
