import type {
  EquipmentDefinition,
  GameState,
  MuscleWorkerDefinition,
  ProductDefinition,
} from './types';

export const NEON_D_SAVE_KEY = 'brmble_neon_d_save_v2';
export const STARTING_CASH = 100;
export const RESEARCH_REVEAL_RATIO = 0.80;
export const NORMAL_DEALER_MIN_MULTIPLIER = 0.5;
export const NORMAL_DEALER_MAX_MULTIPLIER = 1.5;
export const MAIN_SALE_UNITS_PER_VOLUME = 3;
export const RECRUITMENT_BASE_REFRESH_MS = 60_000;
export const RECRUITMENT_KINGPIN_REDUCTION_MS = 1_000;
export const RECRUITMENT_MIN_REFRESH_MS = 1_000;
export const PROTECTION_INCOME_MULTIPLIER = 0.90;
export const RISK_LIFETIME_EARNINGS_THRESHOLD = 30_000;
export const RISK_CHECK_INTERVAL_MS = 30_000;
export const RISK_ATTEMPT_CHANCE = 0.04;
export const BAIL_EARNINGS_SECONDS = 95;
export const TERRITORY_BASE_COST = 500;
export const TERRITORY_GROWTH = 5.2;
export const DISCOUNT_BASE_COST = 1_000;
export const DISCOUNT_GROWTH = 3.8;
export const DISCOUNT_PRICE_MULTIPLIER = 0.9;
export const BULK_UNLOCK_COST = 141_592;
export const BULK_VISIBLE_EARNINGS = 212_388;
export const BULK_SELL_COOLDOWN_MS = 20 * 60 * 1000;
export const BULK_VALUE_MULTIPLIER = 0.90;
export const AUTO_BULK_RETAIN_STOCK = 500;
export const MARKET_CHECK_INTERVAL_MS = 30_000;
export const MARKET_EVENT_CHANCE = 0.10;
export const MARKET_MULTIPLIER_MIN = 2;
export const MARKET_MULTIPLIER_MAX = 5;
export const MARKET_DURATION_MIN_MS = 60_000;
export const MARKET_DURATION_MAX_MS = 160_000;
export const CAPTAIN_VISIBLE_EARNINGS = 7_500_000;
export const CAPTAIN_COSTS = [7_500_000, 10_000_000, 15_000_000] as const;
export const CAPTAIN_COST_INCREMENT = 5_000_000;
export const CAPTAIN_BASE_VOLUME_MULTIPLIER = 1.5;
export const CAPTAIN_BASE_MARGIN_MULTIPLIER = 1.5;
export const CAPTAIN_EQUIPMENT_PRICE_MULTIPLIER = 4;
export const OFFLINE_MIN_AWAY_MS = 30_000;
export const OFFLINE_CAP_MS = 24 * 60 * 60 * 1000;

const toRecord = <K extends string, V>(entries: readonly (readonly [K, V])[]) =>
  Object.fromEntries(entries) as Record<K, V>;

