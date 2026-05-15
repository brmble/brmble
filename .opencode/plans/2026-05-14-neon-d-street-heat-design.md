# NeonD — "Street Heat" Design Document

**Date:** 2026-05-14
**Goal:** Add risk, rival gangs, and market events to the NeonD (Brmble Empire) idle game to make it more engaging.

## Overview

Three interconnected layers added on top of the existing NeonD idle game loop:

1. **Heat/Risk System** — dealers accumulate heat from sales; too much heat = arrested
2. **Rival Gangs & Territory** — fight rival gangs for territory control per product; territory affects sell price
3. **Market Events** — random timed events that affect prices, heat, and territory

## Architecture

All new state lives in the existing `GameState` interface. The existing `useGameEngine` hook is extended with new actions and tick logic. New UI components are added alongside existing ones.

### Files Modified
- `src/Brmble.Web/src/components/NeonD/types.ts` — add new types
- `src/Brmble.Web/src/components/NeonD/constants.ts` — add new constants
- `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts` — extend tick and actions
- `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx` — integrate new UI
- `src/Brmble.Web/src/components/NeonD/NeonD.module.css` — new styles

### Files Created
- `src/Brmble.Web/src/components/NeonD/components/HeatBar.tsx` — heat visualization
- `src/Brmble.Web/src/components/NeonD/components/TerritoryPanel.tsx` — territory overview
- `src/Brmble.Web/src/components/NeonD/components/EventBanner.tsx` — event notifications

### Test Files Created/Modified
- `src/Brmble.Web/src/components/NeonD/__tests__/constants.test.ts` — new constant tests
- `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts` — new mechanic tests
- `src/Brmble.Web/src/components/NeonD/components/__tests__/HeatBar.test.tsx` — new
- `src/Brmble.Web/src/components/NeonD/components/__tests__/TerritoryPanel.test.tsx` — new
- `src/Brmble.Web/src/components/NeonD/components/__tests__/EventBanner.test.tsx` — new

## Section 1: Types & Constants

### New Types (in `types.ts`)

```typescript
export type MarketEventType = 'FESTIVAL' | 'CRASH' | 'CRACKDOWN' | 'HEAT_WAVE' | 'RIVAL_ATTACK' | 'TRUCE';

export interface MarketEvent {
  type: MarketEventType;
  description: string;
  duration: number;
  productId?: string;
  startTime: number;
}

export interface GangTerritory {
  productId: string;
  playerControl: number;
  rivalControl: number;
}
```

### Extended `Dealer` interface additions
```typescript
heat: number;
missionStatus: 'idle' | 'on_mission' | 'arrested';
missionEndTime?: number;
missionTarget?: string;
isArrested: boolean;
bailCost: number;
```

### New Constants (in `constants.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `HEAT_RATE` | 0.02 | Heat generated per gram sold |
| `HEAT_DECAY` | 0.005 | Heat decay per tick when idle |
| `PRODUCT_RISK` | Record<string, number> | Risk multiplier per product (Weed=0.5, Mushrooms=0.7, BlueLotus=0.9, Frostbite=1.2, ElectricLace=1.5, Meth=3.0, PharmGrade=3.5, K-Hole=4.0, rest=4.5) |
| `BAIL_BASE` | 500 | Base bail cost |
| `BAIL_PER_EQUIP` | 1000 | Bail cost per equipment slot filled |
| `TERRITORY_MIN` | 8 | Minimum territory % gained per mission |
| `TERRITORY_MAX` | 12 | Maximum territory % gained per mission |
| `MISSION_DURATION` | 30 | Duration in seconds for a mission |
| `MISSION_COST` | 1000 | Cost to send a dealer on mission |
| `RIVAL_ATTACK_CHANCE` | 0.02 | Probability per tick of rival attack |
| `RIVAL_ATTACK_MIN` | 5 | Minimum territory % lost on attack |
| `RIVAL_ATTACK_MAX` | 15 | Maximum territory % lost on attack |
| `EVENT_COOLDOWN` | 45 | Minimum seconds between events |
| `EVENT_CHANCE_PER_TICK` | 0.005 | Probability per tick of spawning event |

### Gang Definitions
```typescript
export const GANGS = [
  { id: 'cartel', name: 'The Cartel', color: '#e74c3c' },
  { id: 'eastside', name: 'Eastside Crew', color: '#9b59b6' },
  { id: 'purple', name: 'Purple Syndicate', color: '#8e44ad' },
] as const;
```

