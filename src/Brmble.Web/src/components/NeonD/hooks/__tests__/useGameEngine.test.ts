import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBaseGameState, NEON_D_SAVE_KEY } from '../../constants';
import { getProducerCost } from '../../economy';
import type { GameState } from '../../types';
import { makeReferenceDealer } from '../../__tests__/testFixtures';
import { useGameEngine } from '../useGameEngine';

const renderSeededGame = (overrides: Partial<GameState>) => {
  const now = Date.now();
  const state: GameState = {
    ...createBaseGameState(now),
    ...overrides,
    lastTickAt: now,
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

  it('does not read the legacy v1 save key', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({ cash: 999_999 }));
    const { result } = renderHook(() => useGameEngine());
    expect(result.current.state.cash).toBe(100);
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
});