const upgrades = {
  weed: [
    { id: 'fertilizer', name: 'Fertilizer', baseCost: 500, productionBonus: 0.30 },
    { id: 'hydroponics', name: 'Hydroponics', baseCost: 6_500, productionBonus: 0.50 },
  ],
  mushrooms: [
    { id: 'autoHygrometer', name: 'Auto Hygrometer', baseCost: 5_000, productionBonus: 0.50 },
    { id: 'irrigationSystem', name: 'Irrigation System', baseCost: 25_000, productionBonus: 0.50 },
  ],
  meth: [
    { id: 'recreationalVehicle', name: 'Recreational Vehicle', baseCost: 40_000, productionBonus: 0.50 },
    { id: 'undergroundLab', name: 'Underground Lab', baseCost: 130_000, productionBonus: 0.50 },
  ],
  speed: [
    { id: 'corruptChemist', name: 'Corrupt Chemist', baseCost: 75_000, productionBonus: 0.60 },
    { id: 'criminalPharmacy', name: 'Criminal Pharmacy', baseCost: 190_000, productionBonus: 0.50 },
  ],
  acid: [
    { id: 'collegeEducation', name: 'College Education', baseCost: 80_000, productionBonus: 0.50 },
    { id: 'digitalDistillation', name: 'Digital Distillation', baseCost: 120_000, productionBonus: 0.50 },
  ],
  crack: [
    { id: 'gangProtection', name: 'Gang Protection', baseCost: 145_000, productionBonus: 0.50 },
    { id: 'policePayoff', name: 'Police Payoff', baseCost: 280_000, productionBonus: 0.45 },
  ],
  pcp: [
    { id: 'haberProcessResearch', name: 'Haber Process Research', baseCost: 190_000, productionBonus: 0.50 },
    { id: 'massSpectrometer', name: 'Mass Spectrometer', baseCost: 550_000, productionBonus: 0.70 },
  ],
  heroin: [
    { id: 'polytunnelComplex', name: 'Polytunnel Complex', baseCost: 210_000, productionBonus: 0.50 },
    { id: 'cropdusting', name: 'Cropdusting', baseCost: 750_000, productionBonus: 0.50 },
  ],
  mdma: [
    { id: 'phdStudents', name: 'PhD Students', baseCost: 250_000, productionBonus: 0.60 },
    { id: 'researchFacility', name: 'Research Facility', baseCost: 1_000_000, productionBonus: 0.40 },
  ],
  cocaine: [
    { id: 'plasticSurgeryDisguise', name: 'Plastic Surgery Disguise', baseCost: 350_000, productionBonus: 0.30 },
    { id: 'cartelDeal', name: 'Cartel Deal', baseCost: 1_500_000, productionBonus: 0.80 },
    { id: 'deaMole', name: 'DEA Mole', baseCost: 2_500_000, productionBonus: 0.50 },
  ],
  nuke: [
    { id: 'cultLeaderCain', name: 'Cult Leader Cain', baseCost: 14_500_000, productionBonus: 0.60 },
    { id: 'deprogrammedRobocop', name: 'Deprogrammed Robocop', baseCost: 28_000_000, productionBonus: 0.50 },
  ],
  cyberCrank: [
    { id: 'neuralNetResearch', name: 'Neural Net Research', baseCost: 45_000_000, productionBonus: 0.50 },
    { id: 'globalBotnet', name: 'Global Botnet', baseCost: 75_000_000, productionBonus: 0.45 },
  ],
  ephemerol: [
    { id: 'humanTestSubjects', name: 'Human Test Subjects', baseCost: 120_000_000, productionBonus: 0.60 },
    { id: 'conSecScanner', name: 'ConSec Scanner', baseCost: 275_000_000, productionBonus: 0.75 },
  ],
  sloMo: [{ id: 'peachtreeBlock', name: 'Peachtree Block', baseCost: 575_000_000, productionBonus: 1.00 }],
  drencrom: [{ id: 'ludovicoTechnique', name: 'The Ludovico Technique', baseCost: 575_000_000, productionBonus: 1.00 }],
  melange: [
    { id: 'guildNavigator', name: 'Guild Navigator', baseCost: 2_575_000_000, productionBonus: 0.30 },
    { id: 'muadDib', name: "Muad'Dib", baseCost: 7_900_000_000, productionBonus: 0.50 },
  ],
} as const;

