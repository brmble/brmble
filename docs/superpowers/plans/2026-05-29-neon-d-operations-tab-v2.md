# Neon-D Operations Tab V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Neon-D Operations Tab V2 MVP with richer dealer upgrade rolls, per-dealer equipment capacity upgrades, product specialization upgrades, bulk deal cooldowns, and economy regression coverage.

**Architecture:** Keep `NeonDGame.tsx` as the UI shell, but move new rules into small domain modules under `src/Brmble.Web/src/components/NeonD/` so the engine and UI do not grow into one giant condition maze. `useGameEngine.ts` remains the state coordinator, calling pure helpers for upgrade rolls, product upgrades, bulk deals, and economy calculations.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest, React Testing Library.

---

## Scope And Assumptions

The spec references a "new prijzentabel" for T1-T13 but does not include numeric values in `docs/superpowers/specs/Neon-D-New-Up.md`. The existing `TIER_DATA` in `src/Brmble.Web/src/components/NeonD/constants.ts` already claims to be from the DST economic model, so this plan treats those constants as the current research-model source of truth and adds regression tests around T1-T13 instead of inventing new numbers.

The MVP implements:
- Dealer upgrade rarity, random rolled values, mixed trade-offs, and risk reduction.
- Operations tab meta-upgrades for roll quality, safer operations, bulk network, and per-dealer slot capacity.
- Product upgrade MVP categories: Purity, Automation, Concealment, and Distribution.
- Bulk deal state, manual sale action, and cooldown display.
- UI labels for positive and negative upgrade effects.

The MVP does not implement:
- Timed random bulk deal spawn events.
- Temporary dealer downtime events.
- Product upgrade categories Branding and Packaging beyond reserved types.

## File Structure

- Modify `src/Brmble.Web/src/components/NeonD/types.ts`: add upgrade rarity/effects, operations meta-upgrade state, product upgrade state, per-dealer max equipment slots, dealer risk modifiers, and bulk market state.
- Create `src/Brmble.Web/src/components/NeonD/dealerUpgrades.ts`: own dealer upgrade definitions, rarity rolls, effect text, and apply logic.
- Create `src/Brmble.Web/src/components/NeonD/productUpgrades.ts`: own product upgrade definitions, costs, product modifiers, and apply logic.
- Create `src/Brmble.Web/src/components/NeonD/bulkMarket.ts`: own bulk deal availability, cooldown, sale math, and formatting.
- Modify `src/Brmble.Web/src/components/NeonD/economy.ts`: add product price/risk/rate calculations that include product upgrade modifiers.
- Modify `src/Brmble.Web/src/components/NeonD/constants.ts`: add operation upgrade definitions, default product upgrade state, default bulk state, and T1-T13 economy regression fixtures.
- Modify `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`: wire domain helpers into persisted state, migrations, state transitions, and exposed actions.
- Modify `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`: add Operations tab UI, upgrade option trade-off styling, product upgrade controls, bulk market panel, and per-dealer capacity display.
- Modify `src/Brmble.Web/src/components/NeonD/NeonD.module.css`: add tab layout, operation cards, rarity/effect styling, bulk cooldown, and product upgrade styles.
- Create `src/Brmble.Web/src/components/NeonD/__tests__/dealerUpgrades.test.ts`: test roll ranges, rarity weighting seams, mixed effects, risk reduction, and capacity checks.
- Create `src/Brmble.Web/src/components/NeonD/__tests__/productUpgrades.test.ts`: test product modifiers and cost progression.
- Create `src/Brmble.Web/src/components/NeonD/__tests__/bulkMarket.test.ts`: test sale value, cooldown blocking, and cooldown formatting.
- Modify `src/Brmble.Web/src/components/NeonD/__tests__/constants.test.ts`: add T1-T13 economy source-of-truth regression coverage.
- Modify `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`: add integration tests for operations upgrades, product upgrades, bulk sales, migration, and earnings.
- Modify `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`: add UI tests for Operations tab, trade-off labels, and cooldown display.

---

### Task 1: Expand Neon-D Domain Types

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/types.ts`

- [ ] **Step 1: Add type coverage for V2 systems**

Replace the upgrade-related portion of `types.ts` with this expanded model while keeping existing interfaces that are still used:

```ts
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
```

- [ ] **Step 2: Run typecheck to expose missing migrations**

Run: `npm run build`

Expected: FAIL with TypeScript errors where existing dealers and game state do not yet provide `maxEquipmentSlots`, `riskBonus`, `bulkStreetValue`, `operationUpgrades`, `productUpgrades`, and `bulkMarket`.

- [ ] **Step 3: Continue without committing**

Do not commit this task by itself. This step intentionally creates temporary type errors while the rest of the V2 defaults, helpers, and migrations are added. Commit only after the next executable slice restores a passing focused test/build state.

---

### Task 2: Add Dealer Upgrade Domain Rules

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/dealerUpgrades.ts`
- Create: `src/Brmble.Web/src/components/NeonD/__tests__/dealerUpgrades.test.ts`

- [ ] **Step 1: Write failing dealer upgrade tests**

Create `dealerUpgrades.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Dealer, OperationUpgradeId } from '../types';
import {
  applyDealerUpgrade,
  canRollDealerUpgrade,
  getDealerEquipmentUpgradeCost,
  getDealerSlotUnlockCost,
  rollDealerUpgradeOptions,
} from '../dealerUpgrades';

const makeDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'dealer-1',
  name: 'Dealer One',
  selling: 'weed',
  volume: 1,
  margin: 1,
  volumeBonus: 0,
  marginBonus: 0,
  sideVolume: 0,
  equipmentCount: 0,
  maxEquipmentSlots: 3,
  riskBonus: 0,
  bulkStreetValue: 0,
  baseVolumeGps: 1,
  baseMarginMult: 1,
  volumeStars: 3,
  marginStars: 3,
  isProtected: false,
  isArrested: false,
  nextArrestCheckAt: Date.now() + 60_000,
  hasPendingUpgrade: false,
  pendingUpgradeOptions: [],
  ...overrides,
});

const noOps: Record<OperationUpgradeId, number> = {
  betterVolumeTraining: 0,
  betterMarginTraining: 0,
  saferOperations: 0,
  bulkNetwork: 0,
};

it('blocks upgrade rolls when dealer has filled their personal equipment slots', () => {
  expect(canRollDealerUpgrade(makeDealer({ equipmentCount: 3, maxEquipmentSlots: 3 }))).toBe(false);
  expect(canRollDealerUpgrade(makeDealer({ equipmentCount: 3, maxEquipmentSlots: 4 }))).toBe(true);
});

it('rolls exactly 3 upgrade options with value ranges and effect rows', () => {
  const options = rollDealerUpgradeOptions({
    dealer: makeDealer(),
    unlockedProduction: ['weed', 'mushrooms'],
    operationUpgrades: noOps,
    random: () => 0.5,
  });

  expect(options).toHaveLength(3);
  expect(options[0].effects.length).toBeGreaterThan(0);
  expect(options[0].value).toBeGreaterThanOrEqual(0.05);
  expect(options[0].value).toBeLessThanOrEqual(0.15);
});

it('higher volume training improves volume roll ranges', () => {
  const options = rollDealerUpgradeOptions({
    dealer: makeDealer(),
    unlockedProduction: ['weed'],
    operationUpgrades: { ...noOps, betterVolumeTraining: 1 },
    random: () => 0,
  });

  expect(options[0].type).toBe('VOLUME');
  expect(options[0].value).toBeGreaterThan(0.05);
});

it('rarity changes upgrade value instead of being only cosmetic', () => {
  const common = rollDealerUpgradeOptions({
    dealer: makeDealer(),
    unlockedProduction: ['weed'],
    operationUpgrades: noOps,
    random: () => 0,
  })[0];
  const jackpot = rollDealerUpgradeOptions({
    dealer: makeDealer(),
    unlockedProduction: ['weed'],
    operationUpgrades: noOps,
    random: () => 0.99,
  })[0];

  expect(jackpot.value).toBeGreaterThan(common.value);
});

it('applies mixed upgrades with positive and negative effects', () => {
  const dealer = applyDealerUpgrade(makeDealer(), {
    type: 'VOLUME',
    rarity: 'RARE',
    tone: 'MIXED',
    label: 'Reckless Crew',
    description: 'Volume +25%, arrest risk +5%',
    value: 0.25,
    effects: [
      { stat: 'volumeBonus', value: 0.25, label: '+25% volume' },
      { stat: 'riskBonus', value: 0.05, label: '+5% arrest risk', isNegative: true },
    ],
  });

  expect(dealer.volumeBonus).toBeCloseTo(0.25, 5);
  expect(dealer.riskBonus).toBeCloseTo(0.05, 5);
  expect(dealer.equipmentCount).toBe(1);
});

it('applies risk reduction and clamps effective risk bonus from going below -90%', () => {
  const dealer = applyDealerUpgrade(makeDealer({ riskBonus: -0.88 }), {
    type: 'RISK_REDUCTION',
    rarity: 'UNCOMMON',
    tone: 'POSITIVE',
    label: 'Clean Route',
    description: 'Arrest risk -8%',
    value: 0.08,
    effects: [{ stat: 'riskBonus', value: -0.08, label: '-8% arrest risk' }],
  });

  expect(dealer.riskBonus).toBeCloseTo(-0.9, 5);
});

it('bulk upgrades only affect bulk street value, not normal volume', () => {
  const dealer = applyDealerUpgrade(makeDealer(), {
    type: 'BULK',
    rarity: 'UNCOMMON',
    tone: 'POSITIVE',
    label: 'Bulk Contacts',
    description: 'Bulk sales at 20% street value',
    value: 0.20,
    effects: [{ stat: 'bulkStreetValue', value: 0.20, label: '20% bulk street value' }],
  });

  expect(dealer.volumeBonus).toBe(0);
  expect(dealer.bulkStreetValue).toBeCloseTo(0.20, 5);
});

it('scales equipment upgrade cost by existing equipment count', () => {
  expect(getDealerEquipmentUpgradeCost(0)).toBe(500);
  expect(getDealerEquipmentUpgradeCost(1)).toBe(1250);
});

it('exposes slot unlock costs for engine and UI from one source of truth', () => {
  expect(getDealerSlotUnlockCost(3)).toBe(25_000);
  expect(getDealerSlotUnlockCost(4)).toBe(250_000);
  expect(getDealerSlotUnlockCost(5)).toBe(Number.POSITIVE_INFINITY);
});
```

