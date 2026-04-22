export interface ProductionItem {
  id: string;
  name: string;
  stock: number;
  rate: number;
  level: number;
  upgradeCost: number;
}

export interface Dealer {
  name: string;
  selling: string;
  volume: number;
  margin: number;
  bribeLevel: number;
}

export interface GameState {
  money: number;
  totalEarned: number;
  researchSpeed: number;
  production: Record<string, ProductionItem>;
  unlockedProduction: string[];
  dealer: Dealer | null;
}