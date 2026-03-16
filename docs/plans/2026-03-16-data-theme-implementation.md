# Data Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Transform the idle game from farm theme to data hosting theme, replacing crops with infrastructure, adding services, and implementing bandwidth-based income.

**Architecture:** Modify existing game state in types.ts, update UI components to reflect new naming (infrastructure, bandwidth, services), add new services tab with automatic/manual toggle.

**Tech Stack:** React, TypeScript, localStorage for persistence

---

## Files to Modify
- `src/Brmble.Web/src/components/Game/types.ts` - Update interfaces and initial data
- `src/Brmble.Web/src/components/Game/useGameState.ts` - Update game logic for bandwidth/services
- `src/Brmble.Web/src/components/Game/GameUI.tsx` - Update UI tabs and components
- `src/Brmble.Web/src/components/Game/GameUI.css` - Update styling for new components

---

### Task 1: Update types.ts - Infrastructure Interface and Data

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/types.ts`

**Step 1: Update Crop interface to Infrastructure**

Replace the Crop interface with Infrastructure interface:
```typescript
export interface Infrastructure {
  id: string;
  name: string;
  baseCost: number;
  baseUpload: number; // bytes per second
  owned: number;
  unlocked: boolean;
  unlockCost?: number;
  upgrade1Level: number;
  upgrade1Cost: number;
  upgrade2Level: number;
  upgrade2Cost: number;
  upgrade3Level: number;
  upgrade3Cost: number;
}
```

**Step 2: Add Service interface**

```typescript
export interface Service {
  id: string;
  name: string;
  bandwidthRequired: number; // bytes per second
  incomePerSecond: number;
  unlocked: boolean;
  unlockRequirement: number; // money threshold to unlock
  automatic: boolean; // auto-active if bandwidth available
  active: boolean; // current toggle state
}
```

**Step 3: Update GameState interface**

```typescript
export interface GameState {
  money: number;
  incomePerSecond: number;
  uploadSpeed: number; // total bandwidth in bytes/sec
  bandwidthSold: number; // consumed bandwidth
  infrastructure: Infrastructure[];
  services: Service[];
  upgrades: Upgrade[];
  lastSaved: number;
}
```

**Step 4: Define Infrastructure data**

```typescript
export const INITIAL_INFRASTRUCTURE: Infrastructure[] = [
  { id: 'usb-uploader', name: 'USB Uploader', baseCost: 10, baseUpload: 1024, owned: 0, unlocked: true, upgrade1Level: 0, upgrade1Cost: 50, upgrade2Level: 0, upgrade2Cost: 75, upgrade3Level: 0, upgrade3Cost: 100 },
  { id: 'home-server', name: 'Home Server', baseCost: 100, baseUpload: 8192, owned: 0, unlocked: true, upgrade1Level: 0, upgrade1Cost: 150, upgrade2Level: 0, upgrade2Cost: 225, upgrade3Level: 0, upgrade3Cost: 300 },
  // ... all 13 tiers from design doc
];
```

**Step 5: Define Service data**

```typescript
export const INITIAL_SERVICES: Service[] = [
  { id: 'personal-website', name: 'Personal Website', bandwidthRequired: 1024, incomePerSecond: 1, unlocked: true, unlockRequirement: 0, automatic: true, active: true },
  { id: 'blog-hosting', name: 'Blog Hosting', bandwidthRequired: 5120, incomePerSecond: 4, unlocked: false, unlockRequirement: 100, automatic: true, active: false },
  { id: 'file-hosting', name: 'File Hosting', bandwidthRequired: 20480, incomePerSecond: 15, unlocked: false, unlockRequirement: 500, automatic: true, active: false },
  // ... manual services from design doc
];
```

**Step 6: Update INITIAL_STATE**

```typescript
export const INITIAL_STATE: GameState = {
  money: 20,
  incomePerSecond: 0,
  uploadSpeed: 0,
  bandwidthSold: 0,
  infrastructure: INITIAL_INFRASTRUCTURE,
  services: INITIAL_SERVICES,
  upgrades: INITIAL_UPGRADES,
  lastSaved: Date.now(),
};
```

**Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Game/types.ts
git commit -m "feat: add infrastructure and service types for data theme"
```

---

