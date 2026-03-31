# Contracts Feature Design

**Date:** 2026-03-31  
**Status:** Approved

## Overview

Contracts are time-limited income multipliers that players assign to active licenses. The player picks from 3 random contracts and drags them to a license. While active, that license earns bonus income. Strategic tension: fast license = quick complete, less bonus. Slow license = max bonus, timeout risk.

---

## Tab Structure

### Hosting Tab Changes
- Add a "Contracts" section at the top of the Hosting tab
- Display 1-4 contract slots horizontally
- Empty slots show "Add Contract" button
- Active contracts show: name, progress bar, multiplier stars, collect button (if complete)

### Tech Upgrades Tab Changes
- Add 3 expensive upgrades to unlock additional contract slots:
  - Slot 2: $2,000,000 (default unlocked)
  - Slot 3: $10,000,000
  - Slot 4: $50,000,000

---

## Contract Generation

When player clicks "Add Contract" on an empty slot:

### Process
1. Pick 1 random active license as reference
2. Calculate volume: `referenceBandwidth × random(60-120 seconds)`
3. Determine stars based on reputation weights
4. Determine time range based on stars

### Star Distribution (fixed)
| Stars | Chance |
|-------|--------|
| 1-2★  | 40%    |
| 3★    | 35%    |
| 4★    | 20%    |
| 5★    | 5%     |

### Time Ranges (by stars)
| Stars | Time Range  |
|-------|-------------|
| 1-2★  | 6-9 min     |
| 3★    | 5-7 min     |
| 4★    | 4-6 min     |
| 5★    | 3-5 min     |

### Display
```
Contract: "Neural Training Pack"
Volume: 8.00 MB [★★★☆☆]
Time Limit: ± 5-7 min
```
- Volume is visible (gives strategic hint)
- Exact time is hidden until contract is accepted
- Stars visible, exact multiplier is hidden (learned over time)

---

## Data Structures

### Contract (available/popup)
```typescript
interface Contract {
  id: string;
  name: string;
  volumeBytes: number;
  multiplierStars: number;  // 1-5, affects bonus multiplier
}
```

### ActiveContract (running on license)
```typescript
interface ActiveContract {
  contractId: string;
  slotIndex: number;       // 0-3
  assignedLicenseId: string;
  startTime: number;        // timestamp
  timeLimitSeconds: number; // exact, hidden until accepted
  volumeBytes: number;
  volumeFilledBytes: number;
  multiplierStars: number;
}
```

### GameState Changes
```typescript
interface GameState {
  // ... existing fields
  availableContracts: Contract[];      // 0-3 contracts in popup
  activeContracts: ActiveContract[];   // 0-4 running contracts
  unlockedContractSlots: number;       // 1-4, default 1
  contractPopupOpen: boolean;
}
```

---

## Active Contract Behavior

### Progress Calculation
```
Each tick (100ms):
  volumeFilledBytes += license.bandwidthBytesPerSecond × (deltaTime / 1000)
```

### Income Multiplier
```
Per license income:
  baseIncome × (1 + stars × 0.25)

Examples:
  1★ = 1.25× income
  2★ = 1.50× income
  3★ = 1.75× income
  4★ = 2.00× income
  5★ = 2.25× income
```

### Completion (100% volume filled)
- Contract shows "Collect $X" button
- Player clicks → money added to balance
- Contract removed from activeContracts
- Slot becomes empty

### Failure (time runs out)
- Contract disappears
- No partial income kept

---

## Contract Names

Procedurally generated from prefix + suffix:

### Prefixes
- "Neural"
- "Data"
- "Batch"
- "Streaming"
- "Inference"
- "Training"
- "ML"
- "Quantum"
- "Edge"
- "Cloud"

### Suffixes
- "Training Pack"
- "Inference Bundle"
- "Batch Set"
- "Pipeline Pack"
- "Model Bundle"
- "Dataset Set"
- "Processing Pack"

---

## UI Components

### Contract Popup (Add Contract flow)
1. Player clicks "Add Contract" on empty slot
2. Popup shows 3 random contracts
3. Player clicks a contract to select it
4. Draggable contract appears under cursor
5. Player drags to a license
6. Confirmation popup: "Start [Contract Name] on [License Name]?"
7. Player confirms → contract starts with exact time now visible

### Active Contract Display (on license)
- Small badge overlay on license card showing:
  - Contract name (truncated if needed)
  - Multiplier stars
  - Progress bar (volume filled / volume total)
- License card remains unchanged otherwise

### Contract Slot Display (in Hosting tab)
- Empty: "+ Add Contract" button
- Active: Contract badge with progress, collect button if complete

### Collect Button
- Only visible when contract volume is 100% filled
- Shows calculated payout
- Click → money added, slot cleared

---

## Testing Requirements

### Unit Tests (Core Logic)
1. **Contract Generation**
   - Volume is always completable by some active license
   - Star distribution is correct
   - Time range matches star tier

2. **Progress Calculation**
   - Volume filled increments correctly based on license bandwidth
   - Progress caps at 100% (don't overflow)

3. **Completion**
   - Contract completes when volumeFilledBytes >= volumeBytes
   - Exact timeLimitSeconds is set on start (not before)

4. **Failure**
   - Contract fails when timeLimitSeconds elapsed
   - Partial income is NOT retained on failure

---

## Implementation Notes

- Contracts use the existing `useGameState` pattern
- License income calculation needs to check for active contracts and apply multiplier
- Drag-and-drop uses existing patterns from the codebase
- Modal/popup follows existing GameUI patterns
- Progress bar uses existing `.progress-bar` CSS classes