- [ ] **Step 2: Run dealer upgrade tests to verify they fail**

Run: `npm run test -- src/components/NeonD/__tests__/dealerUpgrades.test.ts`

Expected: FAIL because `dealerUpgrades.ts` does not exist.

- [ ] **Step 3: Implement dealer upgrade helper**

Create `dealerUpgrades.ts`:

```ts
import type { Dealer, DealerUpgrade, DealerUpgradeEffect, DealerUpgradeRarity, OperationUpgradeId } from './types';

type RollArgs = {
  dealer: Dealer;
  unlockedProduction: string[];
  operationUpgrades: Record<OperationUpgradeId, number>;
  random?: () => number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const rollRange = (min: number, max: number, random: () => number) =>
  min + random() * (max - min);

const percent = (value: number) => `${value >= 0 ? '+' : '-'}${Math.round(Math.abs(value) * 100)}%`;

const getTrainingRange = (level: number): [number, number] => {
  if (level >= 3) return [0.15, 0.25];
  if (level === 2) return [0.10, 0.20];
  if (level === 1) return [0.075, 0.175];
  return [0.05, 0.15];
};

const rollRarity = (random: () => number): DealerUpgradeRarity => {
  const roll = random();
  if (roll < 0.65) return 'COMMON';
  if (roll < 0.90) return 'UNCOMMON';
  if (roll < 0.98) return 'RARE';
  return 'JACKPOT';
};

const RARITY_VALUE_MULTIPLIER: Record<DealerUpgradeRarity, number> = {
  COMMON: 1,
  UNCOMMON: 1.15,
  RARE: 1.35,
  JACKPOT: 1.75,
};

const applyRarityValue = (value: number, rarity: DealerUpgradeRarity, cap = 0.9) =>
  clamp(value * RARITY_VALUE_MULTIPLIER[rarity], 0, cap);

const buildVolumeUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'VOLUME',
  rarity,
  tone: 'POSITIVE',
  label: 'Street Runners',
  description: `Volume ${percent(value)}`,
  value,
  effects: [{ stat: 'volumeBonus', value, label: `${percent(value)} volume` }],
});

const buildMarginUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'MARGIN',
  rarity,
  tone: 'POSITIVE',
  label: 'Ferrari',
  description: `Margin ${percent(value)}`,
  value,
  effects: [{ stat: 'marginBonus', value, label: `${percent(value)} margin` }],
});

const buildRiskReductionUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'RISK_REDUCTION',
  rarity,
  tone: 'POSITIVE',
  label: 'Clean Route',
  description: `Arrest risk ${percent(-value)}`,
  value,
  riskReduction: value,
  effects: [{ stat: 'riskBonus', value: -value, label: `${percent(-value)} arrest risk` }],
});

const buildBulkUpgrade = (value: number, rarity: DealerUpgradeRarity): DealerUpgrade => ({
  type: 'BULK',
  rarity,
  tone: 'POSITIVE',
  label: rarity === 'JACKPOT' ? 'Black Market Network' : 'Bulk Contacts',
  description: `Bulk sales at ${Math.round(value * 100)}% street value`,
  value,
  bulkStreetValue: value,
  effects: [{ stat: 'bulkStreetValue', value, label: `${Math.round(value * 100)}% bulk street value` }],
});

const buildSideHustleUpgrade = (value: number, rarity: DealerUpgradeRarity, sideProductId: string): DealerUpgrade => ({
  type: 'SIDE_HUSTLE',
  rarity,
  tone: 'POSITIVE',
  label: 'Side Hustle',
  description: `Side volume ${percent(value)}`,
  value,
  sideVolumeValue: value,
  sideProductId,
  effects: [{ stat: 'sideVolume', value, label: `${percent(value)} side volume` }],
});

const buildMixedUpgrade = (rarity: DealerUpgradeRarity, random: () => number): DealerUpgrade => {
  const value = applyRarityValue(rollRange(0.20, 0.25, random), rarity, 0.5);
  return {
    type: 'VOLUME',
    rarity,
    tone: 'MIXED',
    label: 'Reckless Crew',
    description: `Volume ${percent(value)}, arrest risk +5%`,
    value,
    riskPenalty: 0.05,
    effects: [
      { stat: 'volumeBonus', value, label: `${percent(value)} volume` },
      { stat: 'riskBonus', value: 0.05, label: '+5% arrest risk', isNegative: true },
    ],
  };
};

export const getDealerEquipmentUpgradeCost = (equipmentCount: number) =>
  500 * Math.pow(2.5, equipmentCount);

export const getDealerSlotUnlockCost = (maxEquipmentSlots: number) => {
  const costs: Record<number, number> = { 3: 25_000, 4: 250_000 };
  return costs[maxEquipmentSlots] ?? Number.POSITIVE_INFINITY;
};

export const canRollDealerUpgrade = (dealer: Dealer) =>
  dealer.equipmentCount < dealer.maxEquipmentSlots;

export const rollDealerUpgradeOptions = ({
  dealer,
  unlockedProduction,
  operationUpgrades,
  random = Math.random,
}: RollArgs): DealerUpgrade[] => {
  const sideHustleProducts = unlockedProduction.filter(id => id !== dealer.selling);
  const options: DealerUpgrade[] = [];

  for (let i = 0; i < 3; i += 1) {
    const rarity = rollRarity(random);
    const typeRoll = random();
    const mixedRoll = random();

    if (mixedRoll < 0.20 && rarity !== 'COMMON') {
      options.push(buildMixedUpgrade(rarity, random));
      continue;
    }

    if (typeRoll < 0.20) {
      const [min, max] = getTrainingRange(operationUpgrades.betterVolumeTraining);
      options.push(buildVolumeUpgrade(applyRarityValue(rollRange(min, max, random), rarity), rarity));
    } else if (typeRoll < 0.40) {
      const [min, max] = getTrainingRange(operationUpgrades.betterMarginTraining);
      options.push(buildMarginUpgrade(applyRarityValue(rollRange(min, max, random), rarity), rarity));
    } else if (typeRoll < 0.60) {
      const saferBonus = operationUpgrades.saferOperations * 0.01;
      options.push(buildRiskReductionUpgrade(applyRarityValue(rollRange(0.03 + saferBonus, 0.08 + saferBonus, random), rarity), rarity));
    } else if (typeRoll < 0.80 && operationUpgrades.bulkNetwork > 0) {
      options.push(buildBulkUpgrade(applyRarityValue(rollRange(0.10, 0.25 + operationUpgrades.bulkNetwork * 0.05, random), rarity), rarity));
    } else if (sideHustleProducts.length > 0) {
      const sideProductId = sideHustleProducts[Math.floor(random() * sideHustleProducts.length)] ?? sideHustleProducts[0];
      options.push(buildSideHustleUpgrade(applyRarityValue(rollRange(0.05, 0.10, random), rarity), rarity, sideProductId));
    } else {
      const value = applyRarityValue(rollRange(0.03, 0.08, random), rarity);
      options.push({
        type: 'ALL_AROUNDER',
        rarity,
        tone: 'POSITIVE',
        label: 'All-Arounder',
        description: `Volume ${percent(value)}, margin ${percent(value)}`,
        value,
        effects: [
          { stat: 'volumeBonus', value, label: `${percent(value)} volume` },
          { stat: 'marginBonus', value, label: `${percent(value)} margin` },
        ],
      });
    }
  }

  return options;
};

export const applyDealerUpgrade = (dealer: Dealer, upgrade: DealerUpgrade): Dealer => {
  const totals = upgrade.effects.reduce(
    (next, effect) => ({
      ...next,
      [effect.stat]: (next[effect.stat] ?? 0) + effect.value,
    }),
    { volumeBonus: 0, marginBonus: 0, riskBonus: 0, bulkStreetValue: 0, sideVolume: 0 } as Record<DealerUpgradeEffect['stat'], number>,
  );

  return {
    ...dealer,
    volumeBonus: dealer.volumeBonus + totals.volumeBonus,
    marginBonus: dealer.marginBonus + totals.marginBonus,
    sideVolume: Math.min(0.9, dealer.sideVolume + totals.sideVolume),
    riskBonus: clamp(dealer.riskBonus + totals.riskBonus, -0.9, 1),
    bulkStreetValue: Math.max(dealer.bulkStreetValue, totals.bulkStreetValue),
    equipmentCount: dealer.equipmentCount + 1,
    hasPendingUpgrade: false,
    pendingUpgradeOptions: [],
  };
};
```

