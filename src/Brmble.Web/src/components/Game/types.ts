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
 * Licenses that can be unlocked and upgraded for income generation
 */
export interface License {
  id: string;
  name: string;
  unlocked: boolean;
  level: number;
  allocated: number;
  unlockCost: number;
  baseCap: number;
  capPerLevel: number;
  incomePerKB: number;
  baseUpgradeCost: number;
}

/**
 * Main game state
 */
export interface GameState {
  money: number;
  incomePerSecond: number;
  uploadSpeed: number;
  bandwidthAllocated: number;
  infrastructure: Infrastructure[];
  licenses: License[];
  lastSaved: number;
}

/**
 * Actions that can be performed on game state
 */
export interface GameActions {
  buyInfrastructure: (infrastructureId: string) => void;
  upgradeInfrastructure: (infrastructureId: string) => void;
  unlockLicense: (licenseId: string) => void;
  upgradeLicense: (licenseId: string) => void;
  allocateBandwidth: (licenseId: string, amount: number) => void;
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

export const INITIAL_LICENSES: License[] = [
  { 
    id: 'personal-website', 
    name: 'Personal Website', 
    unlocked: true, 
    level: 0, 
    allocated: 0,
    unlockCost: 0,
    baseCap: 1024,
    capPerLevel: 1024,
    incomePerKB: 0.001,
    baseUpgradeCost: 10
  },
  { 
    id: 'blog-hosting', 
    name: 'Blog Hosting', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 100,
    baseCap: 5120,
    capPerLevel: 10240,
    incomePerKB: 0.0005,
    baseUpgradeCost: 100
  },
  { 
    id: 'file-hosting', 
    name: 'File Hosting', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 500,
    baseCap: 20480,
    capPerLevel: 102400,
    incomePerKB: 0.0004,
    baseUpgradeCost: 500
  },
  { 
    id: 'video-streaming', 
    name: 'Video Streaming', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 1000,
    baseCap: 102400,
    capPerLevel: 1048576,
    incomePerKB: 0.0003,
    baseUpgradeCost: 1000
  },
  { 
    id: 'game-downloads', 
    name: 'Game Downloads', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 10000,
    baseCap: 1048576,
    capPerLevel: 10485760,
    incomePerKB: 0.0003,
    baseUpgradeCost: 10000
  },
  { 
    id: 'cloud-storage', 
    name: 'Cloud Storage', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 100000,
    baseCap: 10485760,
    capPerLevel: 104857600,
    incomePerKB: 0.0002,
    baseUpgradeCost: 100000
  },
  { 
    id: 'live-streaming', 
    name: 'Live Streaming', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 500000,
    baseCap: 52428800,
    capPerLevel: 524288000,
    incomePerKB: 0.0002,
    baseUpgradeCost: 500000
  },
  { 
    id: 'video-cdn', 
    name: 'Video CDN', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 5000000,
    baseCap: 209715200,
    capPerLevel: 2147483648,
    incomePerKB: 0.0002,
    baseUpgradeCost: 5000000
  },
  { 
    id: 'game-servers', 
    name: 'Game Servers', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 50000000,
    baseCap: 1073741824,
    capPerLevel: 10737418240,
    incomePerKB: 0.0002,
    baseUpgradeCost: 50000000
  },
  { 
    id: 'ai-hosting', 
    name: 'AI Model Hosting', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 500000000,
    baseCap: 5368709120,
    capPerLevel: 53687091200,
    incomePerKB: 0.0002,
    baseUpgradeCost: 500000000
  },
  { 
    id: 'global-cdn', 
    name: 'Global CDN', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 5000000000,
    baseCap: 21474836480,
    capPerLevel: 214748364800,
    incomePerKB: 0.0002,
    baseUpgradeCost: 5000000000
  },
  { 
    id: 'ai-pipeline', 
    name: 'AI Pipeline', 
    unlocked: false, 
    level: 0, 
    allocated: 0,
    unlockCost: 50000000000,
    baseCap: 107374182400,
    capPerLevel: 1099511627776,
    incomePerKB: 0.0002,
    baseUpgradeCost: 50000000000
  },
];

export const INITIAL_STATE: GameState = {
  money: 20,
  incomePerSecond: 0,
  uploadSpeed: 0,
  bandwidthAllocated: 0,
  infrastructure: INITIAL_INFRASTRUCTURE,
  licenses: INITIAL_LICENSES,
  lastSaved: Date.now(),
};
