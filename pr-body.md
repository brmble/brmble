## Summary

Transforms the Brmble Empire game from a single-dealer model to a multi-dealer slot system with a comprehensive equipment upgrade mechanic.

### Major Changes

**Architecture**
- Replaced single `dealer` field in GameState with `activeDealers[]` array supporting up to 3 dealers
- Added `availableDealers` pool for hiring new dealers
- Added `unlockedSlots` system to progressively unlock dealer slots ($1k, $100k)
- Added `lastRefreshTime` for dealer pool cooldown

**Equipment System**
- 3-slot equipment limit per dealer with scaling costs ($500, $1,250, $3,125)
- Weighted RNG upgrade selection:
  - **Common (70%)**: High Capacity (+15% volume), Premium Cut (+15% margin), Packaging Expert (+5% both)
  - **Uncommon (20%)**: Bulk Specialist (+35% vol, -10% marg), The Network (+10% side hustle efficiency)
  - **Jackpot (10%)**: Side Hustle - sell a second product at 10% volume (gold glow UI)
- New upgrade types: VOLUME, MARGIN, SIDE_HUSTLE, NETWORK, ALL_AROUNDER, BULK

**Side Hustles**
- Dealers can now sell multiple products simultaneously
- Side hustle sales capped at 90% of total volume to ensure primary sales
- Side hustles consume inventory just like primary sales

**UI Improvements**
- Equipment slot visualization with filled/empty indicators
- Upgrade selection modal with jackpot highlighting and pulse animation
- Per-dealer earnings display
- Global earnings in header
- Fire confirmation with warning about lost equipment
- Dealer pool refresh with 10-minute cooldown

**Bug Fixes**
- `resetGame` now properly regenerates available dealers
- UI earnings calculation matches engine logic (both use stock)
- Removed redundant state updates in tick loop
- Removed dead code (DEALER_STATS, unused bribe system)

### Breaking Changes

| Old | New |
|-----|-----|
| `GameState.dealer: Dealer \| null` | `GameState.activeDealers: (Dealer \| null)[]` |
| `Dealer.bribeLevel` | Removed (bribe system removed) |
| - | `Dealer.id`, `volumeBonus`, `marginBonus`, `sideHustle`, `equipmentCount` |

### Files Changed

- `types.ts` - Updated interfaces
- `constants.ts` - Added dealer name arrays, slot unlock costs, removed BRIBE_RATE and DEALER_STATS
- `useGameEngine.ts` - Complete rewrite with new mechanics
- `NeonDGame.tsx` - New UI with upgrade modal
- `useGameEngine.test.ts` - Updated test data

### Testing

- All NeonD tests pass
- Frontend builds successfully