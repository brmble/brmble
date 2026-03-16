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
  bandwidthRequired: number;
  incomePerSecond: number;
  unlocked: boolean;
  unlockRequirement: number;
  automatic: boolean;
  active: boolean;
}

/**
 * Possible reward values for upgrades
 */
export type Reward = 'Unlock Server Rack' | 'Unlock Server Room' | 'Unlock Small Data Center' | 'Unlock Blog Hosting' | 'Unlock File Hosting';

/**
 * Upgrades that can be purchased
 */
export interface Upgrade {
  id: string;
  name: string;
  description: string;
  requirement: number;
  unlocked: boolean;
  rewards: Reward[];
}

/**
 * Main game state
 */
export interface GameState {
  money: number;
  incomePerSecond: number;
  uploadSpeed: number;
  bandwidthSold: number;
  infrastructure: Infrastructure[];
  services: Service[];
  upgrades: Upgrade[];
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
  toggleService: (serviceId: string) => void;
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
    bandwidthRequired: 1024, 
    incomePerSecond: 1, 
    unlocked: true, 
    unlockRequirement: 0, 
    automatic: true, 
    active: false 
  },
  { 
    id: 'blog', 
    name: 'Blog Hosting', 
    bandwidthRequired: 5120, 
    incomePerSecond: 4, 
    unlocked: false, 
    unlockRequirement: 100, 
    automatic: true, 
    active: false 
  },
  { 
    id: 'file-hosting', 
    name: 'File Hosting', 
    bandwidthRequired: 20480, 
    incomePerSecond: 15, 
    unlocked: false, 
    unlockRequirement: 500, 
    automatic: true, 
    active: false 
  },
  { 
    id: 'video-streaming', 
    name: 'Video Streaming', 
    bandwidthRequired: 102400, 
    incomePerSecond: 90, 
    unlocked: false, 
    unlockRequirement: 1000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'game-downloads', 
    name: 'Game Downloads', 
    bandwidthRequired: 1048576, 
    incomePerSecond: 900, 
    unlocked: false, 
    unlockRequirement: 10000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'cloud-storage', 
    name: 'Cloud Storage', 
    bandwidthRequired: 10485760, 
    incomePerSecond: 8000, 
    unlocked: false, 
    unlockRequirement: 100000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'live-streaming', 
    name: 'Live Streaming Platform', 
    bandwidthRequired: 52428800, 
    incomePerSecond: 40000, 
    unlocked: false, 
    unlockRequirement: 500000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'video-cdn', 
    name: 'Video CDN', 
    bandwidthRequired: 209715200, 
    incomePerSecond: 180000, 
    unlocked: false, 
    unlockRequirement: 5000000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'game-servers', 
    name: 'Multiplayer Game Servers', 
    bandwidthRequired: 1073741824, 
    incomePerSecond: 900000, 
    unlocked: false, 
    unlockRequirement: 50000000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'ai-hosting', 
    name: 'AI Model Hosting', 
    bandwidthRequired: 5368709120, 
    incomePerSecond: 4500000, 
    unlocked: false, 
    unlockRequirement: 500000000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'global-cdn', 
    name: 'Global CDN Network', 
    bandwidthRequired: 21474836480, 
    incomePerSecond: 18000000, 
    unlocked: false, 
    unlockRequirement: 5000000000, 
    automatic: false, 
    active: false 
  },
  { 
    id: 'ai-pipeline', 
    name: 'AI Training Data Pipeline', 
    bandwidthRequired: 107374182400, 
    incomePerSecond: 90000000, 
    unlocked: false, 
    unlockRequirement: 50000000000, 
    automatic: false, 
    active: false 
  },
];

export const INITIAL_UPGRADES: Upgrade[] = [
  { 
    id: 'server-rack-unlock', 
    name: 'Unlock Server Rack', 
    description: 'Unlock Server Rack infrastructure', 
    requirement: 5000, 
    unlocked: false, 
    rewards: ['Unlock Server Rack'] 
  },
  { 
    id: 'server-room-unlock', 
    name: 'Unlock Server Room', 
    description: 'Unlock Server Room infrastructure', 
    requirement: 50000, 
    unlocked: false, 
    rewards: ['Unlock Server Room'] 
  },
  { 
    id: 'small-dc-unlock', 
    name: 'Unlock Small Data Center', 
    description: 'Unlock Small Data Center infrastructure', 
    requirement: 500000, 
    unlocked: false, 
    rewards: ['Unlock Small Data Center'] 
  },
  { 
    id: 'blog-unlock', 
    name: 'Unlock Blog Hosting', 
    description: 'Unlock Blog Hosting service', 
    requirement: 100, 
    unlocked: false, 
    rewards: ['Unlock Blog Hosting'] 
  },
  { 
    id: 'file-hosting-unlock', 
    name: 'Unlock File Hosting', 
    description: 'Unlock File Hosting service', 
    requirement: 500, 
    unlocked: false, 
    rewards: ['Unlock File Hosting'] 
  },
];

export const INITIAL_STATE: GameState = {
  money: 20,
  incomePerSecond: 0,
  uploadSpeed: 0,
  bandwidthSold: 0,
  infrastructure: INITIAL_INFRASTRUCTURE,
  services: INITIAL_SERVICES,
  upgrades: INITIAL_UPGRADES,
  lastSaved: Date.now(),
};