- [ ] **Step 4: Run dealer upgrade tests to verify they pass**

Run: `npm run test -- src/components/NeonD/__tests__/dealerUpgrades.test.ts`

Expected: PASS.

- [ ] **Step 5: Continue without committing**

Do not commit yet. The focused dealer upgrade tests should pass, but the expanded shared `GameState` and `Dealer` types are not fully wired through the engine/defaults until Task 7.

---

### Task 3: Add Product Upgrade Domain Rules

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/productUpgrades.ts`
- Create: `src/Brmble.Web/src/components/NeonD/__tests__/productUpgrades.test.ts`

- [ ] **Step 1: Write failing product upgrade tests**

Create `productUpgrades.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ProductUpgradeState } from '../types';
import {
  createInitialProductUpgrades,
  getProductUpgradeCost,
  getProductUpgradeModifiers,
  upgradeProductTrack,
} from '../productUpgrades';

it('creates all MVP tracks for each product id', () => {
  const state = createInitialProductUpgrades(['weed']);
  expect(state.weed.PURITY.maxLevel).toBe(3);
  expect(state.weed.AUTOMATION.maxLevel).toBe(3);
  expect(state.weed.CONCEALMENT.maxLevel).toBe(3);
  expect(state.weed.DISTRIBUTION.maxLevel).toBe(2);
});

it('applies purity, automation, concealment, and distribution modifiers', () => {
  const state: ProductUpgradeState = createInitialProductUpgrades(['weed']);
  state.weed.PURITY.level = 2;
  state.weed.AUTOMATION.level = 1;
  state.weed.CONCEALMENT.level = 3;
  state.weed.DISTRIBUTION.level = 2;

  expect(getProductUpgradeModifiers(state, 'weed')).toEqual({
    sellPriceMultiplier: 1.10,
    productionMultiplier: 1.10,
    riskBonus: -0.15,
    dealerVolumeMultiplier: 1.20,
  });
});

it('increments a product track without exceeding max level', () => {
  const state = createInitialProductUpgrades(['weed']);
  const first = upgradeProductTrack(state, 'weed', 'PURITY');
  const second = upgradeProductTrack(first, 'weed', 'PURITY');
  const third = upgradeProductTrack(second, 'weed', 'PURITY');
  const capped = upgradeProductTrack(third, 'weed', 'PURITY');

  expect(capped.weed.PURITY.level).toBe(3);
});

it('scales product upgrade cost by category and current level', () => {
  expect(getProductUpgradeCost('PURITY', 0)).toBe(750);
  expect(getProductUpgradeCost('PURITY', 1)).toBe(2250);
  expect(getProductUpgradeCost('DISTRIBUTION', 0)).toBe(600);
});
```

- [ ] **Step 2: Run product upgrade tests to verify they fail**

Run: `npm run test -- src/components/NeonD/__tests__/productUpgrades.test.ts`

Expected: FAIL because `productUpgrades.ts` does not exist.

- [ ] **Step 3: Implement product upgrade helper**

Create `productUpgrades.ts`:

```ts
import type { ProductUpgradeCategory, ProductUpgradeState, ProductUpgradeTrack } from './types';

const MVP_TRACKS: Record<ProductUpgradeCategory, { maxLevel: number; baseCost: number }> = {
  PURITY: { maxLevel: 3, baseCost: 750 },
  AUTOMATION: { maxLevel: 3, baseCost: 500 },
  CONCEALMENT: { maxLevel: 3, baseCost: 650 },
  DISTRIBUTION: { maxLevel: 2, baseCost: 600 },
};

const createTrack = (category: ProductUpgradeCategory): ProductUpgradeTrack => ({
  category,
  level: 0,
  maxLevel: MVP_TRACKS[category].maxLevel,
});

export const createInitialProductUpgrades = (productIds: string[]): ProductUpgradeState =>
  productIds.reduce<ProductUpgradeState>((state, productId) => {
    state[productId] = {
      PURITY: createTrack('PURITY'),
      AUTOMATION: createTrack('AUTOMATION'),
      CONCEALMENT: createTrack('CONCEALMENT'),
      DISTRIBUTION: createTrack('DISTRIBUTION'),
    };
    return state;
  }, {});

export const getProductUpgradeCost = (category: ProductUpgradeCategory, currentLevel: number) =>
  MVP_TRACKS[category].baseCost * Math.pow(3, currentLevel);

export const upgradeProductTrack = (
  state: ProductUpgradeState,
  productId: string,
  category: ProductUpgradeCategory,
): ProductUpgradeState => {
  const product = state[productId];
  const track = product?.[category];
  if (!product || !track || track.level >= track.maxLevel) return state;

  return {
    ...state,
    [productId]: {
      ...product,
      [category]: {
        ...track,
        level: track.level + 1,
      },
    },
  };
};

export const getProductUpgradeModifiers = (state: ProductUpgradeState, productId: string) => {
  const product = state[productId];
  return {
    sellPriceMultiplier: 1 + (product?.PURITY.level ?? 0) * 0.05,
    productionMultiplier: 1 + (product?.AUTOMATION.level ?? 0) * 0.10,
    riskBonus: -(product?.CONCEALMENT.level ?? 0) * 0.05,
    dealerVolumeMultiplier: 1 + (product?.DISTRIBUTION.level ?? 0) * 0.10,
  };
};
```

- [ ] **Step 4: Run product upgrade tests to verify they pass**

Run: `npm run test -- src/components/NeonD/__tests__/productUpgrades.test.ts`

Expected: PASS.

- [ ] **Step 5: Continue without committing**

Do not commit yet. Commit this helper with the first later slice that restores a passing build.

---

### Task 4: Add Bulk Market Rules

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/bulkMarket.ts`
- Create: `src/Brmble.Web/src/components/NeonD/__tests__/bulkMarket.test.ts`

- [ ] **Step 1: Write failing bulk market tests**

