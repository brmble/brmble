To fix the missing earnings display and address your colleague's valid points about code hygiene without over-complicating the logic, follow these three steps.

### 1. Centralize the Bribe Rate
Update your **`constants.ts`** file to include a central constant. This prevents "magic numbers" (like 0.1) from being scattered across your logic and UI.

```typescript
// Add this to constants.ts
export const BRIBE_RATE = 0.10; 
```

Then, update the `tick` function in **`useGameEngine.ts`** to use this constant:

```typescript
// Inside useGameEngine.ts tick function
const bribeCost = dealer.bribeLevel > 0 ? earnedThisTick * BRIBE_RATE : 0;
```

---

### 2. Add the Calculation Helper
Add this function inside the `NeonDGame` component in **`NeonDGame.tsx`**. It handles the math for a single dealer by comparing their volume to your current production output.

```typescript
// Inside NeonDGame.tsx
const getIndividualDealerEarnings = (dealer: Dealer) => {
  const activeProd = state.production[dealer.selling];
  if (!activeProd) return 0;

  // Calculate based on what is actually available to sell
  const actualGramsSold = Math.min(activeProd.rate, dealer.volume);
  const tierMult = PRODUCT_TIERS[dealer.selling] || 1;
  const gross = actualGramsSold * (dealer.margin * tierMult);
  
  const bribe = dealer.bribeLevel > 0 ? gross * BRIBE_RATE : 0;
  return gross - bribe;
};
```

---

### 3. Update the Distribution UI
Update the `activeDealers.map` section in **`NeonDGame.tsx`**. We will calculate the earnings **once** at the start of the render block for each dealer to ensure the UI is efficient and clean.

```tsx
{/* Inside state.activeDealers.map in NeonDGame.tsx */}
return (
  <div key={slot.id} className={`glass-panel ${styles.distributionCard}`} style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
    <div className={styles.dealerHeader}>
      {slot.name} ({state.production[slot.selling]?.name})
    </div>
    
    <div style={{ padding: 'var(--space-md)' }}>
      {/* ... existing Slot and Selling rows ... */}

      <div className={styles.statRow}>
        <span className={styles.label}>Volume:</span>
        <StarRating rating={slot.volume} />
      </div>
      <div className={styles.statRow}>
        <span className={styles.label}>Margin:</span>
        <StarRating rating={slot.margin} />
      </div>

      {/* NEW EARNINGS DISPLAY SECTION */}
      {(() => {
        const earnings = getIndividualDealerEarnings(slot);
        const potentialBribeCost = (earnings / (1 - BRIBE_RATE)) * BRIBE_RATE;

        return (
          <>
            <div className={styles.statRow} style={{ marginTop: 'var(--space-xs)', borderTop: '1px solid var(--glass-border)', paddingTop: 'var(--space-xs)' }}>
              <span className={styles.label}>Earnings:</span>
              <span className={styles.salesRate} style={{ fontWeight: 'bold' }}>
                +${earnings.toFixed(2)}/s
              </span>
            </div>

            <div style={{ marginTop: 'var(--space-sm)', display: 'grid', gap: 'var(--space-xs)' }}>
              <button
                className={styles.buyButton}
                style={{ opacity: slot.bribeLevel === 0 ? 1 : 0.5 }}
                onClick={() => handleSetBribe(slot.id, 0)}
              >
                Bribe Off
              </button>
              <button
                className={styles.buyButton}
                style={{ background: 'var(--accent-success)', opacity: slot.bribeLevel === 1 ? 1 : 0.5 }}
                onClick={() => handleSetBribe(slot.id, 1)}
              >
                Bribe On {earnings > 0 ? `(-$${potentialBribeCost.toFixed(2)}/s)` : ''}
              </button>
            </div>
          </>
        );
      })()}

      <div style={{ marginTop: 'var(--space-lg)', display: 'grid', gap: 'var(--space-xs)' }}>
        <button className={styles.buyButton}>Buy Equipment</button>
        <button className={styles.dangerButton} onClick={() => fireDealer(slot.id)}>Fire</button>
      </div>
    </div>
  </div>
);
```

### Why this works:
* **Performance**: By using the immediately-invoked function expression `(() => { ... })()` inside the map, we calculate `earnings` once and reuse it for both the text display and the button label.
* **Style**: It uses the existing `styles.salesRate` class to keep the "money-out" stats visually consistent with your production stats.
* **Scalability**: By moving the bribe logic to `BRIBE_RATE`, you can change the difficulty of the whole game by editing a single number in `constants.ts`.