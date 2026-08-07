import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import { advanceDeterministicState } from '../simulation';

describe('deterministic production', () => {
  it('produces 0.20 units per second for one Cannabis Plant', () => {
    const state = createBaseGameState(0);
    state.production.weed.producersOwned = 1;
    const next = advanceDeterministicState(state, 10, 10_000);
    expect(next.production.weed.stock).toBeCloseTo(2);
  });

  it('applies purchased product upgrades multiplicatively', () => {
    const state = createBaseGameState(0);
    state.production.weed.producersOwned = 1;
    state.production.weed.purchasedUpgradeIds = ['fertilizer', 'hydroponics'];
    const next = advanceDeterministicState(state, 10, 10_000);
    expect(next.production.weed.stock).toBeCloseTo(0.20 * 1.30 * 1.50 * 10);
  });

  it('advances Respect with the Muscle rate across a multi-hour span without per-second iteration', () => {
    const state = createBaseGameState(0);
    state.muscleOwned.hoodRat = 2;
    state.muscleOwned.youngThug = 1;

    const next = advanceDeterministicState(state, 3_600, 3_600_000);
    expect(next.respect).toBeCloseTo((2 * 1 + 1 * 5) * 3_600);
  });
});
