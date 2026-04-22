export interface ProductionItem {
  id: string;
  name: string;
  stock: number;
  price: number;
  rate: number;
  level: number;
  upgradeCost: number;
}

export interface GameState {
  money: number;
  researchSpeed: number;
  production: Record<string, ProductionItem>;
  dealer: {
    name: string;
    selling: string;
    salesRate: number;
  };
}