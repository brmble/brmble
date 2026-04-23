These are excellent refinements. Moving to a **Slot-based system** with **Fixed IDs** and **Fair Distribution** will make your game much more stable and professional. It prevents UI bugs and makes the gameplay feel "fair" to the player.

Here is the updated implementation plan for a junior developer.

---

## Step 1: Update Data Structures (`types.ts`)
We will transition from a single dealer to a fixed-size array representing three "slots."

1.  **Modify `GameState`**:
    * **`activeDealers`**: Change to `(Dealer | null)[]`. We will initialize this as an array of length 3: `[Dealer, null, null]`.
    * **`unlockedSlots`**: A number (1, 2, or 3) to track how many of those slots the player has paid for.

```typescript
export interface GameState {
  // ... existing fields
  activeDealers: (Dealer | null)[]; // Fixed length of 3
  unlockedSlots: number;           // Starts at 1
}
```

---

## Step 2: Define Costs (`constants.ts`)
Store your unlock costs in the constants file to keep the logic clean.

```typescript
export const SLOT_UNLOCK_COSTS = [0, 1000, 100000]; // Slot 0 is free, 1 is $1k, 2 is $100k
```

---

## Step 3: Refactor the Engine Logic (`useGameEngine.ts`)
This is where the "Fair Distribution" and "ID-based actions" happen.

### A. The "Fair" Distribution Tick
Instead of letting Dealer 1 eat everything first, we calculate total demand. If stock is low, everyone gets a percentage of what’s left.

1.  **Calculate Total Demand**: Sum the `volume` of all active dealers selling a specific product.
2.  **Calculate Supply Ratio**: If `TotalDemand > Stock`, the ratio is `Stock / TotalDemand`. Otherwise, the ratio is `1`.
3.  **Distribute**: Each dealer sells `DealerVolume * Ratio`.

### B. ID-Based Actions
When a player clicks "Fire" or "Bribe," pass the `dealer.id` instead of an index. This ensures you never accidentally fire the wrong person if the list shifts.

```typescript
const fireDealer = (dealerId: string) => {
  setState(prev => ({
    ...prev,
    activeDealers: prev.activeDealers.map(slot => 
      slot?.id === dealerId ? null : slot
    )
  }));
};
```

### C. Unlock Slot Function
```typescript
const unlockNextSlot = () => {
  setState(prev => {
    const cost = SLOT_UNLOCK_COSTS[prev.unlockedSlots];
    if (prev.money < cost || prev.unlockedSlots >= 3) return prev;
    return {
      ...prev,
      money: prev.money - cost,
      unlockedSlots: prev.unlockedSlots + 1
    };
  });
};
```

---

## Step 4: UI Refactoring (`NeonDGame.tsx`)
In your render function, you will no longer check for one dealer. You will "map" through the slots.

1.  **Render Loop**: Map through `state.activeDealers` (which always has 3 items).
2.  **Conditional Rendering**:
    * **IF `index >= state.unlockedSlots`**: Show "Locked Slot" + "Unlock for $X" button.
    * **ELSE IF `slot === null`**: Show "Empty Slot" + "Hire from Pool" button.
    * **ELSE**: Show the Dealer’s stats, "Fire" button, and "Bribe" toggle.

---

## Why this approach is better for a Junior Developer:

### 1. Stability (ID vs Index)
By using `dealer.id` to target actions, you avoid the "shifting array" bug. If the UI is slightly behind a state update, the ID check `slot?.id === dealerId` will simply do nothing if the ID isn't found, rather than deleting the wrong dealer.

### 2. UI Predictability (The Slot System)
Using `(Dealer | null)[]` means your layout is constant. You don't have cards jumping around or disappearing. You have three physical boxes on the screen: they are either locked, empty, or full. This is much easier to style in CSS.

### 3. Player Satisfaction (Fair Tick)
The proportional distribution logic is crucial. 
> **Example:** If you have 10g of Weed and two dealers who both want 10g, they will each sell 5g. 
In the old "sequential" plan, Dealer A would sell 10g and Dealer B would sell 0g. Proportional distribution ensures the player feels that all their "hired help" is contributing, even when production is low.