Create `bulkMarket.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BulkMarketState, Dealer } from '../types';
import {
  BULK_COOLDOWN_MS,
  canUseBulkMarket,
  formatBulkCooldown,
  getBestBulkStreetValue,
  sellBulkStock,
} from '../bulkMarket';

const dealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'dealer-1',
  name: 'Dealer One',
  selling: 'weed',
  volume: 1,
  margin: 1,
  volumeBonus: 0,
  marginBonus: 0,
  sideVolume: 0,
  equipmentCount: 0,
  maxEquipmentSlots: 3,
  riskBonus: 0,
  bulkStreetValue: 0,
  baseVolumeGps: 1,
  baseMarginMult: 1,
  volumeStars: 1,
  marginStars: 1,
  isProtected: false,
  isArrested: false,
  nextArrestCheckAt: Date.now() + 60_000,
  hasPendingUpgrade: false,
  pendingUpgradeOptions: [],
  ...overrides,
});

it('uses the best bulk street value from active dealers and operation level', () => {
  expect(getBestBulkStreetValue([dealer({ bulkStreetValue: 0.25 })], 1)).toBeCloseTo(0.25, 5);
  expect(getBestBulkStreetValue([dealer({ bulkStreetValue: 0.15 })], 3)).toBeCloseTo(0.25, 5);
});

it('blocks bulk sale while cooldown is active', () => {
  const state: BulkMarketState = { cooldownUntil: 10_000, lastSaleAt: 1_000 };
  expect(canUseBulkMarket(state, 9_999)).toBe(false);
  expect(canUseBulkMarket(state, 10_000)).toBe(true);
});

it('sells a capped amount of stock and starts cooldown', () => {
  const result = sellBulkStock({
    stock: 250,
    maxStock: 100,
    sellPrice: 4,
    streetValuePercent: 0.25,
    now: 1_000,
    cooldownMs: BULK_COOLDOWN_MS.medium,
  });

  expect(result.sold).toBe(100);
  expect(result.earned).toBe(100);
  expect(result.remainingStock).toBe(150);
  expect(result.bulkMarket.cooldownUntil).toBe(1_000 + BULK_COOLDOWN_MS.medium);
});

it('formats cooldown as minutes and seconds', () => {
  expect(formatBulkCooldown(65_000)).toBe('1:05');
});
```

- [ ] **Step 2: Run bulk market tests to verify they fail**

Run: `npm run test -- src/components/NeonD/__tests__/bulkMarket.test.ts`

Expected: FAIL because `bulkMarket.ts` does not exist.

- [ ] **Step 3: Implement bulk market helper**

Create `bulkMarket.ts`:

```ts
import type { BulkMarketState, Dealer } from './types';

export const BULK_COOLDOWN_MS = {
  small: 5 * 60 * 1000,
  medium: 15 * 60 * 1000,
  large: 30 * 60 * 1000,
  massive: 60 * 60 * 1000,
} as const;

export const BULK_SALE_STOCK_LIMITS = {
  small: 100,
  medium: 500,
  large: 2_500,
  massive: 10_000,
} as const;

export const createInitialBulkMarket = (): BulkMarketState => ({
  cooldownUntil: 0,
  lastSaleAt: 0,
});

export const canUseBulkMarket = (bulkMarket: BulkMarketState, now: number) =>
  now >= bulkMarket.cooldownUntil;

export const getBestBulkStreetValue = (dealers: (Dealer | null)[], bulkNetworkLevel: number) => {
  const dealerValue = dealers.reduce((best, dealer) => Math.max(best, dealer?.bulkStreetValue ?? 0), 0);
  const operationValue = bulkNetworkLevel > 0 ? 0.10 + bulkNetworkLevel * 0.05 : 0;
  return Math.max(dealerValue, operationValue);
};

export const getBulkSaleConfig = (bulkNetworkLevel: number) => {
  if (bulkNetworkLevel >= 3) {
    return { maxStock: BULK_SALE_STOCK_LIMITS.massive, cooldownMs: BULK_COOLDOWN_MS.massive };
  }
  if (bulkNetworkLevel === 2) {
    return { maxStock: BULK_SALE_STOCK_LIMITS.large, cooldownMs: BULK_COOLDOWN_MS.large };
  }
  if (bulkNetworkLevel === 1) {
    return { maxStock: BULK_SALE_STOCK_LIMITS.medium, cooldownMs: BULK_COOLDOWN_MS.medium };
  }
  return { maxStock: BULK_SALE_STOCK_LIMITS.small, cooldownMs: BULK_COOLDOWN_MS.small };
};

export const sellBulkStock = ({
  stock,
  maxStock,
  sellPrice,
  streetValuePercent,
  now,
  cooldownMs,
}: {
  stock: number;
  maxStock: number;
  sellPrice: number;
  streetValuePercent: number;
  now: number;
  cooldownMs: number;
}) => {
  const availableStock = Math.max(0, stock);
  const sold = Math.min(availableStock, Math.max(0, maxStock));
  return {
    sold,
    earned: sold * sellPrice * streetValuePercent,
    remainingStock: availableStock - sold,
    bulkMarket: {
      lastSaleAt: now,
      cooldownUntil: now + cooldownMs,
    },
  };
};

export const formatBulkCooldown = (remainingMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
```

- [ ] **Step 4: Run bulk market tests to verify they pass**

Run: `npm run test -- src/components/NeonD/__tests__/bulkMarket.test.ts`

Expected: PASS.

- [ ] **Step 5: Continue without committing**

Do not commit yet. Commit this helper with the first later slice that restores a passing build.

---

### Task 5: Add Constants And Economy Regression Coverage

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/constants.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/constants.test.ts`

- [ ] **Step 1: Add failing constants tests for operations defaults and T1-T13 source of truth**

Append to `constants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  INITIAL_OPERATION_UPGRADES,
  OPERATION_UPGRADE_DEFINITIONS,
  TIER_DATA,
} from '../constants';

describe('operations constants', () => {
  it('starts every operations meta-upgrade at level 0', () => {
    expect(INITIAL_OPERATION_UPGRADES).toEqual({
      betterVolumeTraining: 0,
      betterMarginTraining: 0,
      saferOperations: 0,
      bulkNetwork: 0,
    });
  });

  it('defines max levels and concrete costs for operations upgrades', () => {
    expect(OPERATION_UPGRADE_DEFINITIONS.betterVolumeTraining.costs).toEqual([5_000, 50_000, 500_000]);
    expect(OPERATION_UPGRADE_DEFINITIONS.bulkNetwork.maxLevel).toBe(3);
  });
});

describe('T1-T13 economy data', () => {
  it('keeps the research-model values for tiers 1 through 13', () => {
    expect(TIER_DATA.weed).toMatchObject({ c0: 15, costMultiplier: 1.12, yieldPerLevel: 0.20, unlockCost: 0, sellPrice: 4.20 });
    expect(TIER_DATA.mushrooms).toMatchObject({ c0: 150, costMultiplier: 1.15, yieldPerLevel: 0.30, unlockCost: 2000, sellPrice: 6.00 });
    expect(TIER_DATA.blueLotus).toMatchObject({ c0: 1500, costMultiplier: 1.18, yieldPerLevel: 0.45, unlockCost: 25000, sellPrice: 10.00 });
    expect(TIER_DATA.frostBite).toMatchObject({ c0: 15000, costMultiplier: 1.20, yieldPerLevel: 0.65, unlockCost: 250000, sellPrice: 15.00 });
    expect(TIER_DATA.electricLace).toMatchObject({ c0: 150000, costMultiplier: 1.22, yieldPerLevel: 1.00, unlockCost: 2500000, sellPrice: 20.00 });
    expect(TIER_DATA.meth).toMatchObject({ c0: 1500000, costMultiplier: 1.25, yieldPerLevel: 1.50, unlockCost: 25000000, sellPrice: 26.67 });
    expect(TIER_DATA.pharmGrade).toMatchObject({ c0: 15000000, costMultiplier: 1.28, yieldPerLevel: 2.50, unlockCost: 250000000, sellPrice: 35.56 });
    expect(TIER_DATA.khole).toMatchObject({ c0: 150000000, costMultiplier: 1.31, yieldPerLevel: 3.75, unlockCost: 2500000000, sellPrice: 47.41 });
    expect(TIER_DATA.lunarRegolith).toMatchObject({ c0: 1500000000, costMultiplier: 1.34, yieldPerLevel: 5.625, unlockCost: 25000000000, sellPrice: 63.21 });
    expect(TIER_DATA.martianSpores).toMatchObject({ c0: 15000000000, costMultiplier: 1.37, yieldPerLevel: 8.4375, unlockCost: 250000000000, sellPrice: 84.28 });
    expect(TIER_DATA.nebulaMist).toMatchObject({ c0: 150000000000, costMultiplier: 1.40, yieldPerLevel: 12.65625, unlockCost: 2500000000000, sellPrice: 112.37 });
    expect(TIER_DATA.voidCrystals).toMatchObject({ c0: 1500000000000, costMultiplier: 1.43, yieldPerLevel: 18.984375, unlockCost: 25000000000000, sellPrice: 149.82 });
    expect(TIER_DATA.chronoSalt).toMatchObject({ c0: 15000000000000, costMultiplier: 1.46, yieldPerLevel: 28.4765625, unlockCost: 250000000000000, sellPrice: 199.75 });
  });
});
```

- [ ] **Step 2: Run constants tests to verify they fail**

Run: `npm run test -- src/components/NeonD/__tests__/constants.test.ts`

Expected: FAIL because operation constants are missing.

- [ ] **Step 3: Add operations constants**

Add to `constants.ts` after `UPGRADE_TYPES`:

```ts
export const INITIAL_OPERATION_UPGRADES = {
  betterVolumeTraining: 0,
  betterMarginTraining: 0,
  saferOperations: 0,
  bulkNetwork: 0,
} as const;