export const PRODUCT_CATALOG = [
  { id: 'weed', name: 'Weed', researchCost: 0, streetValue: 4.2, producer: { name: 'Cannabis Plant', baseCost: 15, growth: 1.12, baseRate: 0.20 }, upgrades: upgrades.weed },
  { id: 'mushrooms', name: 'Magic Mushrooms', researchCost: 2_000, streetValue: 6, producer: { name: 'Mushroom Farm', baseCost: 150, growth: 1.15, baseRate: 0.30 }, upgrades: upgrades.mushrooms },
  { id: 'meth', name: 'Meth', researchCost: 7_000, streetValue: 10, producer: { name: 'Meth Cook', baseCost: 1_000, growth: 1.20, baseRate: 0.50 }, upgrades: upgrades.meth },
  { id: 'speed', name: 'Speed', researchCost: 20_000, streetValue: 15, producer: { name: 'Base Chef', baseCost: 2_500, growth: 1.21, baseRate: 0.40 }, upgrades: upgrades.speed },
  { id: 'acid', name: 'Acid', researchCost: 40_000, streetValue: 20, producer: { name: 'Lab Technician', baseCost: 5_000, growth: 1.22, baseRate: 0.50 }, upgrades: upgrades.acid },
  { id: 'crack', name: 'Crack', researchCost: 75_000, streetValue: 30, producer: { name: 'Crack Den', baseCost: 10_000, growth: 1.23, baseRate: 0.50 }, upgrades: upgrades.crack },
  { id: 'pcp', name: 'PCP', researchCost: 90_000, streetValue: 40, producer: { name: 'Chemical Lab', baseCost: 20_000, growth: 1.24, baseRate: 0.40 }, upgrades: upgrades.pcp },
  { id: 'heroin', name: 'Heroin', researchCost: 120_000, streetValue: 50, producer: { name: 'Opium Farm', baseCost: 30_000, growth: 1.25, baseRate: 0.50 }, upgrades: upgrades.heroin },
  { id: 'mdma', name: 'MDMA', researchCost: 180_000, streetValue: 60, producer: { name: 'Chemistry Professor', baseCost: 40_000, growth: 1.26, baseRate: 0.40 }, upgrades: upgrades.mdma },
  { id: 'cocaine', name: 'Cocaine', researchCost: 250_000, streetValue: 70, producer: { name: 'Drug Mule', baseCost: 50_000, growth: 1.27, baseRate: 0.25 }, upgrades: upgrades.cocaine },
  { id: 'nuke', name: 'Nuke', researchCost: 5_500_000, streetValue: 240, producer: { name: 'Robot Criminal', baseCost: 700_000, growth: 1.28, baseRate: 0.16 }, upgrades: upgrades.nuke },
  { id: 'cyberCrank', name: 'Cyber Crank', researchCost: 15_000_000, streetValue: 666.67, producer: { name: 'Blackhat Hivemind', baseCost: 2_500_000, growth: 1.29, baseRate: 0.08 }, upgrades: upgrades.cyberCrank },
  { id: 'ephemerol', name: 'Ephemerol', researchCost: 95_000_000, streetValue: 3_400, producer: { name: 'Secret Facility', baseCost: 5_000_000, growth: 1.30, baseRate: 0.04 }, upgrades: upgrades.ephemerol },
  { id: 'sloMo', name: 'Slo-mo', researchCost: 465_000_000, streetValue: 11_250, producer: { name: 'Chem-tech', baseCost: 12_000_000, growth: 1.31, baseRate: 0.02 }, upgrades: upgrades.sloMo },
  { id: 'drencrom', name: 'Drencrom', researchCost: 1_200_000_000, streetValue: 63_250, producer: { name: 'Droog Squad', baseCost: 35_000_000, growth: 1.31, baseRate: 0.015 }, upgrades: upgrades.drencrom },
  { id: 'melange', name: 'Melange', researchCost: 4_840_000_000, streetValue: 270_000, producer: { name: 'Sandworm', baseCost: 75_000_000, growth: 1.32, baseRate: 0.01 }, upgrades: upgrades.melange },
] as const satisfies readonly ProductDefinition[];

