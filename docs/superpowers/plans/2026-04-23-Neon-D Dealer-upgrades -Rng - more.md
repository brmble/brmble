This plan provides a technical roadmap for removing the unimplemented bribe mechanics and replacing them with a weighted "Equipment" system where the **Side Hustle** acts as a rare jackpot.

---

### Phase 1: Data Model & Cleanup
The junior developer must first remove the "dead code" related to bribes and prepare the `Dealer` structure for more complex bonuses.

**1. Update `types.ts`**
* **Modify `UpgradeType`**: Add the new upgrade categories.
    * `export type UpgradeType = 'VOLUME' | 'MARGIN' | 'SIDE_HUSTLE' | 'NETWORK' | 'ALL_AROUNDER';`
* **Modify `Dealer`**: Remove `bribeLevel`.
    * **Why it’s good**: Simplifies state management.
    * **Why it might be wrong**: If you want to add police pressure later, you’ll have to add this back.

**2. Cleanup `constants.ts` and `useGameEngine.ts`**
* **Remove `BRIBE_RATE`** from `constants.ts`.
* **In `useGameEngine.ts`**:
    * Remove `bribeLevel: 0` from `generateRandomDealer`.
    * **Update the `tick` function**: Remove the logic that calculates `bribeAmount`. The earnings line should simply be: `totalEarnedThisTick += gross;`.
    * **Delete `setBribeLevel`**: Remove the entire function and its reference in the return object.

---

### Phase 2: Implementing the Weighted RNG
In `NeonDGame.tsx`, the `generateUpgradeOptions` function needs to be rewritten to handle "rarity" so the Side Hustle feels like a jackpot.

**Step-by-Step for the Junior:**
1.  **Define a Weights Object**: Create a small helper to decide which type of upgrade appears in the three slots.
2.  **Filter Side Hustles**: Ensure a `SIDE_HUSTLE` only appears for drugs the player has already unlocked.
3.  **Implement the Roll**:

```typescript
// NeonDGame.tsx logic
const roll = Math.random();
if (roll < 0.10 && state.unlockedProduction.length > 1) {
  // 10% Chance: JACKPOT (Side Hustle)
} else if (roll < 0.30) {
  // 20% Chance: TRADE-OFF (Bulk Specialist / The Network)
} else {
  // 70% Chance: COMMON (Volume / Margin)
}
```

---

### Phase 3: The Equipment Catalog
The junior developer should implement the following logic inside the `generateUpgradeOptions` return objects:

| # | Upgrade Name | Effect | Rarity |
| :--- | :--- | :--- | :--- |
| **1** | **High Capacity** | `value: 0.15` (Volume +15%) | Common |
| **2** | **Premium Cut** | `value: 0.15` (Margin +15%) | Common |
| **3** | **Packaging Expert** | `value: 0.05` (Volume & Margin +5%) | Common |
| **4** | **Bulk Specialist** | `value: 0.35` (Volume +35%, Margin -10%) | Uncommon |
| **5** | **The Network** | `value: 0.10` (Side Hustle Efficiency +10%) | Uncommon |
| **6** | **Side Hustle** | **JACKPOT**: Sell a 2nd drug at 10% volume. | **Rare** |

---

### Phase 4: Engine Integration
The `buyEquipment` function in `useGameEngine.ts` must be updated to process these new effects.

**Instructions for the Junior:**
* Add a `case` or `if` block for `NETWORK`.
* Add the trade-off logic for `Bulk Specialist`. If the upgrade label is "Bulk Specialist," you must subtract from `marginBonus` while adding to `volumeBonus`.
* **Why it’s good**: Trade-offs force the player to think about their current stock.
* **Why it might be wrong**: If a player accidentally clicks a trade-off on a high-value drug, they might ruin their profit margin with no way to undo it besides firing the dealer.

---

### Phase 5: UI Polish
Finally, the junior should update the `NeonDGame.tsx` component to remove the old bribe buttons and style the new upgrades.

1.  **Remove Bribe UI**: Delete the `Bribe Off` and `Bribe On` buttons from the dealer card.
2.  **Highlight the Jackpot**: Update the upgrade selection modal.
    * **Action**: If `upgrade.type === 'SIDE_HUSTLE'`, apply a special CSS class (e.g., `styles.jackpotCard`) with a gold border or glow effect.
3.  **Earnings Display**: Ensure `getIndividualDealerEarnings` is updated to show the new simplified gross profit (Volume * Margin * Price) without bribe deductions.

How should the junior developer handle a situation where a dealer rolls a `SIDE_HUSTLE` for a product they are already selling as their primary?