export const OPERATION_UPGRADE_DEFINITIONS = {
  betterVolumeTraining: {
    label: 'Better Volume Training',
    description: 'Improves the range for rolled dealer volume upgrades.',
    maxLevel: 3,
    costs: [5_000, 50_000, 500_000],
  },
  betterMarginTraining: {
    label: 'Better Margin Training',
    description: 'Improves the range for rolled dealer margin upgrades.',
    maxLevel: 3,
    costs: [5_000, 50_000, 500_000],
  },
  saferOperations: {
    label: 'Safer Operations',
    description: 'Makes risk reduction upgrades stronger and softens risky builds.',
    maxLevel: 3,
    costs: [7_500, 75_000, 750_000],
  },
  bulkNetwork: {
    label: 'Bulk Network',
    description: 'Unlocks bulk market access and improves bulk street value.',
    maxLevel: 3,
    costs: [10_000, 100_000, 1_000_000],
  },
} as const;
```

- [ ] **Step 4: Add new defaults to `INITIAL_GAME_STATE`**

In `INITIAL_GAME_STATE`, add:

```ts
operationUpgrades: { ...INITIAL_OPERATION_UPGRADES },
productUpgrades: createInitialProductUpgrades(Object.keys(TIER_DATA)),
bulkMarket: createInitialBulkMarket(),
```

Import the helpers:

```ts
import { createInitialBulkMarket } from './bulkMarket';
import { createInitialProductUpgrades } from './productUpgrades';
```

- [ ] **Step 5: Run constants tests to verify they pass**

Run: `npm run test -- src/components/NeonD/__tests__/constants.test.ts`

Expected: PASS.

- [ ] **Step 6: Continue without committing**

Do not commit yet. Commit constants together with the engine wiring once `npm run build` is expected to pass again.

---

### Task 6: Wire Economy Modifiers Into Pure Calculations

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/economy.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

- [ ] **Step 1: Add failing integration tests for product modifiers**

Add the `INITIAL_GAME_STATE` import near the top of `useGameEngine.test.ts`, then append the funded helper and tests:

```ts
import { INITIAL_GAME_STATE } from '../../constants';

const setupWithOperationsMoney = () => {
  localStorage.setItem('brmble_neon_d_save', JSON.stringify({
    ...INITIAL_GAME_STATE,
    money: 100_000,
    production: {
      ...INITIAL_GAME_STATE.production,
      weed: {
        ...INITIAL_GAME_STATE.production.weed,
        stock: 250,
      },
    },
    lastTickAt: Date.now(),
  }));
  return renderHook(() => useGameEngine());
};

it('product automation increases future production upgrade yield', () => {
  const { result } = setupWithOperationsMoney();

  act(() => {
    result.current.buyProductUpgrade('weed', 'AUTOMATION');
    result.current.upgrade('weed');
  });

  expect(result.current.state.production.weed.rate).toBeCloseTo(0.22, 5);
});

it('product purity increases dealer earnings for that product', () => {
  const { result } = setupWithOperationsMoney();

  act(() => {
    result.current.buyProductUpgrade('weed', 'PURITY');
    result.current.upgrade('weed');
    result.current.hireDealer(makeDealer({ id: 'purity-earner', margin: 1, volume: 1, sideVolume: 0 }), 0);
  });

  act(() => {
    vi.advanceTimersByTime(1_000);
  });

  expect(result.current.state.lastEarningsPerDealer['purity-earner']).toBeCloseTo(4.41, 5);
});
```

- [ ] **Step 2: Run integration tests to verify they fail**

Run: `npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

Expected: FAIL because `buyProductUpgrade` is not exposed and modifiers are not applied.

- [ ] **Step 3: Add economy helper functions**

Extend `economy.ts`:

```ts
import type { GameState } from './types';
import { TIER_DATA, PRODUCT_ARREST_RISK } from './constants';
import { getProductUpgradeModifiers } from './productUpgrades';

export const getProductSellPrice = (state: GameState, productId: string) => {
  const tier = TIER_DATA[productId as keyof typeof TIER_DATA];
  const base = tier?.sellPrice ?? 1;
  return base * getProductUpgradeModifiers(state.productUpgrades, productId).sellPriceMultiplier;
};

export const getProductProductionYield = (state: GameState, productId: string) => {
  const item = state.production[productId];
  if (!item) return 0;
  return item.yieldPerLevel * getProductUpgradeModifiers(state.productUpgrades, productId).productionMultiplier;
};

export const getProductDealerVolumeMultiplier = (state: GameState, productId: string) =>
  getProductUpgradeModifiers(state.productUpgrades, productId).dealerVolumeMultiplier;

export const getEffectiveProductRiskChance = (state: GameState, productId: string, dealerRiskBonus: number) => {
  const baseRisk = PRODUCT_ARREST_RISK[productId]?.chance ?? 0.10;
  const productRiskBonus = getProductUpgradeModifiers(state.productUpgrades, productId).riskBonus;
  return Math.min(0.95, Math.max(0.01, baseRisk + productRiskBonus + dealerRiskBonus));
};
```

Keep the existing exports `getCurrentTotalIncomePerSecond` and `getBailCost` unchanged.

- [ ] **Step 4: Continue without committing**

Do not commit the failing integration tests yet. They become commit-ready only after Task 7 exposes `buyProductUpgrade` and applies the product modifiers through the engine.

---

### Task 7: Wire V2 State Into Game Engine

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts`
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

- [ ] **Step 1: Add failing engine tests for operations upgrades, bulk sales, risk, and migration**

Append to `useGameEngine.test.ts`:

```ts
it('buys an operations upgrade when funded and below max level', () => {
  const { result } = setupWithOperationsMoney();

  act(() => {
    vi.advanceTimersByTime(600_000);
    result.current.buyOperationUpgrade('betterVolumeTraining');
  });

  expect(result.current.state.operationUpgrades.betterVolumeTraining).toBe(1);
});

it('unlocks a fourth equipment slot on a specific dealer through operations action', () => {
  const { result } = setupWithOperationsMoney();

  act(() => {
    vi.advanceTimersByTime(600_000);
    result.current.hireDealer(makeDealer(), 0);
    result.current.unlockDealerEquipmentSlot('test-dealer');
  });

  expect(result.current.state.activeDealers[0]?.maxEquipmentSlots).toBe(4);
});

it('bulk sale converts stock to money and starts cooldown', () => {
  const { result } = setupWithOperationsMoney();

  act(() => {
    result.current.buyOperationUpgrade('bulkNetwork');
  });

  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  const stockAfterProduction = result.current.state.production.weed.stock;
  const moneyBefore = result.current.state.money;

  act(() => {
    result.current.sellBulk('weed');
  });

  const stockSold = stockAfterProduction - result.current.state.production.weed.stock;
  expect(result.current.state.money).toBeGreaterThan(moneyBefore);
  expect(stockSold).toBeGreaterThan(0);
  expect(result.current.state.production.weed.stock).toBeLessThan(stockAfterProduction);
  expect(result.current.state.production.weed.stock).toBeGreaterThanOrEqual(0);
  expect(result.current.state.bulkMarket.cooldownUntil).toBeGreaterThan(Date.now());
});

it('restores older saves by filling in operations v2 fields', () => {
  localStorage.setItem('brmble_neon_d_save', JSON.stringify({
    money: 250,
    totalEarned: 0,
    researchSpeed: 1,
    production: {
      weed: {
        id: 'weed',
        name: 'Weed',
        stock: 0,
        rate: 0,
        yieldPerLevel: 0.2,
        costMultiplier: 1.12,
        level: 0,
        upgradeCost: 15,
      },
    },
    unlockedProduction: ['weed'],
    activeDealers: [makeDealer()],
    availableDealers: [],
    unlockedSlots: 1,
    lastRefreshTime: 0,
    lastEarningsPerDealer: {},
    lastTickAt: Date.now(),
    offlineEarningsSummary: null,
  }));

  const { result } = renderHook(() => useGameEngine());

  expect(result.current.state.operationUpgrades.bulkNetwork).toBe(0);
  expect(result.current.state.productUpgrades.weed.PURITY.level).toBe(0);
  expect(result.current.state.bulkMarket.cooldownUntil).toBe(0);
  expect(result.current.state.activeDealers[0]?.maxEquipmentSlots).toBe(3);
});
```

- [ ] **Step 2: Run game engine tests to verify they fail**

Run: `npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