export const EQUIPMENT_CATALOG = [
  { id: 'baseballBat', name: 'Baseball Bat', baseCost: 150, effect: { marginBonus: 0.10 } },
  { id: 'bicycle', name: 'Bicycle', baseCost: 600, effect: { volumeBonus: 0.10 } },
  { id: 'iphone6Plus', name: 'iPhone 6 Plus', baseCost: 900, effect: { secondarySalesBonus: 0.10 } },
  { id: 'glock17', name: 'Glock 17', baseCost: 5_000, effect: { marginBonus: 0.20 } },
  { id: 'superbike', name: 'Superbike', baseCost: 25_000, effect: { volumeBonus: 0.20 } },
  { id: 'personalAssistant', name: 'Personal Assistant', baseCost: 85_000, effect: { secondarySalesBonus: 0.20 } },
  { id: 'armedGang', name: 'Armed Gang', baseCost: 150_000, effect: { marginBonus: 0.20 } },
  { id: 'ferrari458', name: 'Ferrari 458 Italia', baseCost: 575_000, effect: { volumeBonus: 0.30 } },
  { id: 'personalHelicopter', name: 'Personal Helicopter', baseCost: 1_890_000, effect: { volumeBonus: 0.60 } },
  { id: 'luxurySpeedboat', name: 'Luxury Speedboat', baseCost: 5_460_000, effect: { volumeBonus: 0.80 } },
  { id: 'personalArmy', name: 'Personal Army', baseCost: 21_630_000, effect: { marginBonus: 0.30 } },
] as const satisfies readonly EquipmentDefinition[];

export const MUSCLE_CATALOG = [
  { id: 'hoodRat', name: 'Hood Rat', baseCost: 80, respectPerSecond: 1, growth: 1.20 },
  { id: 'youngThug', name: 'Young Thug', baseCost: 1_000, respectPerSecond: 5, growth: 1.25 },
  { id: 'hiredGoon', name: 'Hired Goon', baseCost: 12_000, respectPerSecond: 75, growth: 1.27 },
  { id: 'crookedCop', name: 'Crooked Cop', baseCost: 130_000, respectPerSecond: 500, growth: 1.28 },
  { id: 'boughtJudge', name: 'Bought Judge', baseCost: 1_500_000, respectPerSecond: 2_000, growth: 1.30 },
  { id: 'corruptSenator', name: 'Corrupt Senator', baseCost: 4_500_000, respectPerSecond: 7_500, growth: 1.31 },
  { id: 'puppetWorldLeader', name: 'Puppet World Leader', baseCost: 33_700_000, respectPerSecond: 45_000, growth: 1.32 },
  { id: 'hunterKillerSubmarine', name: 'Hunter Killer Submarine', baseCost: 7_500_100_800, respectPerSecond: 150_000, growth: 1.33 },
  { id: 'nimitzCarrier', name: 'Nimitz-class Aircraft Carrier', baseCost: 45_500_700_000, respectPerSecond: 350_000, growth: 1.34 },
  { id: 'orbitalIonCannon', name: 'Orbital Ion Cannon', baseCost: 9_345_500_700_000, respectPerSecond: 7_490_000, growth: 1.35 },
] as const satisfies readonly MuscleWorkerDefinition[];

export const CAPTAIN_LEVEL_THRESHOLDS = [
  500_000, 950_000, 1_810_000, 3_430_000, 6_520_000,
  12_380_000, 23_520_000, 44_690_000, 84_920_000, 161_340_000,
] as const;

export const createBaseGameState = (now: number): GameState => ({
  schemaVersion: 4,
  cash: STARTING_CASH,
  runEarnings: 0,
  respect: 0,
  production: toRecord(PRODUCT_CATALOG.map((product) => [
    product.id,
    { stock: 0, producersOwned: 0, purchasedUpgradeIds: [] },
  ] as const)),
  unlockedProducts: ['weed'],
  muscleOwned: toRecord(MUSCLE_CATALOG.map((worker) => [worker.id, 0] as const)),
  territoryLevel: 0,
  discountLevel: 0,
  activeDealers: [null],
  availableDealers: [],
  lastDealerRefreshAt: now,
  captains: [],
  kingpins: 0,
  bulkUnlockedProductIds: [],
  lastBulkSellAt: now,
  activeMarketEvent: null,
  nextMarketCheckAt: now + MARKET_CHECK_INTERVAL_MS,
  nextRiskCheckAt: now + RISK_CHECK_INTERVAL_MS,
  lastEarningsPerSeller: {},
  lastTickAt: now,
  offlineEarningsSummary: null,
});