### Task 2: Update useGameState.ts - Game Logic

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`

**Step 1: Update helper functions for bandwidth**

Replace calculateIncome with calculateBandwidth:
```typescript
function calculateBandwidth(infra: Infrastructure[]): number {
  return infra.reduce((total, item) => {
    if (!item.unlocked) return total;
    const upgrade1Multiplier = 1 + (item.upgrade1Level * 0.25);
    const upgrade2Multiplier = 1 + (item.upgrade2Level * 0.25);
    const upgrade3Multiplier = 1 + (item.upgrade3Level * 0.25);
    const totalMultiplier = upgrade1Multiplier * upgrade2Multiplier * upgrade3Multiplier;
    return total + Math.floor(item.baseUpload * item.owned * totalMultiplier);
  }, 0);
}
```

**Step 2: Add calculateIncome function**

```typescript
function calculateIncome(services: Service[], bandwidth: number): { income: number; bandwidthUsed: number } {
  let bandwidthUsed = 0;
  let income = 0;
  
  for (const service of services) {
    if (!service.unlocked || !service.active) continue;
    if (bandwidthUsed + service.bandwidthRequired <= bandwidth) {
      bandwidthUsed += service.bandwidthRequired;
      income += service.incomePerSecond;
    }
  }
  
  return { income, bandwidthUsed };
}
```

**Step 3: Update state initialization to load services**

Keep existing localStorage loading but ensure services are loaded.

**Step 4: Add effects for bandwidth and income calculation**

```typescript
useEffect(() => {
  const bandwidth = calculateBandwidth(state.infrastructure);
  const { income, bandwidthUsed } = calculateIncome(state.services, bandwidth);
  setState(prev => ({ ...prev, uploadSpeed: bandwidth, bandwidthSold: bandwidthUsed, incomePerSecond: income }));
}, [state.infrastructure, state.services]);
```

**Step 5: Add service action callbacks**

Add to GameActions interface:
```typescript
buyInfrastructure: (infraId: string) => void;
upgradeInfra1: (infraId: string) => void;
upgradeInfra2: (infraId: string) => void;
upgradeInfra3: (infraId: string) => void;
unlockInfrastructure: (infraId: string) => void;
toggleService: (serviceId: string) => void;
unlockService: (serviceId: string) => void;
```

**Step 6: Implement buyInfrastructure**

```typescript
const buyInfrastructure = useCallback((infraId: string) => {
  setState(prev => {
    const infra = prev.infrastructure.find(i => i.id === infraId);
    if (!infra || !infra.unlocked) return prev;
    const cost = Math.floor(infra.baseCost * Math.pow(1.15, infra.owned));
    if (prev.money < cost) return prev;
    const newInfra = prev.infrastructure.map(i => i.id === infraId ? { ...i, owned: i.owned + 1 } : i);
    return { ...prev, infrastructure: newInfra, money: prev.money - cost };
  });
}, []);
```

**Step 7: Implement upgrade functions**

Similar pattern to existing upgradeSoil/upgradeFertilizer/upgradeSeeds but for upgrade1/2/3.

**Step 8: Implement unlockInfrastructure**

Same pattern as unlockCrop.

**Step 9: Implement toggleService**

```typescript
const toggleService = useCallback((serviceId: string) => {
  setState(prev => {
    const service = prev.services.find(s => s.id === serviceId);
    if (!service || !service.unlocked) return prev;
    
    // Check if there's enough bandwidth
    const currentUsed = prev.bandwidthSold;
    const wouldBeUsed = service.active 
      ? currentUsed - service.bandwidthRequired 
      : currentUsed + service.bandwidthRequired;
    
    if (!service.active && wouldBeUsed > prev.uploadSpeed) return prev; // Not enough bandwidth
    
    return {
      ...prev,
      services: prev.services.map(s => s.id === serviceId ? { ...s, active: !s.active } : s)
    };
  });
}, []);
```

**Step 10: Implement unlockService**

```typescript
const unlockService = useCallback((serviceId: string) => {
  setState(prev => {
    const service = prev.services.find(s => s.id === serviceId);
    if (!service || service.unlocked || prev.money < service.unlockRequirement) return prev;
    return {
      ...prev,
      services: prev.services.map(s => s.id === serviceId ? { ...s, unlocked: true } : s),
      money: prev.money - service.unlockRequirement
    };
  });
}, []);
```

**Step 11: Update actions object**

Add new actions to the actions object.

**Step 12: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat: add bandwidth and services game logic"
```

---

### Task 3: Update GameUI.tsx - UI Components

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

**Step 1: Update imports**

Import Infrastructure and Service types:
```typescript
import type { Infrastructure, Service } from './types';
```

**Step 2: Update TabId type**

```typescript
type TabId = 'infrastructure' | 'upgrades' | 'hosting' | 'options';
```

**Step 3: Update visibleInfrastructure filter**

Replace visibleCrops with visibleInfrastructure.

**Step 4: Update tab rendering**

Replace 'crops' tab with 'infrastructure' tab.

**Step 5: Add HostingTab component**

