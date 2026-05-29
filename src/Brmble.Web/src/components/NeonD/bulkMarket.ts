import type { BulkMarketState, Dealer, OperationUpgradeId } from './types';

export const canUseBulkMarket = (bulkMarket: BulkMarketState, now: number) =>
  now >= bulkMarket.cooldownUntil;

export const getBulkSaleConfig = (bulkNetworkLevel: number) => ({
  maxStock: 100 * Math.max(1, bulkNetworkLevel),
  cooldownMs: Math.max(60_000, 5 * 60_000 - bulkNetworkLevel * 30_000),
});

export const getBestBulkStreetValue = (
  activeDealers: (Dealer | null)[],
  bulkNetworkLevel: number,
) => {
  const dealerValue = activeDealers.reduce(
    (best, dealer) => Math.max(best, dealer?.bulkStreetValue ?? 0),
    0,
  );
  const networkFloor = bulkNetworkLevel > 0 ? 0.10 + bulkNetworkLevel * 0.03 : 0;
  return Math.max(dealerValue, networkFloor);
};

export const sellBulkStock = ({
  stock,
  maxStock,
  sellPrice,
  streetValuePercent,
  now,
  cooldownMs,
}: {
  stock: number;
  maxStock: number;
  sellPrice: number;
  streetValuePercent: number;
  now: number;
  cooldownMs: number;
}) => {
  const soldStock = Math.min(stock, maxStock);
  const earned = soldStock * sellPrice * streetValuePercent;

  return {
    soldStock,
    remainingStock: stock - soldStock,
    earned,
    bulkMarket: {
      lastSaleAt: now,
      cooldownUntil: now + cooldownMs,
    },
  };
};

export const formatBulkCooldown = (remainingMs: number) => {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const BULK_OPERATION_ID: OperationUpgradeId = 'bulkNetwork';
