This is a classic "Choice Reward" pattern. Currently, your code picks one random upgrade and applies it immediately, which removes the strategic element you're looking for.

To fix this, we need to separate the **generation** of options from the **application** of the upgrade. Here is your step-by-step plan.

---

### Step 1: Update the Hook (`useGameEngine.ts`)
We need to change `buyEquipment` so it no longer picks a random upgrade itself. Instead, it should just accept the specific upgrade the player clicked on.

**Find your `buyEquipment` function and replace it with this:**

```typescript
const buyEquipment = (dealerId: string, upgrade: DealerUpgrade) => {
  setState(prev => {
    const dealer = prev.activeDealers.find(d => d?.id === dealerId);
    if (!dealer || dealer.equipmentCount >= 3) return prev;

    const upgradeCost = 500 * Math.pow(2.5, dealer.equipmentCount);
    if (prev.money < upgradeCost) return prev;

    const nextDealers = prev.activeDealers.map(d => {
      if (d?.id !== dealerId) return d;
      const newDealer = { ...d, equipmentCount: d.equipmentCount + 1 };
      
      if (upgrade.type === 'VOLUME') newDealer.volumeBonus += upgrade.value;
      if (upgrade.type === 'MARGIN') newDealer.marginBonus += upgrade.value;
      if (upgrade.type === 'SIDE_HUSTLE' && upgrade.targetProductId) {
        newDealer.sideHustle = { 
          ...d.sideHustle, 
          [upgrade.targetProductId]: (d.sideHustle[upgrade.targetProductId] || 0) + upgrade.value 
        };
      }
      return newDealer;
    });

    return { ...prev, money: prev.money - upgradeCost, activeDealers: nextDealers };
  });
};
```

---

### Step 2: Prepare the UI Logic (`NeonDGame.tsx`)
In your main component, you need a way to "hold" the three options while the user is deciding. We'll use local React state for this since it doesn't need to be in the global game state.

**Add these state variables inside the `NeonDGame` component:**

```tsx
// Track which dealer is currently being upgraded and what the 3 options are
const [upgradingDealer, setUpgradingDealer] = useState<{
  dealerId: string;
  options: DealerUpgrade[];
} | null>(null);
```

---

### Step 3: Create the "Option Generator" Function
You need a helper function to roll three unique options. Add this inside your `NeonDGame` component or as a utility:

```tsx
const generateUpgradeOptions = (dealer: Dealer): DealerUpgrade[] => {
  const possibleUpgrades: DealerUpgrade[] = [
    { type: 'VOLUME', label: 'High Capacity', description: 'Volume +0.2', value: 0.2 },
    { type: 'MARGIN', label: 'Premium Cut', description: 'Margin +0.2', value: 0.2 },
    ...state.unlockedProduction
      .filter(id => id !== dealer.selling)
      .map(id => ({
        type: 'SIDE_HUSTLE' as const,
        label: `Side Hustle: ${state.production[id]?.name}`,
        description: 'Sell a second product at 10% volume',
        value: 0.1,
        targetProductId: id
      }))
  ];

  // Shuffle and pick 3
  return [...possibleUpgrades]
    .sort(() => 0.5 - Math.random())
    .slice(0, 3);
};
```

---

### Step 4: The Selection UI (The "Choice Menu")
Now, we need to actually show these options to the player. You can add this piece of JSX at the bottom of your main `container` div.

```tsx
{upgradingDealer && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.85)', display: 'flex', 
    alignItems: 'center', justifyContent: 'center', zIndex: 1000
  }}>
    <div className="glass-panel" style={{ padding: 'var(--space-xl)', maxWidth: '500px' }}>
      <h3 className={styles.columnHeader}>Select Equipment</h3>
      <div style={{ display: 'grid', gap: '10px', marginTop: '20px' }}>
        {upgradingDealer.options.map((opt, i) => (
          <button 
            key={i} 
            className={styles.buyButton}
            onClick={() => {
              buyEquipment(upgradingDealer.dealerId, opt);
              setUpgradingDealer(null); // Close the menu
            }}
          >
            <div style={{ fontWeight: 'bold' }}>{opt.label}</div>
            <div style={{ fontSize: '10px', opacity: 0.8 }}>{opt.description}</div>
          </button>
        ))}
      </div>
      <button 
        className={styles.dangerButton} 
        style={{ marginTop: '20px' }}
        onClick={() => setUpgradingDealer(null)}
      >
        Cancel
      </button>
    </div>
  </div>
)}
```

---

### Step 5: Update the "Upgrade" Button Trigger
Finally, change the `onClick` of your existing Upgrade button in `NeonDGame.tsx` to trigger this selection process instead of calling the engine directly.

**Replace the old `onClick` with this:**

```tsx
<button
  className={styles.buyButton}
  disabled={isMaxed || state.money < upgradeCost}
  onClick={() => {
    if (isMaxed) return;
    // Generate the 3 options and show the menu
    const options = generateUpgradeOptions(dealer);
    setUpgradingDealer({ dealerId: dealer.id, options });
  }}
>
  {isMaxed ? 'MAXED OUT' : `Upgrade ($${Math.floor(upgradeCost).toLocaleString()})`}
</button>
```

### Why this is better:
1.  **Agency:** Players feel more involved when they can choose between "Higher Volume" vs "Side Hustle."
2.  **Safety:** By checking money in the button but only *deducting* it once the choice is clicked, you prevent the game from taking money if the player accidentally clicks the wrong thing.
3.  **Future-proof:** You can easily add more wild upgrade types (like "Bribe Discount" or "Speed Boost") to the `possibleUpgrades` list later!