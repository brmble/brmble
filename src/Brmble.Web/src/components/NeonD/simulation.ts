import {
  getEffectiveStreetValue,
  getProductProductionRate,
  getRespectPerSecond,
} from './economy';
import {
  buildSecondaryDemands,
  getSellerEquipmentBonuses,
  getDealerMarginMultiplier,
  getNormalDealerMainSaleRate,
} from './dealers';
import {
  AUTO_BULK_RETAIN_STOCK,
  AUTO_BULK_TRIGGER_STOCK,
  BULK_VALUE_MULTIPLIER,
  CAPTAIN_BASE_MARGIN_MULTIPLIER,
  CAPTAIN_BASE_VOLUME_MULTIPLIER,
  MARKET_CHECK_INTERVAL_MS,
  MARKET_EVENT_CHANCE,
  MARKET_DURATION_MAX_MS,
  MARKET_DURATION_MIN_MS,
  MARKET_MULTIPLIER_MAX,
  MARKET_MULTIPLIER_MIN,
  MAIN_SALE_UNITS_PER_VOLUME,
  OFFLINE_CAP_MS,
  OFFLINE_MIN_AWAY_MS,
  PROTECTION_INCOME_MULTIPLIER,
  RISK_ATTEMPT_CHANCE,
  RISK_CHECK_INTERVAL_MS,
  RISK_LIFETIME_EARNINGS_THRESHOLD,
} from './constants';
import { PRODUCT_CATALOG } from './constants';
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

const buildCaptainDemands = (state: GameState): SaleDemand[] =>
  state.captains.flatMap((captain) => {
    const bonuses = getSellerEquipmentBonuses(captain.equipmentIds);
    const mainRate =
      CAPTAIN_BASE_VOLUME_MULTIPLIER *
      (1 + bonuses.volumeBonus) *
      MAIN_SALE_UNITS_PER_VOLUME;
    const marginMultiplier =
      CAPTAIN_BASE_MARGIN_MULTIPLIER *
      (1 + bonuses.marginBonus);

    const demands: SaleDemand[] = [{
      sellerId: captain.id,
      productId: captain.selling,
      unitsPerSecond: mainRate,
      earningsPerUnit:
        getEffectiveStreetValue(state, captain.selling) * marginMultiplier,
    }];

    buildSecondaryDemands(
      mainRate,
      bonuses.secondarySalesBonus,
      captain.selling,
      state.unlockedProducts,
    ).forEach((unitsPerSecond, productId) => {
      demands.push({
        sellerId: captain.id,
        productId,
        unitsPerSecond,
        earningsPerUnit:
          getEffectiveStreetValue(state, productId) * marginMultiplier,
      });
    });

    return demands;
  });

export const getProductSalesRates = (state: GameState): Record<ProductId, number> => {
  const rates = Object.fromEntries(
    PRODUCT_CATALOG.map((product) => [product.id, 0]),
  ) as Record<ProductId, number>;

  [
    ...buildNormalDealerDemands(state),
    ...buildCaptainDemands(state),
  ].forEach((demand) => {
    rates[demand.productId] += demand.unitsPerSecond;
  });

  return rates;
};

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
    [
      ...state.activeDealers
        .filter((dealer): dealer is NonNullable<typeof dealer> => dealer !== null)
        .map((dealer) => dealer.id),
      ...state.captains.map((captain) => captain.id),
    ].map((sellerId) => [sellerId, 0]),
  ) as Record<string, number>;
  const earnedAcrossSpanBySeller = Object.fromEntries(
    Object.keys(lastEarningsPerSeller).map((sellerId) => [sellerId, 0]),
  ) as Record<string, number>;
  let cash = state.cash;
  let runEarnings = state.runEarnings;
  const demands = [
    ...buildNormalDealerDemands(state),
    ...buildCaptainDemands(state),
  ];

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
      earnedAcrossSpanBySeller[demand.sellerId] =
        (earnedAcrossSpanBySeller[demand.sellerId] ?? 0) + earned;
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
    captains: state.captains.map((captain) => ({
      ...captain,
      personalEarnings:
        captain.personalEarnings + (earnedAcrossSpanBySeller[captain.id] ?? 0),
    })),
    lastEarningsPerSeller,
    lastTickAt: now,
  });
};

export const applyOfflineProgress = (
  state: GameState,
  now: number,
): GameState => {
  const actualAwayMs = Math.max(0, now - state.lastTickAt);

  if (actualAwayMs < OFFLINE_MIN_AWAY_MS) {
    return {
      ...state,
      lastTickAt: now,
      offlineEarningsSummary: null,
    };
  }

  const simulatedMs = Math.min(actualAwayMs, OFFLINE_CAP_MS);
  const cashBefore = state.cash;
  const respectBefore = state.respect;
  let advanced: GameState = {
    ...state,
    activeMarketEvent: null,
    offlineEarningsSummary: null,
  };
  const wholeSeconds = Math.floor(simulatedMs / 1000);

  for (let second = 0; second < wholeSeconds; second += 1) {
    advanced = advanceDeterministicState(
      advanced,
      1,
      advanced.lastTickAt + 1_000,
    );
  }

  const fractionalSeconds = (simulatedMs % 1_000) / 1_000;
  if (fractionalSeconds > 0) {
    advanced = advanceDeterministicState(
      advanced,
      fractionalSeconds,
      advanced.lastTickAt + fractionalSeconds * 1_000,
    );
  }

  return {
    ...advanced,
    lastTickAt: now,
    activeMarketEvent: null,
    nextMarketCheckAt: now + MARKET_CHECK_INTERVAL_MS,
    nextRiskCheckAt: now + RISK_CHECK_INTERVAL_MS,
    offlineEarningsSummary: {
      actualAwayMs,
      simulatedMs,
      cashEarned: advanced.cash - cashBefore,
      respectEarned: advanced.respect - respectBefore,
    },
  };
};
