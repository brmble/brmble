export type ProductId =
  | 'weed' | 'mushrooms' | 'meth' | 'speed' | 'acid' | 'crack' | 'pcp' | 'heroin'
  | 'mdma' | 'cocaine' | 'nuke' | 'cyberCrank' | 'ephemerol' | 'sloMo' | 'drencrom' | 'melange';

export type EquipmentId =
  | 'baseballBat' | 'bicycle' | 'iphone6Plus' | 'glock17' | 'superbike'
  | 'personalAssistant' | 'armedGang' | 'ferrari458' | 'personalHelicopter'
  | 'luxurySpeedboat' | 'personalArmy';

export type MuscleWorkerId =
  | 'hoodRat' | 'youngThug' | 'hiredGoon' | 'crookedCop' | 'boughtJudge'
  | 'corruptSenator' | 'puppetWorldLeader' | 'hunterKillerSubmarine'
  | 'nimitzCarrier' | 'orbitalIonCannon';

export type TalentPathId = 'red' | 'yellow' | 'blue';
export type TalentStat = 'margin' | 'volume' | 'secondarySales';
export type TalentRanks = Record<TalentPathId, [number, number, number]>;

export interface SellerBonuses {
  marginBonus: number;
  volumeBonus: number;
  secondarySalesBonus: number;
}

export interface TalentNodeDefinition {
  path: TalentPathId;
  row: 0 | 1 | 2;
  stat: TalentStat;
  maxRanks: 2 | 3 | 4;
  rankBonuses: readonly number[];
  label: string;
}

export interface ProductUpgradeDefinition {
  id: string;
  name: string;
  baseCost: number;
  productionBonus: number;
}

export interface ProductDefinition {
  id: ProductId;
  name: string;
  researchCost: number;
  streetValue: number;
  producer: {
    name: string;
    baseCost: number;
    growth: number;
    baseRate: number;
  };
  upgrades: readonly ProductUpgradeDefinition[];
}

export interface ProductState {
  stock: number;
  producersOwned: number;
  purchasedUpgradeIds: string[];
}

export interface EquipmentDefinition {
  id: EquipmentId;
  name: string;
  baseCost: number;
  effect: {
    marginBonus?: number;
    volumeBonus?: number;
    secondarySalesBonus?: number;
  };
}

export interface MuscleWorkerDefinition {
  id: MuscleWorkerId;
  name: string;
  baseCost: number;
  respectPerSecond: number;
  growth: number;
}

export interface Dealer {
  id: string;
  name: string;
  selling: ProductId;
  volumeMultiplier: number;
  marginMultiplier: number;
  equipmentIds: EquipmentId[];
  isProtected: boolean;
  isArrested: boolean;
  earningsPerSecondAtArrest: number;
}

export interface Captain {
  id: string;
  name: string;
  selling: ProductId;
  equipmentIds: EquipmentId[];
  personalEarnings: number;
  lastLevelUpEarnings: number;
  level: number;
  talentPoints: number;
  talentRanks: TalentRanks;
  ledgerUnlocked: boolean;
  kingpinAvailable: boolean;
}

export type ActiveSeller = Dealer | Captain;

export interface MarketEvent {
  productId: ProductId;
  multiplier: number;
  endsAt: number;
}

export interface OfflineEarningsSummary {
  actualAwayMs: number;
  simulatedMs: number;
  cashEarned: number;
  respectEarned: number;
}

export interface GameState {
  schemaVersion: 5;
  cash: number;
  runEarnings: number;
  respect: number;
  production: Record<ProductId, ProductState>;
  unlockedProducts: ProductId[];
  muscleOwned: Record<MuscleWorkerId, number>;
  territoryLevel: number;
  discountLevel: number;
  activeDealers: (Dealer | Captain | null)[];
  availableDealers: Dealer[];
  lastDealerRefreshAt: number;
  captains: Captain[];
  kingpins: number;
  bulkUnlockedProductIds: ProductId[];
  lastBulkSellAt: number;
  activeMarketEvent: MarketEvent | null;
  nextMarketCheckAt: number;
  nextRiskCheckAt: number;
  lastEarningsPerSeller: Record<string, number>;
  lastTickAt: number;
  offlineEarningsSummary: OfflineEarningsSummary | null;
}
