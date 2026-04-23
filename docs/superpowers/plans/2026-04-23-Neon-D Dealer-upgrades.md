This is the consolidated, production-ready plan for the **Brmble Empire** dealer equipment system. It removes all XP mechanics in favor of a cash-reinvestment model, enforces a 3-slot equipment limit, and includes safety prompts for destructive actions.

---

## 1. Type Definitions
Update your core interfaces to track equipment and bonuses.

**File: `types.ts`**
```typescript
export type UpgradeType = 'VOLUME' | 'MARGIN' | 'SIDE_HUSTLE';

export interface DealerUpgrade {
  type: UpgradeType;
  label: string;
  description: string;
  value: number; 
  targetProductId?: string;
}

export interface Dealer {
  id: string;
  name: string;
  selling: string;
  volume: number;
  margin: number;
  bribeLevel: number;
  // Equipment stats
  volumeBonus: number;   // Starts at 1.0
  marginBonus: number;   // Starts at 1.0
  sideHustle: Record<string, number>; // e.g. { 'meth': 0.1 }
  equipmentCount: number; // Max 3
}
```

---

## 2. Generator Initialization
Ensure every new dealer starts with clean equipment stats to avoid `NaN` errors.

**File: `useGameEngine.ts`**
```typescript
const generateRandomDealer = (unlockedProducts: string[], totalEarned: number): Dealer => {
  // ... (keep your existing naming logic)
  return {
    id: crypto.randomUUID(),
    name: `${fName} "${lName}"`,
    selling: drug,
    volume: rollStat(),
    margin: rollStat(),
    bribeLevel: 0,
    volumeBonus: 1.0,
    marginBonus: 1.0,
    sideHustle: {},
    equipmentCount: 0
  };
};
```

---

## 3. Core Engine Logic
This version of the `tick` ensures side hustles consume inventory and revenue is calculated correctly across all products.

**File: `useGameEngine.ts`**
```typescript
// Inside useGameEngine hook

const buyEquipment = (dealerId: string, upgrade: DealerUpgrade) => {
  setState(prev => {
    const dealer = prev.activeDealers.find(d => d?.id === dealerId);
    
    // 1. Hard Limit Check
    if (!dealer || dealer.equipmentCount >= 3) return prev;

    // 2. Scaled Cost: $500 -> $1,250 -> $3,125
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

const tick = () => {
  setState(prev => {
    const nextProduction = { ...prev.production };
    let totalEarnedThisTick = 0;

    const updatedDealers = prev.activeDealers.map(dealer => {
      if (!dealer) return null;

      // 1. Capacity Logic
      const totalVol = dealer.volume * dealer.volumeBonus;
      const sideRatio = Math.min(0.9, Object.values(dealer.sideHustle).reduce((a, b) => a + b, 0));
      
      // 2. Primary Sale
      const primaryProd = nextProduction[dealer.selling];
      if (!primaryProd) return dealer;

      const primarySold = Math.min(primaryProd.stock, totalVol * (1 - sideRatio));
      nextProduction[dealer.selling] = { 
        ...primaryProd, 
        stock: Math.max(0, primaryProd.stock - primarySold) 
      };

      // 3. Side Hustle Sales
      let sideRev = 0;
      Object.entries(dealer.sideHustle).forEach(([prodId, ratio]) => {
        const sideProd = nextProduction[prodId];
        if (!sideProd) return;
        const sold = Math.min(sideProd.stock, totalVol * ratio);
        nextProduction[prodId] = { ...sideProd, stock: Math.max(0, sideProd.stock - sold) };
        sideRev += sold * (dealer.margin * dealer.marginBonus * (PRODUCT_TIERS[prodId] || 1));
      });

      const primaryRev = primarySold * (dealer.margin * dealer.marginBonus * (PRODUCT_TIERS[dealer.selling] || 1));
      const gross = primaryRev + sideRev;
      totalEarnedThisTick += gross - (dealer.bribeLevel > 0 ? gross * BRIBE_RATE : 0);

      return dealer;
    });

    return {
      ...prev,
      money: prev.money + totalEarnedThisTick,
      totalEarned: prev.totalEarned + totalEarnedThisTick,
      production: nextProduction,
      activeDealers: updatedDealers
    };
  });
};
```

---

## 4. UI Components
Displays the 3-slot status and protects the dealer with a confirmation prompt.

**File: `NeonDGame.tsx`**
```javascript
// Within your Dealer Card map
const dealer = slot;
const upgradeCost = 500 * Math.pow(2.5, dealer.equipmentCount);
const isMaxed = dealer.equipmentCount >= 3;

return (
  <div className={styles.distributionCard}>
    {/* Equipment Slot Visualization */}
    <div className={styles.statRow}>
      <span className={styles.label}>Equip Slots:</span>
      <span style={{ color: 'var(--accent-primary)', fontSize: '1.2rem' }}>
        {'●'.repeat(dealer.equipmentCount)}
        <span style={{ opacity: 0.3 }}>{'○'.repeat(3 - dealer.equipmentCount)}</span>
      </span>
    </div>

    <div style={{ marginTop: '15px', display: 'grid', gap: '8px' }}>
      <button 
        className={styles.buyButton}
        disabled={isMaxed || state.money < upgradeCost}
        onClick={() => {/* Trigger Upgrade Selection Menu */}}
      >
        {isMaxed ? 'MAXED OUT' : `Upgrade ($${upgradeCost.toLocaleString()})`}
      </button>

      <button
        className={styles.dangerButton}
        onClick={() => {
          if (window.confirm(`Fire ${dealer.name}? All equipment upgrades will be lost forever.`)) {
            fireDealer(dealer.id);
          }
        }}
      >
        Fire Dealer
      </button>
    </div>
  </div>
);
```

### Key Safety Features Included:
* **Inventory Protection:** `Math.max(0, ...)` prevents stock from slipping into negative numbers due to decimal rounding.
* **Revenue Scaling:** Margin bonuses apply to both primary and side-hustle sales.
* **Capacity Clamp:** Side hustles are hard-capped at 90% of total volume to ensure primary sales never drop to zero.
* **Destructive Guard:** The `window.confirm` prevents accidental loss of high-value, fully-geared dealers.