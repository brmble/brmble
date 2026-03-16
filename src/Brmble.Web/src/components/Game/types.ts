/**
 * Bandwidth/infrastructure that can be purchased
 */
export interface Infrastructure {
  id: string;
  name: string;
  baseCost: number;
  bandwidthBytesPerSecond: number;
  owned: number;
  unlocked: boolean;
  unlockCost?: number;
  upgrade1Level: number;
  upgrade1Cost: number;
  upgrade2Level: number;
  upgrade2Cost: number;
  upgrade3Level: number;
  upgrade3Cost: number;
}

/**
 * Services that can be provided to customers
 */
export interface Service {
  id: string;
  name: string;
  baseBandwidthRequired: number;
  baseIncomePerSecond: number;
  baseCost: number;
  owned: number;
  unlocked: boolean;
  unlockRequirement: number;
}

/**
 * Main game state
 */
export interface GameState {
  money: number;
  incomePerSecond: number;
  uploadSpeed: number;
  bandwidthSold: number;
  bandwidthDemanded: number;
  infrastructure: Infrastructure[];
  services: Service[];
  lastSaved: number;
}

/**
 * Actions that can be performed on game state
 */
export interface GameActions {
  buyInfrastructure: (infrastructureId: string) => void;
  upgrade1: (infrastructureId: string) => void;
  upgrade2: (infrastructureId: string) => void;
  upgrade3: (infrastructureId: string) => void;
  unlockInfrastructure: (infrastructureId: string) => void;
  buyService: (serviceId: string) => void;
  unlockService: (serviceId: string) => void;
  setTheme: (theme: string) => void;
  saveGame: () => void;
  loadGame: () => void;
  resetGame: () => void;
  exportSave: () => string;
  importSave: (data: string) => boolean;
}

export const INITIAL_INFRASTRUCTURE: Infrastructure[] = [
  { 
    id: 'usb', 
    name: 'USB Uploader', 
    baseCost: 10, 
    bandwidthBytesPerSecond: 1024, 
    owned: 0, 
    unlocked: true, 
    upgrade1Level: 0, 
    upgrade1Cost: 50, 
    upgrade2Level: 0, 
    upgrade2Cost: 75, 
    upgrade3Level: 0, 
    upgrade3Cost: 100 
  },
  { 
    id: 'home-server', 
    name: 'Home Server', 
    baseCost: 100, 
    bandwidthBytesPerSecond: 8192, 
    owned: 0, 
    unlocked: true, 
    upgrade1Level: 0, 
    upgrade1Cost: 150, 
    upgrade2Level: 0, 
    upgrade2Cost: 225, 
    upgrade3Level: 0, 
    upgrade3Cost: 300 
  },
  { 
    id: 'server-rack', 
    name: 'Server Rack', 
    baseCost: 1100, 
    bandwidthBytesPerSecond: 48128, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 5000, 
    upgrade1Level: 0, 
    upgrade1Cost: 550, 
    upgrade2Level: 0, 
    upgrade2Cost: 825, 
    upgrade3Level: 0, 
    upgrade3Cost: 1100 
  },
  { 
    id: 'server-room', 
    name: 'Server Room', 
    baseCost: 12000, 
    bandwidthBytesPerSecond: 266240, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 50000, 
    upgrade1Level: 0, 
    upgrade1Cost: 6000, 
    upgrade2Level: 0, 
    upgrade2Cost: 9000, 
    upgrade3Level: 0, 
    upgrade3Cost: 12000 
  },
  { 
    id: 'small-dc', 
    name: 'Small Data Center', 
    baseCost: 130000, 
    bandwidthBytesPerSecond: 2097152, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 500000, 
    upgrade1Level: 0, 
    upgrade1Cost: 65000, 
    upgrade2Level: 0, 
    upgrade2Cost: 97500, 
    upgrade3Level: 0, 
    upgrade3Cost: 130000 
  },
  { 
    id: 'dc-hall', 
    name: 'Data Center Hall', 
    baseCost: 1400000, 
    bandwidthBytesPerSecond: 15728640, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 5000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 700000, 
    upgrade2Level: 0, 
    upgrade2Cost: 1050000, 
    upgrade3Level: 0, 
    upgrade3Cost: 1400000 
  },
  { 
    id: 'mega-dc', 
    name: 'Mega Data Center', 
    baseCost: 20000000, 
    bandwidthBytesPerSecond: 125829120, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 75000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 10000000, 
    upgrade2Level: 0, 
    upgrade2Cost: 15000000, 
    upgrade3Level: 0, 
    upgrade3Cost: 20000000 
  },
  { 
    id: 'hyperscale-dc', 
    name: 'Hyperscale Data Center', 
    baseCost: 330000000, 
    bandwidthBytesPerSecond: 629145600, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 1000000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 165000000, 
    upgrade2Level: 0, 
    upgrade2Cost: 247500000, 
    upgrade3Level: 0, 
    upgrade3Cost: 330000000 
  },
  { 
    id: 'global-hub', 
    name: 'Global Network Hub', 
    baseCost: 5100000000, 
    bandwidthBytesPerSecond: 4294967296, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 15000000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 2550000000, 
    upgrade2Level: 0, 
    upgrade2Cost: 3825000000, 
    upgrade3Level: 0, 
    upgrade3Cost: 5100000000 
  },
  { 
    id: 'satellite', 
    name: 'Satellite Uplink', 
    baseCost: 75000000000, 
    bandwidthBytesPerSecond: 26843545600, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 200000000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 37500000000, 
    upgrade2Level: 0, 
    upgrade2Cost: 56250000000, 
    upgrade3Level: 0, 
    upgrade3Cost: 75000000000 
  },
  { 
    id: 'orbital-dc', 
    name: 'Orbital Data Center', 
    baseCost: 1000000000000, 
    bandwidthBytesPerSecond: 171798691840, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 5000000000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 500000000000, 
    upgrade2Level: 0, 
    upgrade2Cost: 750000000000, 
    upgrade3Level: 0, 
    upgrade3Cost: 1000000000000 
  },
  { 
    id: 'quantum-grid', 
    name: 'Quantum Server Grid', 
    baseCost: 14000000000000, 
    bandwidthBytesPerSecond: 1099511627776, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 50000000000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 7000000000000, 
    upgrade2Level: 0, 
    upgrade2Cost: 10500000000000, 
    upgrade3Level: 0, 
    upgrade3Cost: 14000000000000 
  },
  { 
    id: 'planetary', 
    name: 'Planetary Internet', 
    baseCost: 170000000000000, 
    bandwidthBytesPerSecond: 7696581394432, 
    owned: 0, 
    unlocked: false, 
    unlockCost: 500000000000000, 
    upgrade1Level: 0, 
    upgrade1Cost: 85000000000000, 
    upgrade2Level: 0, 
    upgrade2Cost: 127500000000000, 
    upgrade3Level: 0, 
    upgrade3Cost: 170000000000000 
  },
];

