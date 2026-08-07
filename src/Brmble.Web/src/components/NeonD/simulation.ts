import { getEffectiveStreetValue, getProductProductionRate, getRespectPerSecond } from './economy';
import {
  buildSecondaryDemands,
  getDealerMarginMultiplier,
  getNormalDealerMainSaleRate,
  getSellerEquipmentBonuses,
} from './dealers';
import {
  AUTO_BULK_RETAIN_STOCK,
  AUTO_BULK_TRIGGER_STOCK,
  BULK_VALUE_MULTIPLIER,
  MARKET_CHECK_INTERVAL_MS,
  MARKET_EVENT_CHANCE,
  MARKET_DURATION_MAX_MS,
  MARKET_DURATION_MIN_MS,
  MARKET_MULTIPLIER_MAX,
  MARKET_MULTIPLIER_MIN,
  PROTECTION_INCOME_MULTIPLIER,
  RISK_ATTEMPT_CHANCE,
  RISK_CHECK_INTERVAL_MS,
  RISK_LIFETIME_EARNINGS_THRESHOLD,
} from './constants';
import type { GameState, ProductId } from './types';

type SaleDemand = {
  sellerId: string;
  productId: ProductId;
  unitsPerSecond: number;
  earningsPerUnit: number;
};

export const sellBulkOverflow = (
  state: GameState,
  productId: ProductId,
): GameState => {
  if (!state.bulkUnlocked || !state.unlockedProducts.includes(productId)) return state;

  const stock = state.production[productId].stock;
  const unitsToSell = Math.max(0, stock - AUTO_BULK_RETAIN_STOCK);
  if (unitsToSell <= 0) return state;

  const earned =
    unitsToSell *
    getEffectiveStreetValue(state, productId) *
    BULK_VALUE_MULTIPLIER;

  return {
    ...state,
    cash: state.cash + earned,
    runEarnings: state.runEarnings + earned,
    production: {
      ...state.production,
      [productId]: {
        ...state.production[productId],
        stock: AUTO_BULK_RETAIN_STOCK,
      },
    },
  };
};

export const applyAutoBulk = (state: GameState): GameState => {
  if (!state.bulkUnlocked || !state.autoBulkEnabled) return state;

  return state.unlockedProducts.reduce(
    (nextState, productId) => nextState.production[productId].stock > AUTO_BULK_TRIGGER_STOCK
      ? sellBulkOverflow(nextState, productId)
      : nextState,
    state,
  );
};

const rollBetween = (min: number, max: number, rng: () => number) =>
  min + rng() * (max - min);

export const applyMarketClock = (
  state: GameState,
  now: number,
  rng: () => number = Math.random,
): GameState => {
  if (state.activeMarketEvent) {
    if (now < state.activeMarketEvent.endsAt) return state;
    return {
      ...state,
      activeMarketEvent: null,
      nextMarketCheckAt: now + MARKET_CHECK_INTERVAL_MS,
    };
  }

  if (now < state.nextMarketCheckAt) return state;
  if (rng() >= MARKET_EVENT_CHANCE) {
    return { ...state, nextMarketCheckAt: now + MARKET_CHECK_INTERVAL_MS };
  }

  const productIndex = Math.floor(rng() * state.unlockedProducts.length);
  const productId = state.unlockedProducts[productIndex] ?? 'weed';
  const multiplier = rollBetween(MARKET_MULTIPLIER_MIN, MARKET_MULTIPLIER_MAX, rng);
  const durationMs = rollBetween(MARKET_DURATION_MIN_MS, MARKET_DURATION_MAX_MS, rng);

  return {
    ...state,
    activeMarketEvent: {
      productId,
      multiplier,
      endsAt: now + durationMs,
    },
  };
};