```typescript
interface HostingTabProps {
  services: Service[];
  uploadSpeed: number;
  bandwidthSold: number;
  onToggleService: (serviceId: string) => void;
  onUnlockService: (serviceId: string) => void;
  money: number;
}

function formatBandwidth(bytes: number): string {
  if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(2) + ' TB/s';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB/s';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB/s';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB/s';
  return bytes + ' B/s';
}

function HostingTab({ services, uploadSpeed, bandwidthSold, onToggleService, onUnlockService, money }: HostingTabProps) {
  return (
    <div className="hosting-tab">
      <div className="hosting-stats">
        <div className="stat">
          <span className="stat-label">Available:</span>
          <span className="stat-value">{formatBandwidth(uploadSpeed - bandwidthSold)}</span>
        </div>
      </div>
      
      <div className="services-section">
        <h3 className="heading-label">Automatic Services</h3>
        {services.filter(s => s.automatic).map(service => (
          <ServiceRow key={service.id} service={service} onToggle={onToggleService} onUnlock={onUnlockService} money={money} />
        ))}
      </div>
      
      <div className="services-section">
        <h3 className="heading-label">Manual Services</h3>
        {services.filter(s => !s.automatic).map(service => (
          <ServiceRow key={service.id} service={service} onToggle={onToggleService} onUnlock={onUnlockService} money={money} />
        ))}
      </div>
    </div>
  );
}

function ServiceRow({ service, onToggle, onUnlock, money }: { service: Service; onToggle: (id: string) => void; onUnlock: (id: string) => void; money: number }) {
  if (!service.unlocked) {
    return (
      <div className="service-row locked">
        <span className="service-name">{service.name}</span>
        <span className="service-requirement">Unlock: ${service.unlockRequirement.toLocaleString()}</span>
        <button className="btn btn-secondary" disabled={money < service.unlockRequirement} onClick={() => onUnlock(service.id)}>
          Unlock
        </button>
      </div>
    );
  }
  
  return (
    <div className={`service-row ${service.active ? 'active' : 'inactive'}`}>
      <span className="service-name">{service.name}</span>
      <span className="service-bandwidth">{formatBandwidth(service.bandwidthRequired)}</span>
      <span className="service-income">${service.incomePerSecond.toLocaleString()}/s</span>
      <button className={`btn ${service.active ? 'btn-danger' : 'btn-primary'}`} onClick={() => onToggle(service.id)}>
        {service.active ? 'Stop' : 'Start'}
      </button>
    </div>
  );
}
```

**Step 6: Update InfrastructureTab component**

Replace CropsTab with InfrastructureTab, update prop names and display.

**Step 7: Update Header component**

Add uploadSpeed and bandwidthSold to header display:
```typescript
function Header({ money, income, uploadSpeed, bandwidthSold }: { money: number; income: number; uploadSpeed: number; bandwidthSold: number }) {
  return (
    <header className="game-header">
      <div className="header-stat">
        <span className="header-label">MONEY:</span>
        <span className="header-value currency">${formatNumber(money)}</span>
      </div>
      <div className="header-stat">
        <span className="header-label">UPLOAD:</span>
        <span className="header-value upload">{formatBandwidth(uploadSpeed)}</span>
      </div>
      <div className="header-stat">
        <span className="header-label">SOLD:</span>
        <span className="header-value bandwidth">{formatBandwidth(bandwidthSold)}</span>
      </div>
      <div className="header-stat">
        <span className="header-label">INCOME:</span>
        <span className="header-value income">+${formatNumber(income)}/s</span>
      </div>
    </header>
  );
}
```

**Step 8: Update TabNav tabs**

```typescript
const tabs: { id: TabId; label: string }[] = [
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'upgrades', label: 'Tech Upgrades' },
  { id: 'hosting', label: 'Hosting' },
  { id: 'options', label: 'Options' },
];
```

**Step 9: Update activeTab state initialization**

```typescript
const [activeTab, setActiveTab] = useState<TabId>('infrastructure');
```

**Step 10: Update render to include HostingTab**

**Step 11: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx
git commit -m "feat: add infrastructure, hosting UI tabs"
```

---

### Task 4: Update GameUI.css - Styling

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.css`

**Step 1: Add hosting tab styles**

```css
.hosting-tab {
  padding: 16px;
}

.hosting-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted, #888);
}

.stat-value {
  font-size: 18px;
  font-family: var(--font-mono);
}

.services-section {
  margin-bottom: 24px;
}

.service-row {
  display: grid;
  grid-template-columns: 1fr 100px 100px 80px;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: var(--bg-secondary, #2a2a2a);
  border-radius: 8px;
  margin-bottom: 8px;
}

.service-row.locked {
  opacity: 0.6;
}

.service-row.active {
  border-left: 3px solid #4caf50;
}

.service-name {
  font-weight: 600;
}

.service-bandwidth,
.service-income {
  font-family: var(--font-mono);
  font-size: 14px;
}

.service-requirement {
  font-size: 12px;
  color: var(--text-muted, #888);
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.css
git commit -m "feat: add hosting tab styles"
```

---

### Task 5: Verify and Test

**Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 2: Test in development**

Run: `npm run dev`
Expected: Game loads with new data theme

**Step 3: Test game mechanics**
- Buy USB Uploader → verify bandwidth increases
- Verify Personal Website auto-generates income
- Unlock and toggle manual services
- Verify bandwidth limits work

**Step 4: Commit**

```bash
git commit -m "feat: complete data theme implementation"
```

---

## Plan complete

Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