export const INITIAL_SERVICES: Service[] = [
  { 
    id: 'website', 
    name: 'Personal Website', 
    baseBandwidthRequired: 1024, 
    baseIncomePerSecond: 1, 
    baseCost: 10,
    owned: 1, 
    unlocked: true, 
    unlockRequirement: 0
  },
  { 
    id: 'blog', 
    name: 'Blog Hosting', 
    baseBandwidthRequired: 5120, 
    baseIncomePerSecond: 4, 
    baseCost: 100,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 100
  },
  { 
    id: 'file-hosting', 
    name: 'File Hosting', 
    baseBandwidthRequired: 20480, 
    baseIncomePerSecond: 15, 
    baseCost: 1100,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 500
  },
  { 
    id: 'video-streaming', 
    name: 'Video Streaming', 
    baseBandwidthRequired: 102400, 
    baseIncomePerSecond: 90, 
    baseCost: 12000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 1000
  },
  { 
    id: 'game-downloads', 
    name: 'Game Downloads', 
    baseBandwidthRequired: 1048576, 
    baseIncomePerSecond: 900, 
    baseCost: 500000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 10000
  },
  { 
    id: 'cloud-storage', 
    name: 'Cloud Storage', 
    baseBandwidthRequired: 10485760, 
    baseIncomePerSecond: 8000, 
    baseCost: 5000000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 100000
  },
  { 
    id: 'live-streaming', 
    name: 'Live Streaming Platform', 
    baseBandwidthRequired: 52428800, 
    baseIncomePerSecond: 40000, 
    baseCost: 50000000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 500000
  },
  { 
    id: 'video-cdn', 
    name: 'Video CDN', 
    baseBandwidthRequired: 209715200, 
    baseIncomePerSecond: 180000, 
    baseCost: 1000000000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 5000000
  },
  { 
    id: 'game-servers', 
    name: 'Multiplayer Game Servers', 
    baseBandwidthRequired: 1073741824, 
    baseIncomePerSecond: 900000, 
    baseCost: 200000000000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 50000000
  },
  { 
    id: 'ai-hosting', 
    name: 'AI Model Hosting', 
    baseBandwidthRequired: 5368709120, 
    baseIncomePerSecond: 4500000, 
    baseCost: 5000000000000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 500000000
  },
  { 
    id: 'global-cdn', 
    name: 'Global CDN Network', 
    baseBandwidthRequired: 21474836480, 
    baseIncomePerSecond: 18000000, 
    baseCost: 50000000000000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 5000000000
  },
  { 
    id: 'ai-pipeline', 
    name: 'AI Training Data Pipeline', 
    baseBandwidthRequired: 107374182400, 
    baseIncomePerSecond: 90000000, 
    baseCost: 500000000000000,
    owned: 0, 
    unlocked: false, 
    unlockRequirement: 50000000000
  },
];

export const INITIAL_STATE: GameState = {
  money: 20,
  incomePerSecond: 0,
  uploadSpeed: 0,
  bandwidthSold: 0,
  bandwidthDemanded: 0,
  infrastructure: INITIAL_INFRASTRUCTURE,
  services: INITIAL_SERVICES,
  lastSaved: Date.now(),
};