Expected: FAIL because engine actions and migrations are missing.

- [ ] **Step 3: Update imports in `useGameEngine.ts`**

Replace local dealer upgrade helper code imports with:

```ts
import {
  applyDealerUpgrade,
  canRollDealerUpgrade,
  getDealerEquipmentUpgradeCost,
  rollDealerUpgradeOptions,
} from '../dealerUpgrades';
import { createInitialBulkMarket, canUseBulkMarket, getBestBulkStreetValue, getBulkSaleConfig, sellBulkStock } from '../bulkMarket';
import { createInitialProductUpgrades, getProductUpgradeCost, upgradeProductTrack } from '../productUpgrades';
import {
  getBailCost,
  getEffectiveProductRiskChance,
  getProductDealerVolumeMultiplier,
  getProductProductionYield,
  getProductSellPrice,
} from '../economy';
```

Remove `COMMON_DEALER_UPGRADES`, `UNCOMMON_DEALER_UPGRADES`, local `getDealerEquipmentUpgradeCost`, local `generateDealerUpgradeOptions`, and local `applyDealerUpgrade`.

- [ ] **Step 4: Add V2 dealer defaults to `generateRandomDealer` and normalization**

In `generateRandomDealer`, add these fields:

```ts
maxEquipmentSlots: 3,
riskBonus: 0,
bulkStreetValue: 0,
```

Add a pending-option type guard and extend `normalizeDealerRiskState`. Clear legacy pending options that do not have the V2 `rarity`, `tone`, and `effects` shape so the equipment modal cannot render stale partial options:

```ts
const isV2DealerUpgrade = (option: DealerUpgrade) =>
  option.rarity !== undefined &&
  option.tone !== undefined &&
  Array.isArray(option.effects);

const normalizeDealerRiskState = (dealer: Dealer): Dealer => ({
  ...dealer,
  isProtected: dealer.isProtected ?? false,
  isArrested: dealer.isArrested ?? false,
  nextArrestCheckAt: dealer.nextArrestCheckAt ?? scheduleNextArrestCheck(Date.now()),
  hasPendingUpgrade: dealer.hasPendingUpgrade ?? false,
  pendingUpgradeOptions: (dealer.pendingUpgradeOptions ?? []).every(isV2DealerUpgrade)
    ? dealer.pendingUpgradeOptions
    : [],
  maxEquipmentSlots: dealer.maxEquipmentSlots ?? 3,
  riskBonus: dealer.riskBonus ?? 0,
  bulkStreetValue: dealer.bulkStreetValue ?? 0,
});
```

- [ ] **Step 5: Add whole-state migration helper**

Add near `normalizeDealerRiskState`:

```ts
const normalizeGameState = (state: GameState): GameState => {
  const productIds = Object.keys(state.production ?? INITIAL_GAME_STATE.production);
  const baseProductUpgrades = createInitialProductUpgrades(productIds);
  const existingProductUpgrades = state.productUpgrades ?? {};

  return {
    ...INITIAL_GAME_STATE,
    ...state,
    activeDealers: (state.activeDealers ?? [null, null, null]).map(dealer => (dealer ? normalizeDealerRiskState(dealer) : null)),
    availableDealers: (state.availableDealers ?? []).map(dealer => normalizeDealerRiskState(dealer)),
    operationUpgrades: {
      ...INITIAL_GAME_STATE.operationUpgrades,
      ...(state.operationUpgrades ?? {}),
    },
    productUpgrades: Object.fromEntries(
      productIds.map(productId => [
        productId,
        {
          ...baseProductUpgrades[productId],
          ...(existingProductUpgrades[productId] ?? {}),
        },
      ])
    ) as ProductUpgradeState,
    bulkMarket: state.bulkMarket ?? createInitialBulkMarket(),
    lastTickAt: state.lastTickAt && state.lastTickAt > 0 ? state.lastTickAt : Date.now(),
    offlineEarningsSummary: state.offlineEarningsSummary ?? null,
  };
};

const needsGameStateMigration = (state: GameState) => {
  const hasLegacyDealer = [...(state.activeDealers ?? []), ...(state.availableDealers ?? [])].some(dealer =>
    dealer !== null && (
      dealer.isProtected === undefined ||
      dealer.isArrested === undefined ||
      dealer.nextArrestCheckAt === undefined ||
      dealer.hasPendingUpgrade === undefined ||
      dealer.pendingUpgradeOptions === undefined ||
      !dealer.pendingUpgradeOptions.every(isV2DealerUpgrade) ||
      dealer.maxEquipmentSlots === undefined ||
      dealer.riskBonus === undefined ||
      dealer.bulkStreetValue === undefined
    )
  );

  return (
    hasLegacyDealer ||
    state.operationUpgrades === undefined ||
    state.productUpgrades === undefined ||
    state.bulkMarket === undefined ||
    state.lastTickAt === undefined ||
    state.lastTickAt <= 0 ||
    state.offlineEarningsSummary === undefined
  );
};
```

- [ ] **Step 6: Normalize persisted saves before initial render**

Update `usePersistedGameState` to accept an optional load-time normalizer and apply it inside the lazy `useState` initializer immediately after `deepMerge(initial, parsed)`. Then call the hook as:

```ts
const [state, setState, clearStorage] = usePersistedGameState<GameState>(
  'brmble_neon_d_save',
  createInitialGameState,
  normalizeGameState,
);
```

This keeps old saves from reaching the hook or UI before V2 fields exist. Keep a targeted migration effect only as a defensive fallback for state objects produced before this change; do not deep-compare the entire game state every render.

```ts
useEffect(() => {
  if (!needsGameStateMigration(state)) return;
  setState(prev => (needsGameStateMigration(prev) ? normalizeGameState(prev) : prev));
}, [
  state.activeDealers,
  state.availableDealers,
  state.operationUpgrades,
  state.productUpgrades,
  state.bulkMarket,
  state.lastTickAt,
  state.offlineEarningsSummary,
  setState,
]);
```

- [ ] **Step 7: Apply product modifiers in demand and upgrade calculations**

In `buildProductDemands`, change effective volume and price logic to:

```ts
const effectiveVolume =
  dealer.volume *
  (1 + dealer.volumeBonus) *
  getProductDealerVolumeMultiplier(state, dealer.selling);
const effectiveMargin = dealer.margin * (1 + dealer.marginBonus);
```

In `appendDemand`, change earnings per unit to:

```ts
earningsPerUnit: effectiveMargin * getProductSellPrice(state, productId) * earningsMultiplier,
```

In `upgrade`, change rate increase to:

```ts
rate: item.rate + getProductProductionYield(prev, id),
```

- [ ] **Step 8: Apply effective risk chance**

In `applyDueArrestChecks`, replace:

```ts
const risk = getDealerRisk(dealer.selling);
const rolledArrest = Math.random() < risk.chance;
```

with:

```ts
const rolledArrest = Math.random() < getEffectiveProductRiskChance(state, dealer.selling, dealer.riskBonus);
```

Here `state` must be the current state parameter passed into `applyDueArrestChecks`, not the outer React hook state. If the function is refactored while implementing, name that parameter `currentState` and pass that into `getEffectiveProductRiskChance` to avoid accidentally closing over stale hook state. Keep `getDealerRisk` for UI label fallback unless UI is moved to a helper later.

- [ ] **Step 9: Update dealer upgrade flow for per-dealer capacity and V2 rolls**

In `startDealerUpgrade`, replace `dealer.equipmentCount >= 3` with:

```ts
!canRollDealerUpgrade(dealer)
```

Replace option generation with:

```ts
pendingUpgradeOptions: rollDealerUpgradeOptions({
  dealer,
  unlockedProduction: prev.unlockedProduction,
  operationUpgrades: prev.operationUpgrades,
}),
```

In `buyEquipment`, replace `dealer.equipmentCount >= 3` with `!canRollDealerUpgrade(dealer)`.

- [ ] **Step 10: Add game engine actions**

Add before `resetGame`:

