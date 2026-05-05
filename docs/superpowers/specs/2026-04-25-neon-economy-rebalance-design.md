# Neon Economy Rebalance Design

## Overview
Add `yieldPerLevel` field to production items to replace hardcoded rate increases in the game engine.

## Changes

### 1. Types (`types.ts`)
Add `yieldPerLevel: number` to `ProductionItem` interface.

### 2. Constants (`constants.ts`)
- Add `yieldPerLevel` to each product in `INITIAL_GAME_STATE.production`
- Update unlock costs from plan table
- Update base upgrade costs from plan table

Product | yieldPerLevel
--- | ---
weed | 0.05
mushrooms | 0.20
meth | 0.08
bluelotus | 0.25
frostbite | 0.25
electriclace | 1.00
pharmgrade | 0.40
khole | 1.50
lunarregolith | 0.60
martianspores | 2.50
nebulamist | 1.10
voidcrystals | 1.25
chronosalt | 5.00
stardustresin | 1.50
darkmatterink | 6.25
singularityshards | 3.00
neutronflakes | 12.50
galacticcore | 3.75

### 3. Engine (`useGameEngine.ts`)
- Remove hardcoded `rateIncreases` object
- Use `item.yieldPerLevel` instead of `rateIncreases[id]`
- Keep cost multipliers unchanged (1.35/1.45/1.6/1.8)

## Implementation Order
1. Update types.ts
2. Update constants.ts with yieldPerLevel values
3. Update useGameEngine.ts to use yieldPerLevel