### Market Event Definitions
```typescript
export const MARKET_EVENTS = {
  FESTIVAL:    { description: '🎉 Festival! All prices +50%', duration: 15, priceMultiplier: 1.5 },
  CRASH:       { description: '📉 Market Crash! All prices -40%', duration: 30, priceMultiplier: 0.6 },
  CRACKDOWN:   { description: '🚔 Police Crackdown! Heat gain x2', duration: 20, heatMultiplier: 2 },
  HEAT_WAVE:   { description: '🔥 Heat Wave! Demand x3', duration: 15, productMultiplier: 3 },
  RIVAL_ATTACK: { description: '💀 Rival Attack! Territory lost', duration: 0, isInstant: true },
  TRUCE:       { description: '🤝 Truce! No rival attacks', duration: 60, noAttacks: true },
} as const;
```

## Section 2: Engine Logic (useGameEngine changes)

### Extended GameState additions
```typescript
dealerHeat: Record<string, number>;
territory: Record<string, GangTerritory>;
activeEvent: MarketEvent | null;
lastEventTime: number;
nextRivalAttackTime: number;
```

### Tick Loop (extended, runs every 1s)

```
1. Production: generate stock at rate (unchanged)
2. Sales: for each active, non-arrested, non-mission dealer:
   a. Calculate effectivePrice = basePrice × territoryMultiplier × eventMultiplier
   b. Sell stock, earn money, heat += effectiveVolume × HEAT_RATE × PRODUCT_RISK[product]
   c. If heat >= 100: dealer.arrested = true
3. Heat Decay: for idle dealers, heat = max(0, heat - HEAT_DECAY)
4. Mission Check: if dealer on mission and time expired, grant territory
5. Rival Attack: if time >= nextRivalAttackTime, reduce territory
6. Event Check: if cooldown elapsed, roll random event
7. Event Expiry: clear expired events
```

### New Actions
| Action | Implementation |
|---|---|
| `payProtection(dealerId)` | Cost = heat × 10. Reset heat to 0. |
| `payBail(dealerId)` | Cost = BAIL_BASE + BAIL_PER_EQUIP × equipmentCount. Free dealer, heat=50. |
| `sendOnMission(dealerId, productId)` | Cost = MISSION_COST. Set missionStatus, missionEndTime, missionTarget. |
| `dismissArrested(dealerId)` | Fire arrested dealer (no bail). |

### Price Calculation
```typescript
function getEffectiveSellPrice(productId: string): number {
  const basePrice = PRODUCT_TIERS[productId] || 1;
  const territory = state.territory[productId];
  const territoryMult = territory ? (0.5 + territory.playerControl / 100) : 1.0;
  const eventMult = state.activeEvent?.type === 'FESTIVAL' ? 1.5
    : state.activeEvent?.type === 'CRASH' ? 0.6
    : state.activeEvent?.type === 'HEAT_WAVE' && state.activeEvent?.productId === productId ? 3
    : 1.0;
  return basePrice * territoryMult * eventMult;
}
```

## Section 3: UI Components

### EventBanner
- Fixed-position banner below header
- Colored background per event type
- Shows icon + description + countdown
- Auto-fades on expiry

### HeatBar (inside Dealer Card)
- Horizontal bar (width = heat%), green→yellow→red gradient
- "Protect" button (cost = heat × 10)
- Arrested overlay: "🚔 ARRESTED — Pay Bail ($X)" + "Fire"
- Mission state: "On Mission (Xs remaining)"

### TerritoryPanel (in Distribution column)
- Compact rows per unlocked product
- Green bar = player %, red bar = rival %
- Label: "Product — XX% controlled"

### Dealer Card Additions
- "Send on Mission" button with product dropdown
- Disabled while on mission/arrested

## Section 4: Edge Cases
- Territory clamped to 0-100%
- Stock still produced when all dealers arrested
- Mission uses timestamps (works across tab switches)
- Only one active event at a time
- RIVAL_ATTACK is instant (duration 0)
- TRUCE suspends rival attacks for 60s
- No heat gain while arrested/on mission
- Protection at 0 heat is no-op

## Section 5: Testing
- **constants.test.ts:** Product risk for all 18 products, 3 gangs, 6 event types
- **useGameEngine.test.ts:** Heat accumulation/decay, arrest, protection, bail, mission, territory, events
- **HeatBar.test.tsx:** Width, color, protect callback
- **TerritoryPanel.test.tsx:** Renders products, correct percentages
- **EventBanner.test.tsx:** Renders event, countdown, disappears on expire

## Implementation Order
1. Types & Constants
2. Heat System in Engine
3. Market Events in Engine
4. Rival Gangs & Territory in Engine
5. HeatBar component
6. EventBanner component
7. TerritoryPanel component
8. Integration in NeonDGame