```ts
const buyOperationUpgrade = (id: OperationUpgradeId) => {
  setState(prev => {
    const definition = OPERATION_UPGRADE_DEFINITIONS[id];
    const currentLevel = prev.operationUpgrades[id] ?? 0;
    if (currentLevel >= definition.maxLevel) return prev;
    const cost = definition.costs[currentLevel];
    if (prev.money < cost) return prev;

    return {
      ...prev,
      money: prev.money - cost,
      operationUpgrades: {
        ...prev.operationUpgrades,
        [id]: currentLevel + 1,
      },
    };
  });
};

const buyProductUpgrade = (productId: string, category: ProductUpgradeCategory) => {
  setState(prev => {
    const track = prev.productUpgrades[productId]?.[category];
    if (!track || track.level >= track.maxLevel) return prev;
    const cost = getProductUpgradeCost(category, track.level);
    if (prev.money < cost) return prev;

    return {
      ...prev,
      money: prev.money - cost,
      productUpgrades: upgradeProductTrack(prev.productUpgrades, productId, category),
    };
  });
};

const unlockDealerEquipmentSlot = (dealerId: string) => {
  setState(prev => {
    const dealer = prev.activeDealers.find(d => d?.id === dealerId);
    if (!dealer || dealer.maxEquipmentSlots >= 5) return prev;
    const cost = getDealerSlotUnlockCost(dealer.maxEquipmentSlots);
    if (prev.money < cost) return prev;

    return {
      ...prev,
      money: prev.money - cost,
      activeDealers: prev.activeDealers.map(d =>
        d?.id === dealerId ? { ...d, maxEquipmentSlots: d.maxEquipmentSlots + 1 } : d
      ),
    };
  });
};

const sellBulk = (productId: string) => {
  setState(prev => {
    const now = Date.now();
    const item = prev.production[productId];
    if (!item || item.stock <= 0) return prev;
    if (!canUseBulkMarket(prev.bulkMarket, now)) return prev;

    const streetValuePercent = getBestBulkStreetValue(prev.activeDealers, prev.operationUpgrades.bulkNetwork);
    if (streetValuePercent <= 0) return prev;
    const bulkSaleConfig = getBulkSaleConfig(prev.operationUpgrades.bulkNetwork);

    const sale = sellBulkStock({
      stock: item.stock,
      maxStock: bulkSaleConfig.maxStock,
      sellPrice: getProductSellPrice(prev, productId),
      streetValuePercent,
      now,
      cooldownMs: bulkSaleConfig.cooldownMs,
    });

    return {
      ...prev,
      money: prev.money + sale.earned,
      totalEarned: prev.totalEarned + sale.earned,
      bulkMarket: sale.bulkMarket,
      production: {
        ...prev.production,
        [productId]: {
          ...item,
          stock: sale.remainingStock,
        },
      },
    };
  });
};
```

Update imports for `OperationUpgradeId`, `ProductUpgradeCategory`, `ProductUpgradeState`, and `OPERATION_UPGRADE_DEFINITIONS`.

- [ ] **Step 11: Return new actions from hook**

Add to returned object:

```ts
buyOperationUpgrade,
buyProductUpgrade,
unlockDealerEquipmentSlot,
sellBulk,
```

- [ ] **Step 12: Run engine tests and build to verify this commit boundary**

Run: `npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD
git commit -m "feat: wire neon d operations domain and engine"
```

---

### Task 8: Add Operations Tab UI

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css`
- Modify: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

- [ ] **Step 1: Add failing UI tests**

Append to `NeonDGame.test.tsx`:

```ts
it('renders operations tab with meta-upgrades, product upgrades, and bulk market', async () => {
  const user = userEvent.setup();
  render(<NeonDGame />);

  await user.click(screen.getByRole('tab', { name: /operations/i }));

  expect(screen.getByText(/better volume training/i)).toBeInTheDocument();
  expect(screen.getByText(/product specialization/i)).toBeInTheDocument();
  expect(screen.getByText(/bulk market/i)).toBeInTheDocument();
});

