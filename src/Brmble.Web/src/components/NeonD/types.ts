export interface ProductionItem {
  id: string;
  name: string;
  stock: number;
  rate: number;
  level: number;
  upgradeCost: number;
}

export type UpgradeType = 'VOLUME' | 'MARGIN' | 'SIDE_HUSTLE' | 'NETWORK' | 'ALL_AROUNDER' | 'BULK';

export interface DealerUpgrade {
  type: UpgradeType;
  label: string;
  description: string;
  value: number;
  targetProductId?: string;
  marginPenalty?: number;
}

export interface Dealer {
  id: string;
  name: string;
  selling: string;
  volume: number;
  margin: number;
  volumeBonus: number;
  marginBonus: number;
  sideHustle: Record<string, number>;
  equipmentCount: number;
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
  lastRefreshTime: number;
}