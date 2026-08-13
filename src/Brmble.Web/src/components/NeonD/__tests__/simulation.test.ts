import { describe, expect, it } from 'vitest';
import { createBaseGameState } from '../constants';
import { getCaptainLevel } from '../economy';
import {
  advanceDeterministicState,
  applyOfflineProgress,
  applyDueRiskCheck,
  applyMarketClock,
  getProductSalesRates,
  sellBulkOverflow,
} from '../simulation';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';

describe('deterministic production', () => {
  it('does not simulate or show a summary for less than 30 seconds away', () => {
    const state = createBaseGameState(0);
    state.production.weed.producersOwned = 1;
    state.lastTickAt = 0;

    const next = applyOfflineProgress(state, 29_999);

    expect(next.production.weed.stock).toBe(0);
    expect(next.offlineEarningsSummary).toBeNull();
    expect(next.lastTickAt).toBe(29_999);
  });

  it('simulates production, sales, cash, and Respect after 30 seconds away', () => {
    const state = createBaseGameState(0);
    state.production.weed.producersOwned = 100;
    state.muscleOwned.hoodRat = 1;
    state.activeDealers = [makeReferenceDealer({
      id: 'offline-dealer',
      volumeMultiplier: 1,
      marginMultiplier: 1,
    })];

    const next = applyOfflineProgress(state, 60_000);

    expect(next.cash).toBeGreaterThan(state.cash);
    expect(next.respect).toBeCloseTo(60);
    expect(next.offlineEarningsSummary).toMatchObject({
      actualAwayMs: 60_000,
      simulatedMs: 60_000,
    });
    expect(next.offlineEarningsSummary!.cashEarned).toBeGreaterThan(0);
    expect(next.offlineEarningsSummary!.respectEarned).toBeCloseTo(60);
  });

  it('caps a seven-day absence at exactly 24 hours', () => {
    const state = createBaseGameState(0);
    state.muscleOwned.hoodRat = 1;

    const next = applyOfflineProgress(state, 7 * 24 * 60 * 60 * 1000);

    expect(next.respect).toBeCloseTo(24 * 60 * 60);
    expect(next.offlineEarningsSummary?.simulatedMs).toBe(24 * 60 * 60 * 1000);
    expect(next.offlineEarningsSummary?.actualAwayMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('does not create offline market spikes or arrest dealers', () => {
    const state = createBaseGameState(0);
    state.runEarnings = 1_000_000;
    state.nextMarketCheckAt = 1;
    state.nextRiskCheckAt = 1;
    state.activeDealers = [makeReferenceDealer({ id: 'safe-offline' })];

    const next = applyOfflineProgress(state, 60_000);
    expect(next.activeMarketEvent).toBeNull();
    expect(next.activeDealers[0]?.isArrested).toBe(false);
  });

  it('updates Captain level during offline stepping after personal earnings cross $500,000', () => {
    const state = createBaseGameState(0);
    state.muscleOwned.hoodRat = 1;
    state.production.weed.producersOwned = 10_000;
    state.captains = [{
      id: 'captain-threshold',
      name: 'Captain Threshold',
      selling: 'weed',
      equipmentIds: [],
      personalEarnings: 499_990,
    }];

    const next = applyOfflineProgress(state, 31_000);
    const captain = next.captains[0];

    expect(captain.personalEarnings).toBeGreaterThanOrEqual(500_000);
    expect(getCaptainLevel(captain.personalEarnings)).toBe(1);
    expect(next.offlineEarningsSummary?.respectEarned).toBeGreaterThan(62);
  });

  it('manual bulk overflow sells stock down to 500g at 90 percent of street value', () => {
    const state = createBaseGameState(0);
    state.bulkUnlocked = true;
    state.production.weed.stock = 1_500;

    const next = sellBulkOverflow(state, 'weed', 10_000);

    expect(next.production.weed.stock).toBeCloseTo(500);
    expect(next.cash - state.cash).toBeCloseTo(1_000 * 4.2 * 0.90);
    expect(next.runEarnings - state.runEarnings).toBeCloseTo(1_000 * 4.2 * 0.90);
    expect(next.lastBulkSellAt).toBe(10_000);
  });

  it('blocks another manual bulk sale until the 20-minute cooldown expires', () => {
    const state = createBaseGameState(0);
    state.bulkUnlocked = true;
    state.production.weed.stock = 1_500;

    const sold = sellBulkOverflow(state, 'weed', 10_000);
    sold.production.weed.stock = 1_500;
    const blocked = sellBulkOverflow(sold, 'weed', 10_000 + 1_199_999);

    expect(blocked).toBe(sold);

    const allowed = sellBulkOverflow(sold, 'weed', 10_000 + 1_200_000);
    expect(allowed.production.weed.stock).toBe(500);
    expect(allowed.lastBulkSellAt).toBe(1_210_000);
  });

  it('does not start a cooldown when there is no overflow to sell', () => {
    const state = createBaseGameState(0);
    state.bulkUnlocked = true;
    state.production.weed.stock = 500;

    const next = sellBulkOverflow(state, 'weed', 10_000);

    expect(next).toBe(state);
    expect(next.lastBulkSellAt).toBe(0);
  });

  it('does not automatically bulk sell stock above 1500g', () => {
    const state = createBaseGameState(0);
    state.bulkUnlocked = true;
    state.production.weed.stock = 1_500;
    state.production.weed.producersOwned = 1;

    expect(advanceDeterministicState(state, 1, 1_000).production.weed.stock).toBeGreaterThan(1_500);
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

  it('Captain sells at 1.5 Volume x 3 and 1.5 Margin and accrues personal earnings', () => {
    const state = createBaseGameState(0);
    state.production.weed.producersOwned = 100;
    state.captains = [makeReferenceCaptain({ id: 'captain-1' })];

    const next = advanceDeterministicState(state, 1, 1_000);

    const expectedUnits = 1.5 * 3;
    const expectedEarnings = expectedUnits * 4.2 * 1.5;
    expect(next.lastEarningsPerSeller['captain-1']).toBeCloseTo(expectedEarnings);
    expect(next.captains[0].personalEarnings).toBeCloseTo(expectedEarnings);
  });

  it('allocates normal dealer demand before Captain demand when stock is scarce', () => {
    const state = createBaseGameState(0);
    state.production.weed.stock = 3;
    state.activeDealers = [makeReferenceDealer({ id: 'dealer-1' })];
    state.captains = [makeReferenceCaptain({ id: 'captain-1' })];

    const next = advanceDeterministicState(state, 1, 1_000);

    expect(next.lastEarningsPerSeller['dealer-1']).toBeCloseTo(12.6);
    expect(next.lastEarningsPerSeller['captain-1']).toBeCloseTo(0);
    expect(next.production.weed.stock).toBeCloseTo(0);
  });

  it('reports combined normal dealer and Captain unit demand by product', () => {
    const state = createBaseGameState(0);
    state.activeDealers = [makeReferenceDealer({ id: 'dealer-1' })];
    state.captains = [makeReferenceCaptain({ id: 'captain-1' })];

    expect(getProductSalesRates(state).weed).toBeCloseTo(3 + 4.5);
  });
});

describe('online market events', () => {
  it('does not start a market event when the 30-second check roll misses', () => {
    const state = createBaseGameState(0);
    state.nextMarketCheckAt = 30_000;

    const next = applyMarketClock(state, 30_000, () => 0.50);
    expect(next.activeMarketEvent).toBeNull();
    expect(next.nextMarketCheckAt).toBe(60_000);
  });

  it('starts one event with a 2x-5x multiplier for 60-160 seconds on a successful roll', () => {
    const state = createBaseGameState(0);
    state.nextMarketCheckAt = 30_000;
    state.unlockedProducts = ['weed', 'mushrooms'];

    const rolls = [0.05, 0.75, 0.50, 0.25];
    const next = applyMarketClock(state, 30_000, () => rolls.shift() ?? 0.5);

    expect(next.activeMarketEvent).not.toBeNull();
    expect(next.activeMarketEvent!.multiplier).toBeGreaterThanOrEqual(2);
    expect(next.activeMarketEvent!.multiplier).toBeLessThanOrEqual(5);
    expect(next.activeMarketEvent!.endsAt - 30_000).toBeGreaterThanOrEqual(60_000);
    expect(next.activeMarketEvent!.endsAt - 30_000).toBeLessThanOrEqual(160_000);
  });

  it('does not roll another event while one is active and clears it after expiry', () => {
    const state = createBaseGameState(0);
    state.activeMarketEvent = { productId: 'weed', multiplier: 4, endsAt: 90_000 };
    state.nextMarketCheckAt = 30_000;

    const active = applyMarketClock(state, 60_000, () => {
      throw new Error('rng must not be called during an active event');
    });
    expect(active.activeMarketEvent?.multiplier).toBe(4);

    const expired = applyMarketClock(active, 90_000, () => 0.5);
    expect(expired.activeMarketEvent).toBeNull();
    expect(expired.nextMarketCheckAt).toBe(120_000);
  });
});