it('shows positive and negative upgrade effects in the equipment modal', async () => {
  const user = userEvent.setup();
  mockNeonD.setState(
    mockNeonD.createState({
      activeDealers: [
        mockNeonD.createDealer({
          pendingUpgradeOptions: [
            {
              type: 'VOLUME',
              rarity: 'RARE',
              tone: 'MIXED',
              label: 'Reckless Crew',
              description: 'Volume +25%, arrest risk +5%',
              value: 0.25,
              riskPenalty: 0.05,
              effects: [
                { stat: 'volumeBonus', value: 0.25, label: '+25% volume' },
                { stat: 'riskBonus', value: 0.05, label: '+5% arrest risk', isNegative: true },
              ],
            },
            {
              type: 'RISK_REDUCTION',
              rarity: 'UNCOMMON',
              tone: 'POSITIVE',
              label: 'Clean Route',
              description: 'Arrest risk -6%',
              value: 0.06,
              riskReduction: 0.06,
              effects: [{ stat: 'riskBonus', value: -0.06, label: '-6% arrest risk' }],
            },
            {
              type: 'ALL_AROUNDER',
              rarity: 'COMMON',
              tone: 'POSITIVE',
              label: 'All-Arounder',
              description: 'Volume +5%, margin +5%',
              value: 0.05,
              effects: [
                { stat: 'volumeBonus', value: 0.05, label: '+5% volume' },
                { stat: 'marginBonus', value: 0.05, label: '+5% margin' },
              ],
            },
          ],
        }),
      ],
    }),
  );

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: /upgrade/i }));

  expect(screen.getByText(/high risk/i)).toBeInTheDocument();
  expect(screen.getByText(/\+5% arrest risk/i)).toBeInTheDocument();
  expect(screen.getByText(/-6% arrest risk/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx`

Expected: FAIL because the Operations tab and effect rows are missing.

- [ ] **Step 3: Update mocked engine shape in UI tests**

In `NeonDGame.test.tsx`, update mocked state defaults:

```ts
operationUpgrades: {
  betterVolumeTraining: 0,
  betterMarginTraining: 0,
  saferOperations: 0,
  bulkNetwork: 0,
},
productUpgrades: {
  weed: {
    PURITY: { category: 'PURITY', level: 0, maxLevel: 3 },
    AUTOMATION: { category: 'AUTOMATION', level: 0, maxLevel: 3 },
    CONCEALMENT: { category: 'CONCEALMENT', level: 0, maxLevel: 3 },
    DISTRIBUTION: { category: 'DISTRIBUTION', level: 0, maxLevel: 2 },
  },
},
bulkMarket: {
  cooldownUntil: 0,
  lastSaleAt: 0,
},
```

Update `createDealer` defaults:

```ts
maxEquipmentSlots: 3,
riskBonus: 0,
bulkStreetValue: 0,
```

Update mocked hook returns:

```ts
buyOperationUpgrade: vi.fn(),
buyProductUpgrade: vi.fn(),
unlockDealerEquipmentSlot: vi.fn(),
sellBulk: vi.fn(),
```

- [ ] **Step 4: Add tab state and engine actions to component**

In `NeonDGame`, extend hook destructuring:

```ts
buyOperationUpgrade,
buyProductUpgrade,
unlockDealerEquipmentSlot,
sellBulk,
```

Add local tab state:

```ts
const [activeTab, setActiveTab] = useState<'production' | 'operations'>('production');
```

Add tab buttons after the header stats:

```tsx
<div className={styles.tabBar} role="tablist" aria-label="Neon-D sections">
  <button
    type="button"
    role="tab"
    aria-selected={activeTab === 'production'}
    className={`${styles.tabButton} ${activeTab === 'production' ? styles.tabButtonActive : ''}`}
    onClick={() => setActiveTab('production')}
  >
    Production
  </button>
  <button
    type="button"
    role="tab"
    aria-selected={activeTab === 'operations'}
    className={`${styles.tabButton} ${activeTab === 'operations' ? styles.tabButtonActive : ''}`}
    onClick={() => setActiveTab('operations')}
  >
    Operations
  </button>
</div>
```

Wrap the existing `gridLayout` in:

```tsx
{activeTab === 'production' && (
  <div className={styles.gridLayout}>
    ...
  </div>
)}
```

- [ ] **Step 5: Add Operations tab panel**

Add below the production grid:

```tsx
{activeTab === 'operations' && (
  <div className={styles.operationsLayout}>
    <section className={`glass-panel ${styles.operationsPanel}`}>
      <h3 className={`heading-section ${styles.columnHeader}`}>Dealer Operations</h3>
      {Object.entries(OPERATION_UPGRADE_DEFINITIONS).map(([id, definition]) => {
        const typedId = id as keyof typeof OPERATION_UPGRADE_DEFINITIONS;
        const level = state.operationUpgrades[typedId];
        const nextCost = definition.costs[level];
        return (
          <div key={id} className={styles.operationCard}>
            <div>
              <h4 className={`heading-label ${styles.operationTitle}`}>{definition.label}</h4>
              <p className={styles.label}>{definition.description}</p>
              <span className={styles.label}>Level {level}/{definition.maxLevel}</span>
            </div>
            <button
              className={styles.buyButton}
              disabled={level >= definition.maxLevel || state.money < nextCost}
              onClick={() => buyOperationUpgrade(typedId)}
            >
              {level >= definition.maxLevel ? 'Maxed' : `Upgrade (${formatMoney(nextCost)})`}
            </button>
          </div>
        );
      })}
    </section>

    <section className={`glass-panel ${styles.operationsPanel}`}>
      <h3 className={`heading-section ${styles.columnHeader}`}>Product Specialization</h3>
      {state.unlockedProduction.map(productId => {
        const product = state.production[productId];
        const tracks = state.productUpgrades[productId];
        if (!product || !tracks) return null;
        return (
          <div key={productId} className={styles.productUpgradeCard}>
            <h4 className={`heading-label ${styles.operationTitle}`}>{product.name}</h4>
            {Object.values(tracks).map(track => {
              const cost = getProductUpgradeCost(track.category, track.level);
              return (
                <button
                  key={track.category}
                  className={styles.upgradeTrackButton}
                  disabled={track.level >= track.maxLevel || state.money < cost}
                  onClick={() => buyProductUpgrade(productId, track.category)}
                >
                  {track.category}: {track.level}/{track.maxLevel} ({track.level >= track.maxLevel ? 'Maxed' : formatMoney(cost)})
                </button>
              );
            })}
          </div>
        );
      })}
    </section>

    <section className={`glass-panel ${styles.operationsPanel}`}>
      <h3 className={`heading-section ${styles.columnHeader}`}>Bulk Market</h3>
      {visibleProduction.filter(product => state.unlockedProduction.includes(product.id)).map(product => {
        const remainingMs = Math.max(0, state.bulkMarket.cooldownUntil - Date.now());
        const hasCooldown = remainingMs > 0;
        const streetValuePercent = getBestBulkStreetValue(state.activeDealers, state.operationUpgrades.bulkNetwork);
        const isLocked = streetValuePercent <= 0;
        return (
          <div key={product.id} className={styles.bulkRow}>
            <span>{product.name}: {product.stock.toFixed(2)}g</span>
            <button
              className={styles.buyButton}
              disabled={isLocked || hasCooldown || product.stock <= 0}
              onClick={() => sellBulk(product.id)}
            >
              {isLocked ? 'Bulk Locked' : hasCooldown ? `Cooldown ${formatBulkCooldown(remainingMs)}` : 'Sell Bulk'}
            </button>
          </div>
        );
      })}
    </section>
  </div>
)}
```

Import:

```ts
import { OPERATION_UPGRADE_DEFINITIONS } from './constants';
import { formatBulkCooldown, getBestBulkStreetValue } from './bulkMarket';
import { getProductUpgradeCost } from './productUpgrades';
import { getDealerSlotUnlockCost } from './dealerUpgrades';
```

- [ ] **Step 6: Show per-dealer equipment capacity and slot unlock action**

Replace equipment row display with:

```tsx
<span className={styles.equipmentSlots}>
  {dealer.equipmentCount}/{dealer.maxEquipmentSlots} filled
</span>
```

Add button near upgrade button:

```tsx
{dealer.maxEquipmentSlots < 5 && (() => {
  const slotCost = getDealerSlotUnlockCost(dealer.maxEquipmentSlots);
  return (
    <button
      className={styles.buyButton}
      disabled={state.money < slotCost}
      onClick={() => unlockDealerEquipmentSlot(dealer.id)}
    >
      Unlock Slot {dealer.maxEquipmentSlots + 1} ({formatMoney(slotCost)})
    </button>
  );
})()}
```

Replace max check:

```ts
const isMaxed = dealer.equipmentCount >= dealer.maxEquipmentSlots;
```

- [ ] **Step 7: Render upgrade rarity, tone, and effect rows**

Inside equipment option button, replace description-only content with:

```tsx
<div className={styles.equipmentOptionLabel}>{opt.label}</div>
<div className={styles.rarityPill} data-rarity={opt.rarity.toLowerCase()}>{opt.rarity}</div>
{opt.tone === 'MIXED' && <div className={styles.highRiskLabel}>High Risk</div>}
<div className={styles.equipmentOptionDescription}>{opt.description}</div>
<div className={styles.effectList}>
  {opt.effects.map(effect => (
    <span
      key={`${effect.stat}-${effect.label}`}
      className={effect.isNegative ? styles.negativeEffect : styles.positiveEffect}
    >
      {effect.label}
    </span>
  ))}
</div>
```

- [ ] **Step 8: Add CSS**

Add to `NeonD.module.css`:

```css
.tabBar {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.tabButton {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface-muted);
  color: var(--color-text);
  padding: 0.45rem 0.9rem;
  cursor: pointer;
}

.tabButtonActive {
  background: var(--color-accent);
  color: var(--color-accent-contrast);
}

.operationsLayout {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.operationsPanel {
  padding: 1rem;
}

.operationCard,
.productUpgradeCard,
.bulkRow {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.75rem;
}

.operationTitle {
  margin: 0;
}

.upgradeTrackButton {
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  background: var(--color-surface-muted);
  color: var(--color-text);
  padding: 0.55rem;
  text-align: left;
}

.rarityPill,
.highRiskLabel {
  display: inline-flex;
  width: fit-content;
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  font-size: 0.75rem;
  font-weight: 700;
}

.rarityPill[data-rarity='common'] {
  background: rgba(255, 255, 255, 0.12);
}

.rarityPill[data-rarity='uncommon'] {
  background: rgba(64, 199, 129, 0.25);
}

.rarityPill[data-rarity='rare'] {
  background: rgba(119, 164, 255, 0.28);
}

.rarityPill[data-rarity='jackpot'] {
  background: rgba(255, 198, 41, 0.30);
}

.highRiskLabel {
  background: rgba(255, 128, 64, 0.24);
  color: var(--color-danger);
}

.effectList {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.positiveEffect,
.negativeEffect {
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  font-size: 0.75rem;
}

.positiveEffect {
  background: rgba(64, 199, 129, 0.18);
  color: var(--color-success);
}

.negativeEffect {
  background: rgba(255, 128, 64, 0.18);
  color: var(--color-danger);
}

@media (max-width: 900px) {
  .operationsLayout {
    grid-template-columns: 1fr;
  }
}
```

If any CSS variable does not exist, replace it with the closest existing token already used in `NeonD.module.css`.

- [ ] **Step 9: Run UI tests to verify they pass**

Run: `npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: add neon d operations tab ui"
```

---

### Task 9: Full Verification And Cleanup

**Files:**
- Modify only if previous tasks reveal issues.

- [ ] **Step 1: Run focused NeonD tests**

Run: `npm run test -- src/components/NeonD`

Expected: PASS.

- [ ] **Step 2: Run full frontend test suite**

Run: `npm run test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Inspect git diff**

Run: `git diff --stat`

Expected: only NeonD implementation and test files changed.

- [ ] **Step 5: Commit cleanup if needed**

If verification required fixes:

```bash
git add src/Brmble.Web/src/components/NeonD
git commit -m "fix: stabilize neon d operations v2"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

**Spec coverage:** Dealer RNG upgrade options, rarity, random ranges, mixed/negative effects, risk reduction, bulk upgrade, side hustle, all-arounder, operations unlocks, per-dealer equipment slots, product upgrade MVP categories, bulk cooldown, and economy regression coverage are all mapped to tasks. Branding and Packaging are intentionally excluded from MVP because the spec says MVP only needs Purity, Automation, Concealment, and Distribution.

**Placeholder scan:** This plan contains no unresolved markers, deferred implementation notes, or unnamed edge-case instructions. The only unresolved spec data is the missing T1-T13 replacement table; the plan resolves it by treating existing DST model values as source-of-truth and testing them.

**Type consistency:** `OperationUpgradeId`, `ProductUpgradeCategory`, `DealerUpgradeEffect`, `BulkMarketState`, `buyOperationUpgrade`, `buyProductUpgrade`, `unlockDealerEquipmentSlot`, and `sellBulk` are introduced before later tasks use them.
