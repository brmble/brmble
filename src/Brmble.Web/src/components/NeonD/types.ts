export interface ProductionItem {
  id: string;
  name: string;
  stock: number;
  rate: number;
  yieldPerLevel: number;
  costMultiplier: number;
  level: number;
  upgradeCost: number;
}

export type UpgradeType =
  | 'VOLUME'
  | 'MARGIN'
  | 'RISK_REDUCTION'
  | 'SIDE_HUSTLE'
  | 'ALL_AROUNDER'
  | 'BULK';

export type DealerUpgradeRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'JACKPOT';
export type DealerUpgradeTone = 'POSITIVE' | 'MIXED' | 'NEGATIVE';

export interface DealerUpgradeEffect {
  stat: 'volumeBonus' | 'marginBonus' | 'riskBonus' | 'bulkStreetValue' | 'sideVolume';
  value: number;
  label: string;
  isNegative?: boolean;
}

export interface DealerUpgrade {
  type: UpgradeType;
  rarity: DealerUpgradeRarity;
  tone: DealerUpgradeTone;
  label: string;
  description: string;
  value: number;
  effects: DealerUpgradeEffect[];
  marginPenalty?: number;
  sideVolumeValue?: number;
  sideProductId?: string;
  riskPenalty?: number;
  riskReduction?: number;
  bulkStreetValue?: number;
}

export type DealerRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Dealer {
  id: string;
  name: string;
  selling: string;
  volume: number;
  margin: number;
  volumeBonus: number;
  marginBonus: number;
  sideVolume: number;
  equipmentCount: number;
  maxEquipmentSlots: number;
  riskBonus: number;
  bulkStreetValue: number;
  baseVolumeGps: number;
  baseMarginMult: number;
  volumeStars: number;
  marginStars: number;
  isProtected: boolean;
  isArrested: boolean;
  nextArrestCheckAt: number;
  hasPendingUpgrade: boolean;
  pendingUpgradeOptions: DealerUpgrade[];
}

export type OperationUpgradeId =
  | 'betterVolumeTraining'
  | 'betterMarginTraining'
  | 'saferOperations'
  | 'bulkNetwork';

export type ProductUpgradeCategory = 'PURITY' | 'AUTOMATION' | 'CONCEALMENT' | 'DISTRIBUTION';

export interface ProductUpgradeTrack {
  category: ProductUpgradeCategory;
  level: number;
  maxLevel: number;
}

export type ProductUpgradeState = Record<string, Record<ProductUpgradeCategory, ProductUpgradeTrack>>;

export interface BulkMarketState {
  cooldownUntil: number;
  lastSaleAt: number;
}

export interface OfflineEarningsSummary {
  awayMs: number;
  earned: number;
}

export interface GameState {
  money: number;
  totalEarned: number;
  researchSpeed: number;
  production: Record<string, ProductionItem>;
  unlockedProduction: string[];
  activeDealers: (Dealer | null)[];
  availableDealers: Dealer[];
  unlockedSlots: number;
  operationUpgrades: Record<OperationUpgradeId, number>;
  productUpgrades: ProductUpgradeState;
  bulkMarket: BulkMarketState;
  lastRefreshTime: number;
  lastEarningsPerDealer: Record<string, number>;
  lastTickAt: number;
  offlineEarningsSummary: OfflineEarningsSummary | null;
}
