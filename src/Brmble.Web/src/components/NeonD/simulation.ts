import {
  getEffectiveStreetValue,
  getProductProductionRate,
  getRespectPerSecond,
} from './economy';
import {
  buildSecondaryDemands,
  getSellerEquipmentBonuses,
  getCaptainBonuses,
  getCaptainMainSaleRate,
  getCaptainMarginMultiplier,
  getDealerMarginMultiplier,
  getNormalDealerMainSaleRate,
} from './dealers';
import {
  AUTO_BULK_RETAIN_STOCK,
  BULK_SELL_COOLDOWN_MS,
  BULK_VALUE_MULTIPLIER,
  MARKET_CHECK_INTERVAL_MS,
  MARKET_EVENT_CHANCE,
  MARKET_DURATION_MAX_MS,
  MARKET_DURATION_MIN_MS,
  MARKET_MULTIPLIER_MAX,
  MARKET_MULTIPLIER_MIN,
  OFFLINE_CAP_MS,
  OFFLINE_MIN_AWAY_MS,
  PROTECTION_INCOME_MULTIPLIER,
  RISK_ATTEMPT_CHANCE,
  RISK_CHECK_INTERVAL_MS,
  RISK_LIFETIME_EARNINGS_THRESHOLD,
} from './constants';
import { PRODUCT_CATALOG } from './constants';
import type { GameState, ProductId } from './types';
import { isCaptain, isDealer, syncAssignedCaptainSlots } from './sellers';

type SaleDemand = {
  sellerId: string;
  productId: ProductId;
  unitsPerSecond: number;
  earningsPerUnit: number;
};

export const sellBulkOverflow = (
  state: GameState,
  productId: ProductId,
  now: number,
): GameState => {
  if (!state.bulkUnlockedProductIds.includes(productId) || !state.unlockedProducts.includes(productId)) return state;
  const hasPreviousBulkSale = state.lastBulkSellAt > 0;
  if (hasPreviousBulkSale && now - state.lastBulkSellAt < BULK_SELL_COOLDOWN_MS) return state;

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
    lastBulkSellAt: now,
    production: {
      ...state.production,
      [productId]: {
        ...state.production[productId],
        stock: AUTO_BULK_RETAIN_STOCK,
      },
    },
  };
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
    if (!isDealer(dealer) || dealer.isArrested) return [];

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
  state.activeDealers.flatMap((seller) => {
    if (!isCaptain(seller)) return [];
    const captain = state.captains.find((ownedCaptain) => ownedCaptain.id === seller.id) ?? seller;
    const bonuses = getCaptainBonuses(captain);
    const mainRate = getCaptainMainSaleRate(captain);
    const marginMultiplier = getCaptainMarginMultiplier(captain);

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
    ...buildCaptainDemands(state),
    ...buildNormalDealerDemands(state),
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
    .filter(({ dealer }) => isDealer(dealer) && !dealer.isArrested);

  if (eligibleSlots.length === 0) {
    return { ...state, nextRiskCheckAt };
  }

  const selected = eligibleSlots[Math.floor(rng() * eligibleSlots.length)];
  if (!isDealer(selected.dealer) || selected.dealer.isProtected) {
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
        .filter((seller) => isDealer(seller) || isCaptain(seller))
        .map((dealer) => dealer.id),
    ].map((sellerId) => [sellerId, 0]),
  ) as Record<string, number>;
  const earnedAcrossSpanBySeller = Object.fromEntries(
    Object.keys(lastEarningsPerSeller).map((sellerId) => [sellerId, 0]),
  ) as Record<string, number>;
  let cash = state.cash;
  let runEarnings = state.runEarnings;
  const demands = [
    ...buildCaptainDemands(state),
    ...buildNormalDealerDemands(state),
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

  const captains = state.captains.map((captain) => ({
    ...captain,
    personalEarnings:
      captain.personalEarnings + (earnedAcrossSpanBySeller[captain.id] ?? 0),
  }));

  return {
    ...state,
    cash,
    runEarnings,
    production,
    respect: state.respect + getRespectPerSecond(state) * seconds,
    captains,
    activeDealers: syncAssignedCaptainSlots(state.activeDealers, captains),
    lastEarningsPerSeller,
    lastTickAt: now,
  };
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
  if (wholeSeconds > 0) {
    advanced = advanceDeterministicState(
      advanced,
      wholeSeconds,
      advanced.lastTickAt + wholeSeconds * 1_000,
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