const buildNormalDealerDemands = (state: GameState): SaleDemand[] =>
  state.activeDealers.flatMap((dealer) => {
    if (!dealer || dealer.isArrested) return [];

    const bonuses = getSellerEquipmentBonuses(dealer.equipmentIds);
    const mainRate = getNormalDealerMainSaleRate(dealer);
    const protectionMultiplier = dealer.isProtected ? PROTECTION_INCOME_MULTIPLIER : 1;
    const marginMultiplier = getDealerMarginMultiplier(dealer);
    const demands: SaleDemand[] = [{
      sellerId: dealer.id,
      productId: dealer.selling,
      unitsPerSecond: mainRate,
      earningsPerUnit:
        getEffectiveStreetValue(state, dealer.selling) * marginMultiplier * protectionMultiplier,
    }];

    buildSecondaryDemands(
      mainRate,
      bonuses.secondarySalesBonus,
      dealer.selling,
      state.unlockedProducts,
    ).forEach((unitsPerSecond, productId) => {
      demands.push({
        sellerId: dealer.id,
        productId,
        unitsPerSecond,
        earningsPerUnit:
          getEffectiveStreetValue(state, productId) * marginMultiplier * protectionMultiplier,
      });
    });

    return demands;
  });

const allocateProductDemand = (
  availableUnits: number,
  seconds: number,
  demands: SaleDemand[],
) => {
  let remaining = availableUnits;
  const soldByDemand = demands.map((demand) => {
    const wanted = demand.unitsPerSecond * seconds;
    const sold = Math.min(remaining, wanted);
    remaining -= sold;
    return { demand, sold };
  });
  return { remaining, soldByDemand };
};

export const applyDueRiskCheck = (
  state: GameState,
  now: number,
  rng: () => number = Math.random,
): GameState => {
  if (now < state.nextRiskCheckAt) return state;

  const nextRiskCheckAt = now + RISK_CHECK_INTERVAL_MS;
  if (state.runEarnings < RISK_LIFETIME_EARNINGS_THRESHOLD) {
    return { ...state, nextRiskCheckAt };
  }

  if (rng() >= RISK_ATTEMPT_CHANCE) {
    return { ...state, nextRiskCheckAt };
  }

  const eligibleSlots = state.activeDealers
    .map((dealer, index) => ({ dealer, index }))
    .filter(({ dealer }) => dealer && !dealer.isArrested);

  if (eligibleSlots.length === 0) {
    return { ...state, nextRiskCheckAt };
  }

  const selected = eligibleSlots[Math.floor(rng() * eligibleSlots.length)];
  if (!selected.dealer || selected.dealer.isProtected) {
    return { ...state, nextRiskCheckAt };
  }

  const activeDealers = [...state.activeDealers];
  activeDealers[selected.index] = {
    ...selected.dealer,
    isArrested: true,
    earningsPerSecondAtArrest:
      state.lastEarningsPerSeller[selected.dealer.id] ?? 0,
  };

  return { ...state, activeDealers, nextRiskCheckAt };
};

export const advanceDeterministicState = (
  state: GameState,
  seconds: number,
  now: number,
): GameState => {
  if (seconds <= 0) return { ...state, lastTickAt: now };

  const production = { ...state.production };
  const lastEarningsPerSeller = Object.fromEntries(
    state.activeDealers
      .filter((dealer): dealer is NonNullable<typeof dealer> => dealer !== null)
      .map((dealer) => [dealer.id, 0]),
  ) as Record<string, number>;
  let cash = state.cash;
  let runEarnings = state.runEarnings;
  const demands = buildNormalDealerDemands(state);

  state.unlockedProducts.forEach((productId) => {
    const availableUnits =
      state.production[productId].stock + getProductProductionRate(state, productId) * seconds;
    const allocation = allocateProductDemand(
      availableUnits,
      seconds,
      demands.filter((demand) => demand.productId === productId),
    );

    allocation.soldByDemand.forEach(({ demand, sold }) => {
      const earned = sold * demand.earningsPerUnit;
      lastEarningsPerSeller[demand.sellerId] =
        (lastEarningsPerSeller[demand.sellerId] ?? 0) + earned / seconds;
      cash += earned;
      runEarnings += earned;
    });

    production[productId] = {
      ...production[productId],
      stock: allocation.remaining,
    };
  });

  return applyAutoBulk({
    ...state,
    cash,
    runEarnings,
    production,
    respect: state.respect + getRespectPerSecond(state) * seconds,
    lastEarningsPerSeller,
    lastTickAt: now,
  });
};
