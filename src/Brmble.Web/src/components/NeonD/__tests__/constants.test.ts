import { describe, expect, it } from 'vitest';
import {
  AUTO_BULK_RETAIN_STOCK,
  AUTO_BULK_TRIGGER_STOCK,
  BULK_UNLOCK_COST,
  BULK_VISIBLE_EARNINGS,
  CAPTAIN_BASE_COST,
  CAPTAIN_VISIBLE_EARNINGS,
  createBaseGameState,
  NEON_D_SAVE_KEY,
  PRODUCT_CATALOG,
  STARTING_CASH,
} from '../constants';

describe('Neon-D v2 constants', () => {
  it('uses the v2 save key and aligned fresh-run state', () => {
    const state = createBaseGameState(1_234);

    expect(NEON_D_SAVE_KEY).toBe('brmble_neon_d_save_v2');
    expect(STARTING_CASH).toBe(100);
    expect(state.cash).toBe(100);
    expect(state.unlockedProducts).toEqual(['weed']);
    expect(state.activeDealers).toEqual([null]);
    expect(state.respect).toBe(0);
    expect(state.lastTickAt).toBe(1_234);
  });

  it('locks the aligned 16-product catalog and excludes removed v1 tiers', () => {
    expect(PRODUCT_CATALOG.map((product) => product.id)).toEqual([
      'weed',
      'mushrooms',
      'meth',
      'speed',
      'acid',
      'crack',
      'pcp',
      'heroin',
      'mdma',
      'cocaine',
      'nuke',
      'cyberCrank',
      'ephemerol',
      'sloMo',
      'drencrom',
      'melange',
    ]);
    expect(PRODUCT_CATALOG).toHaveLength(16);
    expect(PRODUCT_CATALOG.map((product) => product.id)).not.toContain('galacticCore');
    expect(PRODUCT_CATALOG.map((product) => product.id)).not.toContain('blueLotus');
  });

  it('locks the Bulk and Captain progression thresholds', () => {
    expect(BULK_UNLOCK_COST).toBe(141_592);
    expect(BULK_VISIBLE_EARNINGS).toBe(212_388);
    expect(AUTO_BULK_TRIGGER_STOCK).toBe(1_500);
    expect(AUTO_BULK_RETAIN_STOCK).toBe(500);
    expect(CAPTAIN_BASE_COST).toBe(5_000_000);
    expect(CAPTAIN_VISIBLE_EARNINGS).toBe(7_500_000);
  });
});
