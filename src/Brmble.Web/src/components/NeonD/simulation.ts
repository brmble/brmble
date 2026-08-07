import { getEffectiveStreetValue, getProductProductionRate, getRespectPerSecond } from './economy';
import {
  buildSecondaryDemands,
  getDealerMarginMultiplier,
  getNormalDealerMainSaleRate,
  getSellerEquipmentBonuses,
} from './dealers';
import { PROTECTION_INCOME_MULTIPLIER } from './constants';
import type { GameState, ProductId } from './types';

type SaleDemand = {
  sellerId: string;
  productId: ProductId;
  unitsPerSecond: number;
  earningsPerUnit: number;
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

  return {
    ...state,
    cash,
    runEarnings,
    production,
    respect: state.respect + getRespectPerSecond(state) * seconds,
    lastEarningsPerSeller,
    lastTickAt: now,
  };
};
