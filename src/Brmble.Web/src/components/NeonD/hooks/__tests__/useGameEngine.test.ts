import { createElement, StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBaseGameState, NEON_D_SAVE_KEY, STARTING_CASH } from '../../constants';
import {
  getCaptainCost,
  getProducerCost,
  getProductProductionRate,
  getRecruitmentRefreshMs,
  getRespectMultiplier,
} from '../../economy';
import type { GameState } from '../../types';
import { makeReferenceCaptain, makeReferenceDealer } from '../../__tests__/testFixtures';
import { parseNeonDSave, serializeNeonDSave } from '../../saveFormat';
import { useGameEngine } from '../useGameEngine';
import { NEON_D_CARD_PREFERENCES_KEY } from '../usePersistedCardPreferences';

const renderSeededGame = (overrides: Partial<GameState>) => {
  const now = Date.now();
  const state: GameState = {
    ...createBaseGameState(now),
    ...overrides,
    lastTickAt: overrides.lastTickAt ?? now,
  };
  localStorage.setItem(NEON_D_SAVE_KEY, JSON.stringify(state));
  return renderHook(() => useGameEngine());
};

describe('useGameEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('starts with $100, Weed only, zero producers, and the first producer priced at $15', () => {
    const { result } = renderHook(() => useGameEngine());
    expect(result.current.state.cash).toBe(100);
    expect(result.current.state.unlockedProducts).toEqual(['weed']);
    expect(result.current.state.production.weed.producersOwned).toBe(0);
    expect(getProducerCost('weed', 0, result.current.state.discountLevel)).toBe(15);
  });

  it('completes the fresh-run Production -> Distribution and Cash -> Muscle -> Respect loops', () => {
    const { result } = renderHook(() => useGameEngine());

    expect(result.current.state.cash).toBe(100);
    expect(result.current.state.unlockedProducts).toEqual(['weed']);
    expect(result.current.state.activeDealers).toEqual([null]);
    expect(result.current.state.respect).toBe(0);

    act(() => {
      result.current.buyProducer('weed');
      result.current.buyMuscleWorker('hoodRat');
    });
    expect(result.current.state.cash).toBeCloseTo(5);

    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.state.production.weed.stock).toBeCloseTo(2);
    expect(result.current.state.respect).toBeCloseTo(10);

    const candidate = result.current.state.availableDealers[0];
    expect(candidate.volumeMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(candidate.volumeMultiplier).toBeLessThanOrEqual(1.5);
    expect(candidate.marginMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(candidate.marginMultiplier).toBeLessThanOrEqual(1.5);

    act(() => result.current.hireDealer(candidate.id, 0));
    const cashBeforeSales = result.current.state.cash;
    act(() => vi.advanceTimersByTime(20_000));

    expect(result.current.state.cash).toBeGreaterThan(cashBeforeSales);
    expect(result.current.state.runEarnings).toBeGreaterThan(0);
    expect(result.current.state.production.weed.stock).toBeGreaterThanOrEqual(0);
  });

  it('does not read the legacy v1 save key', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({ cash: 999_999 }));
    const { result } = renderHook(() => useGameEngine());
    expect(result.current.state.cash).toBe(100);
  });

  it('clears persisted card preferences when the Neon-D empire is reset', () => {
    localStorage.setItem(
      NEON_D_CARD_PREFERENCES_KEY,
      JSON.stringify({ collapsedSellerIds: ['dealer-1'] }),
    );
    const { result } = renderHook(() => useGameEngine());

    act(() => result.current.resetGame());

    expect(localStorage.getItem(NEON_D_CARD_PREFERENCES_KEY)).toBeNull();
  });

  it('buyProducer buys exactly one producer and charges the exponential current price', () => {
    const { result } = renderHook(() => useGameEngine());

    act(() => result.current.buyProducer('weed'));
    expect(result.current.state.cash).toBeCloseTo(85);
    expect(result.current.state.production.weed.producersOwned).toBe(1);

    act(() => result.current.buyProducer('weed'));
    expect(result.current.state.cash).toBeCloseTo(85 - 16.8);
    expect(result.current.state.production.weed.producersOwned).toBe(2);
  });

  it('cannot research a hidden or non-sequential product', () => {
    const { result } = renderHook(() => useGameEngine());
    act(() => result.current.researchProduct('meth'));
    expect(result.current.state.unlockedProducts).toEqual(['weed']);
  });

  it('researches the next visible product at its exact research cost', () => {
    const { result } = renderSeededGame({ cash: 2_000, runEarnings: 1_600 });
    act(() => result.current.researchProduct('mushrooms'));
    expect(result.current.state.cash).toBe(0);
    expect(result.current.state.unlockedProducts).toEqual(['weed', 'mushrooms']);
  });

  it('does not unlock bulk selling before every product upgrade is owned', () => {
    const { result } = renderSeededGame({
      cash: 200_000,
    });

    act(() => result.current.unlockBulkSelling('weed'));

    expect(result.current.state.bulkUnlockedProductIds).toEqual([]);
    expect(result.current.state.cash).toBe(200_000);
  });

  it('purchases bulk selling for only a fully upgraded product', () => {
    const { result } = renderSeededGame({
      cash: 200_000,
      production: {
        ...createBaseGameState(0).production,
        weed: { stock: 0, producersOwned: 0, purchasedUpgradeIds: ['fertilizer', 'hydroponics'] },
      },
    });

    act(() => result.current.unlockBulkSelling('weed'));

    expect(result.current.state.bulkUnlockedProductIds).toEqual(['weed']);
    expect(result.current.state.cash).toBeCloseTo(58_408);
  });

  it('blocks a second manual bulk sale during the cooldown', () => {
    const { result } = renderSeededGame({
      bulkUnlockedProductIds: ['weed'],
      lastBulkSellAt: 0,
      production: {
        ...createBaseGameState(1_000).production,
        weed: { stock: 1_500, producersOwned: 0, purchasedUpgradeIds: [] },
      },
    });

    act(() => result.current.bulkSellProduct('weed'));
    const cashAfterFirstSale = result.current.state.cash;

    act(() => result.current.bulkSellProduct('weed'));

    expect(result.current.state.cash).toBe(cashAfterFirstSale);
    expect(result.current.state.production.weed.stock).toBe(500);
  });

  it('does not simulate or show a summary for less than 30 seconds away on mount', () => {
    const now = Date.now();
    const base = createBaseGameState(now);
    const { result } = renderSeededGame({
      cash: 100,
      lastTickAt: now - 29_999,
      production: {
        ...base.production,
        weed: { ...base.production.weed, stock: 100 },
      },
      activeDealers: [makeReferenceDealer({ id: 'd1' })],
      activeMarketEvent: { productId: 'weed', multiplier: 4, endsAt: now + 100_000 },
      nextMarketCheckAt: now - 30_000,
    });

    expect(result.current.state.cash).toBe(100);
    expect(result.current.state.production.weed.stock).toBe(100);
    expect(result.current.state.offlineEarningsSummary).toBeNull();
    expect(result.current.state.lastTickAt).toBe(now);
  });

  it('applies offline progress once on mount with capped summary and no random clocks', () => {
    const now = Date.now();
    const base = createBaseGameState(now);
    const { result } = renderSeededGame({
      cash: 100,
      lastTickAt: now - 7 * 24 * 60 * 60 * 1000,
      production: {
        ...base.production,
        weed: { ...base.production.weed, producersOwned: 100 },
      },
      muscleOwned: {
        ...base.muscleOwned,
        hoodRat: 1,
      },
      activeDealers: [makeReferenceDealer({ id: 'd1' })],
      activeMarketEvent: { productId: 'weed', multiplier: 4, endsAt: now + 100_000 },
      nextMarketCheckAt: now - 30_000,
      nextRiskCheckAt: now - 30_000,
      runEarnings: 1_000_000,
    });

    expect(result.current.state.cash).toBeGreaterThan(100);
    expect(result.current.state.respect).toBeCloseTo(24 * 60 * 60);
    expect(result.current.state.offlineEarningsSummary).toMatchObject({
      actualAwayMs: 7 * 24 * 60 * 60 * 1000,
      simulatedMs: 24 * 60 * 60 * 1000,
    });
    expect(result.current.state.activeMarketEvent).toBeNull();
    expect(result.current.state.activeDealers[0]?.isArrested).toBe(false);
    expect(result.current.state.nextMarketCheckAt).toBe(now + 30_000);
    expect(result.current.state.nextRiskCheckAt).toBe(now + 30_000);
  });

  it('applies a market multiplier only until it expires during a delayed tick', () => {
    const now = Date.now();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1);
    const base = createBaseGameState(now);
    const { result } = renderSeededGame({
      cash: 100,
      production: {
        ...base.production,
        weed: { ...base.production.weed, stock: 1_000 },
      },
      activeDealers: [makeReferenceDealer({ id: 'delayed-tick-dealer' })],
      activeMarketEvent: { productId: 'weed', multiplier: 4, endsAt: now + 30_000 },
      nextMarketCheckAt: now + 120_000,
      nextRiskCheckAt: now + 120_000,
    });

    act(() => vi.advanceTimersByTime(60_000));
    randomSpy.mockRestore();

    expect(result.current.state.cash).toBeCloseTo(1_990);
    expect(result.current.state.activeMarketEvent).toBeNull();
  });

  it('dismisses only the offline earnings summary', () => {
    const now = Date.now();
    const { result } = renderSeededGame({
      cash: 4321,
      respect: 123,
      offlineEarningsSummary: {
        actualAwayMs: 60_000,
        simulatedMs: 60_000,
        cashEarned: 400,
        respectEarned: 60,
      },
      lastTickAt: now,
    });

    act(() => result.current.dismissOfflineEarningsSummary());

    expect(result.current.state.offlineEarningsSummary).toBeNull();
    expect(result.current.state.cash).toBe(4321);
    expect(result.current.state.respect).toBe(123);
  });

  it('applies offline progress when importing an aged save', () => {
    vi.setSystemTime(60_000);
    const { result } = renderHook(() => useGameEngine());

    const imported = createBaseGameState(0);
    imported.production.weed.producersOwned = 100;
    imported.muscleOwned.hoodRat = 1;
    imported.activeDealers = [makeReferenceDealer({ id: 'imported-dealer' })];

    act(() => result.current.importGame(imported));

    expect(result.current.state.cash).toBeGreaterThan(imported.cash);
    expect(result.current.state.respect).toBeCloseTo(60);
    expect(result.current.state.lastTickAt).toBe(60_000);
    expect(result.current.state.offlineEarningsSummary).toMatchObject({
      actualAwayMs: 60_000,
      simulatedMs: 60_000,
    });
  });

  it('keeps the offline summary on the first StrictMode mount pass', () => {
    vi.setSystemTime(60_000);
    const seeded = createBaseGameState(0);
    seeded.production.weed.producersOwned = 100;
    seeded.muscleOwned.hoodRat = 1;
    seeded.activeDealers = [makeReferenceDealer({ id: 'strict-mode-dealer' })];
    localStorage.setItem(NEON_D_SAVE_KEY, JSON.stringify(seeded));

    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(StrictMode, null, children);

    const { result } = renderHook(() => useGameEngine(), { wrapper });

    expect(result.current.state.cash).toBeGreaterThan(seeded.cash);
    expect(result.current.state.respect).toBeCloseTo(60);
    expect(result.current.state.offlineEarningsSummary).toMatchObject({
      actualAwayMs: 60_000,
      simulatedMs: 60_000,
    });
  });

  it('shows the first Captain progression at $7.5M and buys at a $7.5M price', () => {
    const { result } = renderSeededGame({
      cash: 7_500_000,
      runEarnings: 7_500_000,
    });

    act(() => result.current.buyCaptain());

    expect(result.current.state.captains).toHaveLength(1);
    expect(result.current.state.captains[0]).toMatchObject({
      selling: 'weed',
      equipmentIds: [],
      personalEarnings: 0,
    });
    expect(result.current.state.cash).toBe(100);
    expect(result.current.state.runEarnings).toBe(0);
    expect(result.current.state.respect).toBe(0);
    expect(result.current.state.unlockedProducts).toEqual(['weed']);
    expect(result.current.state.territoryLevel).toBe(0);
    expect(result.current.state.discountLevel).toBe(0);
    expect(result.current.state.activeDealers).toEqual([null]);
  });

  it('uses current cash as Captain progress and keeps the panel unlocked after hiring', () => {
    const { result } = renderSeededGame({
      cash: 7_500_000,
      runEarnings: 7_500_000,
    });

    act(() => result.current.buyCaptain());

    expect(result.current.state.captains).toHaveLength(1);
    expect(result.current.state.runEarnings).toBe(0);
  });

  it('requires a claim before earnings can progress the following Captain level', () => {
    const { result } = renderSeededGame({
      captains: [makeReferenceCaptain({
        id: 'captain-levels',
        personalEarnings: 1_000_000,
        lastLevelUpEarnings: 0,
      })],
    });

    act(() => result.current.claimCaptainLevel('captain-levels'));
    expect(result.current.state.captains[0]).toMatchObject({
      level: 1,
      talentPoints: 1,
      lastLevelUpEarnings: 1_000_000,
      ledgerUnlocked: true,
    });

    act(() => result.current.claimCaptainLevel('captain-levels'));
    expect(result.current.state.captains[0].level).toBe(1);
    expect(result.current.state.captains[0].talentPoints).toBe(1);

    act(() => result.current.claimCaptainLevel('captain-levels'));
    expect(result.current.state.captains[0].level).toBe(1);
  });

  it('claims Level 2 only after the Level 1 baseline has gained the next increment', () => {
    const { result } = renderSeededGame({
      captains: [makeReferenceCaptain({
        id: 'captain-level-two',
        level: 1,
        personalEarnings: 1_200_000,
        lastLevelUpEarnings: 750_000,
        talentPoints: 1,
        ledgerUnlocked: true,
      })],
    });

    act(() => result.current.claimCaptainLevel('captain-level-two'));

    expect(result.current.state.captains[0]).toMatchObject({
      level: 2,
      talentPoints: 2,
      lastLevelUpEarnings: 1_200_000,
    });
  });

  it('only purchases a gated talent when one unspent point is available', () => {
    const { result } = renderSeededGame({
      captains: [makeReferenceCaptain({
        id: 'captain-talents',
        level: 3,
        talentPoints: 1,
        ledgerUnlocked: true,
        talentRanks: { red: [2, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
      })],
    });

    act(() => result.current.purchaseCaptainTalent('captain-talents', 'red', 1));
    expect(result.current.state.captains[0].talentRanks.red).toEqual([2, 1, 0]);
    expect(result.current.state.captains[0].talentPoints).toBe(0);

    act(() => result.current.purchaseCaptainTalent('captain-talents', 'yellow', 1));
    expect(result.current.state.captains[0].talentRanks.yellow).toEqual([0, 0, 0]);
  });

  it('makes Kingpin optional and promotes only after a completed lane and point 10', () => {
    const { result } = renderSeededGame({
      captains: [makeReferenceCaptain({
        id: 'captain-kingpin',
        personalEarnings: 161_340_000,
        level: 9,
        talentPoints: 0,
        ledgerUnlocked: true,
        talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
      })],
    });

    act(() => result.current.claimCaptainLevel('captain-kingpin'));
    expect(result.current.state.captains[0]).toMatchObject({
      level: 10,
      talentPoints: 1,
      kingpinAvailable: true,
    });

    act(() => result.current.promoteCaptain('captain-kingpin'));
    expect(result.current.state.captains).toEqual([]);
    expect(result.current.state.kingpins).toBe(1);
  });

  it('preserves existing Captains and Kingpins across a later Captain reset', () => {
    const existingCaptain = makeReferenceCaptain({
      id: 'captain-existing',
      name: 'Captain Existing',
      personalEarnings: 1_000_000,
    });

    const { result } = renderSeededGame({
      cash: 10_000_000,
      runEarnings: 7_500_000,
      captains: [existingCaptain],
      kingpins: 1,
    });

    act(() => result.current.buyCaptain());

    expect(result.current.state.captains).toHaveLength(2);
    expect(result.current.state.captains[0]).toEqual(existingCaptain);
    expect(result.current.state.kingpins).toBe(1);
  });

  it('round-trips a later Captain reset when an existing Captain sells a non-Weed product', () => {
    const existingCaptain = makeReferenceCaptain({
      id: 'captain-existing',
      name: 'Captain Existing',
      selling: 'mushrooms',
      personalEarnings: 1_000_000,
    });

    const { result } = renderSeededGame({
      cash: 10_000_000,
      runEarnings: 7_500_000,
      unlockedProducts: ['weed', 'mushrooms'],
      captains: [existingCaptain],
    });

    act(() => result.current.buyCaptain());

    expect(parseNeonDSave(serializeNeonDSave(result.current.state))).toEqual(result.current.state);
    expect(result.current.state.captains.every((captain) =>
      result.current.state.unlockedProducts.includes(captain.selling),
    )).toBe(true);
  });

  it('charges the next Captain from the owned-count schedule before discount', () => {
    const existingCaptain = makeReferenceCaptain({
      id: 'captain-existing',
      name: 'Captain Existing',
      personalEarnings: 0,
    });
    const expectedCost = 10_000_000 * 0.9;

    const { result } = renderSeededGame({
      cash: expectedCost,
      runEarnings: 7_500_000,
      captains: [existingCaptain],
      kingpins: 1,
      discountLevel: 1,
    });

    expect(getCaptainCost(result.current.state)).toBeCloseTo(expectedCost);
    act(() => result.current.buyCaptain());
    expect(result.current.state.captains).toHaveLength(2);
    expect(result.current.state.cash).toBe(100);
  });

  it('promotes a Captain by fully resetting the run and retaining the Kingpin prestige', () => {
    const { result } = renderSeededGame({
      cash: 99_999,
      runEarnings: 88_888,
      unlockedProducts: ['weed', 'mushrooms'],
      territoryLevel: 3,
      discountLevel: 2,
      activeDealers: [makeReferenceDealer({ id: 'active-before-reset' })],
      availableDealers: [makeReferenceDealer({ id: 'candidate-before-reset' })],
      production: {
        ...createBaseGameState(0).production,
        weed: { stock: 42, producersOwned: 2, purchasedUpgradeIds: [] },
      },
      captains: [
        makeReferenceCaptain({
          id: 'captain-10',
          name: 'Captain Ten',
          personalEarnings: 161_340_000,
          level: 10,
          talentPoints: 1,
          talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
          ledgerUnlocked: true,
          kingpinAvailable: true,
        }),
        makeReferenceCaptain({ id: 'captain-existing', name: 'Captain Existing' }),
      ],
      kingpins: 1,
    });

    act(() => result.current.promoteCaptain('captain-10'));

    expect(result.current.state.captains).toEqual([]);
    expect(result.current.state.kingpins).toBe(2);
    expect(result.current.state.cash).toBe(STARTING_CASH);
    expect(result.current.state.runEarnings).toBe(0);
    expect(result.current.state.unlockedProducts).toEqual(['weed']);
    expect(result.current.state.activeDealers).toEqual([null]);
    expect(result.current.state.production.weed.producersOwned).toBe(0);
    expect(result.current.state.production.weed.stock).toBe(0);
    expect(result.current.state.territoryLevel).toBe(0);
    expect(result.current.state.discountLevel).toBe(0);
    expect(result.current.state.availableDealers).toHaveLength(3);
  });

  it('keeps Kingpin bonuses permanent through the next Captain reset', () => {
    const { result } = renderSeededGame({
      cash: 20_000_000,
      runEarnings: 20_000_000,
      captains: [makeReferenceCaptain({
        id: 'captain-10',
        name: 'Captain Ten',
        personalEarnings: 161_340_000,
        level: 10,
        talentPoints: 1,
        talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
        ledgerUnlocked: true,
        kingpinAvailable: true,
      })],
    });

    act(() => result.current.promoteCaptain('captain-10'));
    expect(result.current.state.kingpins).toBe(1);

    const withKingpin: GameState = {
      ...result.current.state,
      production: {
        ...result.current.state.production,
        weed: { ...result.current.state.production.weed, producersOwned: 1 },
      },
    };
    const zeroKingpin: GameState = {
      ...withKingpin,
      kingpins: 0,
      production: {
        ...withKingpin.production,
        weed: { ...withKingpin.production.weed },
      },
    };

    expect(getProductProductionRate(withKingpin, 'weed')).toBeCloseTo(
      getProductProductionRate(zeroKingpin, 'weed') * 2,
    );
    expect(getRespectMultiplier(withKingpin)).toBeCloseTo(2);
    expect(getRecruitmentRefreshMs(withKingpin.kingpins)).toBe(59_000);

    act(() => result.current.buyCaptain());
    expect(result.current.state.cash).toBe(100);
    expect(result.current.state.unlockedProducts).toEqual(['weed']);
    expect(result.current.state.territoryLevel).toBe(0);
    expect(result.current.state.kingpins).toBe(1);
  });

  it('charges Captains four times equipment base price and prevents duplicate purchases', () => {
    const { result } = renderSeededGame({
      cash: 2_000,
      captains: [{
        id: 'captain-equipment',
        name: 'Captain Equipment',
        selling: 'weed',
        equipmentIds: [],
        personalEarnings: 0,
        lastLevelUpEarnings: 0,
        level: 0,
        talentPoints: 0,
        talentRanks: { red: [0, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
        ledgerUnlocked: false,
        kingpinAvailable: false,
      }],
    });

    act(() => result.current.buySellerEquipment(
      'captain-equipment',
      'baseballBat',
      'captain',
    ));
    expect(result.current.state.cash).toBeCloseTo(1_400);
    expect(result.current.state.captains[0].equipmentIds).toEqual(['baseballBat']);

    act(() => result.current.buySellerEquipment(
      'captain-equipment',
      'baseballBat',
      'captain',
    ));
    expect(result.current.state.cash).toBeCloseTo(1_400);
    expect(result.current.state.captains[0].equipmentIds).toEqual(['baseballBat']);
  });

  it('buys product upgrades sequentially and applies their listed cost', () => {
    const { result } = renderSeededGame({ cash: 1_000 });
    act(() => result.current.buyProductUpgrade('weed', 'fertilizer'));
    expect(result.current.state.cash).toBe(500);
    expect(result.current.state.production.weed.purchasedUpgradeIds).toEqual(['fertilizer']);

    act(() => result.current.buyProductUpgrade('weed', 'fertilizer'));
    expect(result.current.state.production.weed.purchasedUpgradeIds).toEqual(['fertilizer']);
  });

  it('buys the first Hood Rat for $80 and generates 1 Respect per second', () => {
    const { result } = renderHook(() => useGameEngine());

    act(() => result.current.buyMuscleWorker('hoodRat'));
    expect(result.current.state.cash).toBeCloseTo(20);
    expect(result.current.state.muscleOwned.hoodRat).toBe(1);

    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.state.respect).toBeCloseTo(5);
  });

  it('buys Territory with Respect and adds exactly one normal dealer slot', () => {
    const { result } = renderSeededGame({ respect: 500 });

    act(() => result.current.buyTerritory());
    expect(result.current.state.respect).toBeCloseTo(0);
    expect(result.current.state.territoryLevel).toBe(1);
    expect(result.current.state.activeDealers).toHaveLength(2);
  });

  it('buys Discount with Respect and lowers the next eligible producer price by 10 percent', () => {
    const { result } = renderSeededGame({ respect: 1_000 });

    act(() => result.current.buyDiscount());
    expect(result.current.state.discountLevel).toBe(1);
    expect(getProducerCost('weed', 0, 1)).toBeCloseTo(13.5);
  });

  it('hires a candidate for free into an open Territory slot', () => {
    const { result } = renderHook(() => useGameEngine());
    const candidate = result.current.state.availableDealers[0];
    const cashBefore = result.current.state.cash;

    act(() => result.current.hireDealer(candidate.id, 0));

    expect(result.current.state.cash).toBe(cashBefore);
    expect(result.current.state.activeDealers[0]?.id).toBe(candidate.id);
  });

  it('automatically refreshes a pool of three after 60 seconds with no Kingpins', () => {
    const { result } = renderHook(() => useGameEngine());
    const beforeIds = result.current.state.availableDealers.map((d) => d.id);

    act(() => vi.advanceTimersByTime(59_000));
    expect(result.current.state.availableDealers.map((d) => d.id)).toEqual(beforeIds);

    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.state.availableDealers).toHaveLength(3);
    expect(result.current.state.availableDealers.map((d) => d.id)).not.toEqual(beforeIds);
  });

  it('buys a fixed equipment item once and charges its listed discounted price', () => {
    const { result } = renderSeededGame({
      cash: 1_000,
      activeDealers: [makeReferenceDealer({ id: 'd1' })],
    });

    act(() => result.current.buySellerEquipment('d1', 'baseballBat', 'dealer'));
    expect(result.current.state.activeDealers[0]?.equipmentIds).toContain('baseballBat');

    const cashAfterFirstPurchase = result.current.state.cash;
    act(() => result.current.buySellerEquipment('d1', 'baseballBat', 'dealer'));
    expect(result.current.state.cash).toBe(cashAfterFirstPurchase);
  });

  it('toggles dealer protection without changing the dealer risk schedule', () => {
    const { result } = renderSeededGame({
      activeDealers: [makeReferenceDealer({ id: 'd1' })],
      nextRiskCheckAt: 30_000,
    });

    act(() => result.current.toggleDealerProtection('d1'));

    expect(result.current.state.activeDealers[0]?.isProtected).toBe(true);
    expect(result.current.state.nextRiskCheckAt).toBe(30_000);
  });

  it('bail charges 95 seconds of that dealer earnings snapshot', () => {
    const { result } = renderSeededGame({
      cash: 10_000,
      activeDealers: [
        makeReferenceDealer({
          id: 'arrested',
          isArrested: true,
          earningsPerSecondAtArrest: 20,
        }),
      ],
    });

    act(() => result.current.payDealerBail('arrested'));
    expect(result.current.state.cash).toBeCloseTo(10_000 - 1_900);
    expect(result.current.state.activeDealers[0]?.isArrested).toBe(false);
  });
});
