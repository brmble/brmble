import type { ProductUpgradeCategory, ProductUpgradeState, ProductUpgradeTrack } from './types';

export const PRODUCT_UPGRADE_CATEGORIES: ProductUpgradeCategory[] = [
  'PURITY',
  'AUTOMATION',
  'CONCEALMENT',
  'DISTRIBUTION',
];

const MAX_LEVELS: Record<ProductUpgradeCategory, number> = {
  PURITY: 3,
  AUTOMATION: 3,
  CONCEALMENT: 3,
  DISTRIBUTION: 2,
};

const BASE_COSTS: Record<ProductUpgradeCategory, number> = {
  PURITY: 1_000,
  AUTOMATION: 1_500,
  CONCEALMENT: 2_000,
  DISTRIBUTION: 5_000,
};

export const createDefaultProductUpgradeTrack = (category: ProductUpgradeCategory): ProductUpgradeTrack => ({
  category,
  level: 0,
  maxLevel: MAX_LEVELS[category],
});

export const createDefaultProductUpgradeState = (productIds: string[]): ProductUpgradeState =>
  productIds.reduce<ProductUpgradeState>((state, productId) => {
    state[productId] = PRODUCT_UPGRADE_CATEGORIES.reduce(
      (tracks, category) => ({
        ...tracks,
        [category]: createDefaultProductUpgradeTrack(category),
      }),
      {} as ProductUpgradeState[string],
    );
    return state;
  }, {});

export const getProductUpgradeCost = (category: ProductUpgradeCategory, currentLevel: number) =>
  Math.floor(BASE_COSTS[category] * Math.pow(4, currentLevel));

export const upgradeProductTrack = (
  state: ProductUpgradeState,
  productId: string,
  category: ProductUpgradeCategory,
): ProductUpgradeState => {
  const productTracks = state[productId];
  const track = productTracks?.[category];
  if (!track || track.level >= track.maxLevel) return state;

  return {
    ...state,
    [productId]: {
      ...productTracks,
      [category]: {
        ...track,
        level: track.level + 1,
      },
    },
  };
};

const getTrackLevel = (state: ProductUpgradeState, productId: string, category: ProductUpgradeCategory) =>
  state[productId]?.[category]?.level ?? 0;

export const getProductPriceMultiplier = (state: ProductUpgradeState, productId: string) =>
  1 + getTrackLevel(state, productId, 'PURITY') * 0.12;

export const getProductProductionMultiplier = (state: ProductUpgradeState, productId: string) =>
  1 + getTrackLevel(state, productId, 'AUTOMATION') * 0.20;

export const getProductRiskMultiplier = (state: ProductUpgradeState, productId: string) =>
  Math.max(0.2, 1 - getTrackLevel(state, productId, 'CONCEALMENT') * 0.10);

export const getProductDistributionMultiplier = (state: ProductUpgradeState, productId: string) =>
  1 + getTrackLevel(state, productId, 'DISTRIBUTION') * 0.15;
