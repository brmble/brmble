import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import {
  advanceDeterministicState,
  applyAutoBulk,
  applyDueRiskCheck,
  sellBulkOverflow,
} from '../simulation';
import { makeReferenceDealer } from './testFixtures';

describe('deterministic production', () => {
  it('manual bulk overflow sells stock down to 500g at 90 percent of street value', () => {
    const state = createBaseGameState(0);
    state.bulkUnlocked = true;
    state.production.weed.stock = 1_500;

    const next = sellBulkOverflow(state, 'weed');

    expect(next.production.weed.stock).toBeCloseTo(500);
    expect(next.cash - state.cash).toBeCloseTo(1_000 * 4.2 * 0.90);
    expect(next.runEarnings - state.runEarnings).toBeCloseTo(1_000 * 4.2 * 0.90);
  });

  it('auto bulk triggers only above 1500g and sells down to 500g', () => {
    const state = createBaseGameState(0);
    state.bulkUnlocked = true;
    state.autoBulkEnabled = true;
    state.production.weed.stock = 1_500;
    expect(applyAutoBulk(state).production.weed.stock).toBe(1_500);

    state.production.weed.stock = 1_500.01;
    expect(applyAutoBulk(state).production.weed.stock).toBeCloseTo(500);
  });

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

  it('allocates stocked product to a dealer and records seller earnings', () => {
    const state = createBaseGameState(0);
    state.production.weed.stock = 100;
    state.activeDealers = [makeReferenceDealer({ id: 'd1' })];

    const next = advanceDeterministicState(state, 10, 10_000);

    expect(next.production.weed.stock).toBeCloseTo(70);
    expect(next.cash).toBeCloseTo(226);
    expect(next.runEarnings).toBeCloseTo(126);
    expect(next.lastEarningsPerSeller.d1).toBeCloseTo(12.6);
  });

  it('does not roll arrest risk before $30k run earnings', () => {
    const state = createBaseGameState(0);
    state.runEarnings = 29_999;
    state.activeDealers = [makeReferenceDealer({ id: 'd1' })];
    state.nextRiskCheckAt = 30_000;

    const next = applyDueRiskCheck(state, 30_000, () => 0);
    expect(next.activeDealers[0]?.isArrested).toBe(false);
  });

  it('on a successful global roll arrests one selected unprotected normal dealer', () => {
    const state = createBaseGameState(0);
    state.runEarnings = 30_000;
    state.activeDealers = [
      makeReferenceDealer({ id: 'd1' }),
      makeReferenceDealer({ id: 'd2' }),
    ];
    state.lastEarningsPerSeller = { d1: 10, d2: 20 };
    state.nextRiskCheckAt = 30_000;

    const rolls = [0.01, 0.75];
    const next = applyDueRiskCheck(state, 30_000, () => rolls.shift() ?? 0.5);

    expect(next.activeDealers.filter((d) => d?.isArrested)).toHaveLength(1);
    expect(next.activeDealers[1]?.earningsPerSecondAtArrest).toBe(20);
  });

  it('successful selection of a protected dealer does not arrest them', () => {
    const state = createBaseGameState(0);
    state.runEarnings = 30_000;
    state.activeDealers = [makeReferenceDealer({ id: 'safe', isProtected: true })];
    state.nextRiskCheckAt = 30_000;

    const next = applyDueRiskCheck(state, 30_000, () => 0);
    expect(next.activeDealers[0]?.isArrested).toBe(false);
  });

  it('protected income is exactly 90 percent of the same unprotected sale', () => {
    const unprotected = createBaseGameState(0);
    unprotected.production.weed.stock = 100;
    unprotected.activeDealers = [
      makeReferenceDealer({ id: 'unprotected', isProtected: false }),
    ];

    const protectedState = createBaseGameState(0);
    protectedState.production.weed.stock = 100;
    protectedState.activeDealers = [
      makeReferenceDealer({ id: 'protected', isProtected: true }),
    ];

    const unprotectedNext = advanceDeterministicState(unprotected, 1, 1_000);
    const protectedNext = advanceDeterministicState(protectedState, 1, 1_000);

    const unprotectedIncome = unprotectedNext.cash - unprotected.cash;
    const protectedIncome = protectedNext.cash - protectedState.cash;
    expect(protectedIncome).toBeCloseTo(unprotectedIncome * 0.90);
  });
});
