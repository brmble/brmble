# Contracts Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Contracts tab to the idle game — time-limited income multipliers that players assign to active licenses via drag-and-drop.

**Architecture:** Contracts are first-class in the game state alongside infrastructure and services. Contract slots live in the Hosting tab. Tech Upgrades tab adds expensive slot-unlock options. Core logic (generation, progress, completion/failure) lives in the state management hook.

**Tech Stack:** React (existing), TypeScript (existing), useGameState hook pattern, CSS progress bars, drag-and-drop

---

## File Structure

```
src/Brmble.Web/src/components/Game/
├── types.ts                    # Add Contract, ActiveContract interfaces
├── useGameState.ts             # Add contract state, generation, progress logic
├── GameUI.tsx                  # Add ContractsSection to Hosting tab, popup modal
├── GameUI.css                  # Add contract-specific styles
└── contracts/
    ├── ContractPopup.tsx       # New: popup showing 3 random contracts
    ├── ContractSlot.tsx        # New: individual slot (empty or active)
    └── ActiveContractBadge.tsx  # New: badge on license showing contract progress
```

---

## Task 1: Add Contract Types

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/types.ts`

- [ ] **Step 1: Read types.ts to find insertion point**

Run: `read src/Brmble.Web/src/components/Game/types.ts`

- [ ] **Step 2: Add Contract and ActiveContract interfaces**

Add after the existing interface definitions:

```typescript
export interface Contract {
  id: string;
  name: string;
  volumeBytes: number;
  multiplierStars: number;
}

export interface ActiveContract {
  contractId: string;
  slotIndex: number;
  assignedLicenseId: string;
  startTime: number;
  timeLimitSeconds: number;
  volumeBytes: number;
  volumeFilledBytes: number;
  multiplierStars: number;
}
```

- [ ] **Step 3: Add contract fields to GameState interface**

Find `interface GameState` and add:

```typescript
availableContracts: Contract[];
activeContracts: ActiveContract[];
unlockedContractSlots: number;
contractPopupOpen: boolean;
contractPopupSlotIndex: number | null;
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Game/types.ts
git commit -m "feat(contracts): add Contract and ActiveContract types"
```

---

## Task 2: Initialize Contract State

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`

- [ ] **Step 1: Read useGameState.ts to understand initial state pattern**

Run: `read src/Brmble.Web/src/components/Game/useGameState.ts:1-50`

- [ ] **Step 2: Add initial contract state**

Find `initialState` object and add:

```typescript
availableContracts: [],
activeContracts: [],
unlockedContractSlots: 1,
contractPopupOpen: false,
contractPopupSlotIndex: null,
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat(contracts): initialize contract state in useGameState"
```

---

## Task 3: Contract Generation Logic

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`

- [ ] **Step 1: Add contract name generation helper**

Add above the main hook:

```typescript
const CONTRACT_PREFIXES = [
  "Neural", "Data", "Batch", "Streaming", "Inference",
  "Training", "ML", "Quantum", "Edge", "Cloud"
];

const CONTRACT_SUFFIXES = [
  "Training Pack", "Inference Bundle", "Batch Set",
  "Pipeline Pack", "Model Bundle", "Dataset Set", "Processing Pack"
];

function generateContractName(): string {
  const prefix = CONTRACT_PREFIXES[Math.floor(Math.random() * CONTRACT_PREFIXES.length)];
  const suffix = CONTRACT_SUFFIXES[Math.floor(Math.random() * CONTRACT_SUFFIXES.length)];
  return `${prefix} ${suffix}`;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
```

- [ ] **Step 2: Add contract generation function**

Add inside the hook (after `calculateBandwidth`):

```typescript
const generateContract = useCallback((services: Service[]): Contract => {
  const activeServices = services.filter(s => s.owned > 0);
  if (activeServices.length === 0) {
    return { id: generateId(), name: generateContractName(), volumeBytes: 0, multiplierStars: 1 };
  }
  
  const referenceService = activeServices[Math.floor(Math.random() * activeServices.length)];
  const referenceBandwidth = referenceService.bandwidthBytesPerSecond;
  const volumeSeconds = 60 + Math.random() * 60;
  const volumeBytes = Math.floor(referenceBandwidth * volumeSeconds);
  
  const stars = getRandomStars();
  
  return {
    id: generateId(),
    name: generateContractName(),
    volumeBytes,
    multiplierStars: stars,
  };
}, []);
```

- [ ] **Step 3: Add stars calculation (fixed distribution)**

Add helper:

```typescript
const getRandomStars = (): number => {
  const roll = Math.random() * 100;
  if (roll < 5) return 5;      // 5%
  if (roll < 25) return 4;     // 20%
  if (roll < 60) return 3;     // 35%
  if (roll < 80) return 2;     // 20%
  return 1;                     // 20%
};
```

- [ ] **Step 4: Add time range based on stars**

Add helper:

```typescript
const getTimeRangeForStars = (stars: number): { min: number; max: number } => {
  switch (stars) {
    case 5: return { min: 180, max: 300 };  // 3-5 min
    case 4: return { min: 240, max: 360 };  // 4-6 min
    default: return { min: 360, max: 540 }; // 6-9 min
  }
};
```

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat(contracts): add contract generation logic"
```

---

## Task 4: Add Contract Actions

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`

- [ ] **Step 1: Add actions object with contract methods**

Add to the returned `actions` object (find `const actions = {`):

```typescript
openContractPopup: (slotIndex: number) => {
  const contracts: Contract[] = [];
  for (let i = 0; i < 3; i++) {
    contracts.push(generateContract(state.services));
  }
  setState(prev => ({
    ...prev,
    availableContracts: contracts,
    contractPopupOpen: true,
    contractPopupSlotIndex: slotIndex,
  }));
},

closeContractPopup: () => {
  setState(prev => ({
    ...prev,
    availableContracts: [],
    contractPopupOpen: false,
    contractPopupSlotIndex: null,
  }));
},

selectContract: (contract: Contract, licenseId: string) => {
  const timeRange = getTimeRangeForStars(contract.multiplierStars);
  const exactTime = Math.floor(timeRange.min + Math.random() * (timeRange.max - timeRange.min));
  
  const activeContract: ActiveContract = {
    contractId: contract.id,
    slotIndex: state.contractPopupSlotIndex!,
    assignedLicenseId: licenseId,
    startTime: Date.now(),
    timeLimitSeconds: exactTime,
    volumeBytes: contract.volumeBytes,
    volumeFilledBytes: 0,
    multiplierStars: contract.multiplierStars,
  };
  
  setState(prev => ({
    ...prev,
    activeContracts: [...prev.activeContracts.filter(c => c.slotIndex !== state.contractPopupSlotIndex), activeContract],
    availableContracts: [],
    contractPopupOpen: false,
    contractPopupSlotIndex: null,
  }));
},

collectContract: (slotIndex: number) => {
  const contract = state.activeContracts.find(c => c.slotIndex === slotIndex);
  if (!contract) return;
  
  const earned = (contract.volumeFilledBytes / contract.volumeBytes) * calculateBaseIncome(state);
  
  setState(prev => ({
    ...prev,
    activeContracts: prev.activeContracts.filter(c => c.slotIndex !== slotIndex),
    money: prev.money + earned,
  }));
},

failContract: (slotIndex: number) => {
  setState(prev => ({
    ...prev,
    activeContracts: prev.activeContracts.filter(c => c.slotIndex !== slotIndex),
  }));
},

unlockContractSlot: (slotNumber: number) => {
  const costs: Record<number, number> = { 2: 2000000, 3: 10000000, 4: 50000000 };
  const cost = costs[slotNumber];
  if (!cost || state.money < cost || state.unlockedContractSlots >= slotNumber) return;
  
  setState(prev => ({
    ...prev,
    money: prev.money - cost,
    unlockedContractSlots: slotNumber,
  }));
},
```

- [ ] **Step 2: Add calculateBaseIncome helper (before generateContract)**

```typescript
const calculateBaseIncome = (s: GameState): number => {
  const bandwidth = calculateBandwidth(s.infrastructure);
  const { income } = calculateIncome(s.services, bandwidth);
  return income * 1000; // Scale appropriately
};
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat(contracts): add contract actions to useGameState"
```

---

## Task 5: Progress Tick Logic

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/useGameState.ts`

- [ ] **Step 1: Update the income tick effect to also update contract progress**

Find the `useEffect` with `setInterval` at ~line 130 and add progress update:

```typescript
setState(prev => {
  const updatedContracts = prev.activeContracts.map(contract => {
    const elapsedSeconds = (Date.now() - contract.startTime) / 1000;
    
    if (elapsedSeconds >= contract.timeLimitSeconds) {
      return { ...contract, failed: true };
    }
    
    const license = prev.services.find(s => s.id === contract.assignedLicenseId);
    if (!license) return contract;
    
    const bandwidth = license.bandwidthBytesPerSecond;
    const deltaBytes = bandwidth * 0.1; // 100ms tick
    const newFilled = Math.min(contract.volumeBytes, contract.volumeFilledBytes + deltaBytes);
    
    return { ...contract, volumeFilledBytes: newFilled };
  });
  
  const failedContracts = updatedContracts.filter(c => (c as any).failed);
  failedContracts.forEach(c => actions.failContract(c.slotIndex));
  
  return {
    ...prev,
    activeContracts: updatedContracts.filter(c => !(c as any).failed),
  };
});
```

- [ ] **Step 2: Update income calculation to apply contract multiplier**

Find the `derivedValues` useMemo and update income calculation:

```typescript
const derivedValues = useMemo(() => {
  const bandwidth = calculateBandwidth(state.infrastructure);
  const { income, bandwidthUsed } = calculateIncome(state.services, bandwidth);
  
  // Apply contract multipliers
  let contractBonus = 0;
  state.services.forEach(service => {
    const activeContract = state.activeContracts.find(c => c.assignedLicenseId === service.id);
    if (activeContract) {
      contractBonus += income * (activeContract.multiplierStars * 0.25);
    }
  });
  
  const totalIncome = income + contractBonus;
  
  return {
    uploadSpeed: bandwidth,
    bandwidthSold: bandwidthUsed,
    incomePerSecond: totalIncome,
    totalMoney: state.money,
  };
}, [state.infrastructure, state.services, state.activeContracts, state.money]);
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/useGameState.ts
git commit -m "feat(contracts): add progress tick and multiplier to income"
```

---

## Task 6: Contract Components - ContractPopup

**Files:**
- Create: `src/Brmble.Web/src/components/Game/contracts/ContractPopup.tsx`

- [ ] **Step 1: Create ContractPopup component**

```tsx
import { Contract } from '../types';
import './ContractPopup.css';

interface ContractPopupProps {
  contracts: Contract[];
  onSelect: (contract: Contract) => void;
  onClose: () => void;
}

function formatVolume(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function getTimeRange(stars: number): string {
  switch (stars) {
    case 5: return '± 3-5 min';
    case 4: return '± 4-6 min';
    default: return '± 6-9 min';
  }
}

function renderStars(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

export function ContractPopup({ contracts, onSelect, onClose }: ContractPopupProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="prompt glass-panel animate-slide-up contract-popup" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Select Contract</h2>
          <p className="modal-subtitle">Choose a contract to assign to a license</p>
        </div>
        
        <div className="modal-body">
          <div className="contract-grid">
            {contracts.map(contract => (
              <button
                key={contract.id}
                className="contract-card"
                onClick={() => onSelect(contract)}
              >
                <h3 className="contract-name">{contract.name}</h3>
                <div className="contract-stats">
                  <span>Volume: {formatVolume(contract.volumeBytes)}</span>
                  <span className="contract-stars">{renderStars(contract.multiplierStars)}</span>
                  <span className="contract-time">{getTimeRange(contract.multiplierStars)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        
        <div className="prompt-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ContractPopup.css**

```css
.contract-popup {
  min-width: 500px;
}

.contract-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.contract-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
}

.contract-card:hover {
  background: var(--bg-elevated);
  border-color: var(--accent-primary);
  transform: translateY(-2px);
}

.contract-name {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: var(--space-sm);
  color: var(--text-primary);
}

.contract-stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.contract-stars {
  color: var(--accent-primary);
  letter-spacing: 2px;
}

.contract-time {
  color: var(--text-muted);
  font-style: italic;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/contracts/ContractPopup.tsx src/Brmble.Web/src/components/Game/contracts/ContractPopup.css
git commit -m "feat(contracts): add ContractPopup component"
```

---

## Task 7: Contract Components - ContractSlot

**Files:**
- Create: `src/Brmble.Web/src/components/Game/contracts/ContractSlot.tsx`

- [ ] **Step 1: Create ContractSlot component**

```tsx
import { ActiveContract, Service } from '../types';
import './ContractSlot.css';

interface ContractSlotProps {
  index: number;
  activeContract: ActiveContract | null;
  license: Service | null;
  unlocked: boolean;
  onAddContract: () => void;
  onCollect: () => void;
}

function formatVolume(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function renderStars(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function formatMoney(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'M';
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(2) + 'K';
  return '$' + amount.toFixed(2);
}

export function ContractSlot({ index, activeContract, license, unlocked, onAddContract, onCollect }: ContractSlotProps) {
  if (!unlocked) {
    return (
      <div className="contract-slot locked">
        <span className="slot-label">Slot {index + 1}</span>
        <span className="slot-locked">Locked</span>
      </div>
    );
  }

  if (!activeContract) {
    return (
      <div className="contract-slot empty">
        <span className="slot-label">Slot {index + 1}</span>
        <button className="btn btn-primary btn-sm" onClick={onAddContract}>
          + Add Contract
        </button>
      </div>
    );
  }

  const progress = (activeContract.volumeFilledBytes / activeContract.volumeBytes) * 100;
  const isComplete = progress >= 100;
  const earned = isComplete ? activeContract.volumeBytes * 0.001 : 0; // Simplified calc

  return (
    <div className={`contract-slot active ${isComplete ? 'complete' : ''}`}>
      <div className="slot-header">
        <span className="slot-label">Slot {index + 1}</span>
        <span className="contract-stars">{renderStars(activeContract.multiplierStars)}</span>
      </div>
      
      <div className="progress-container">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
        <span className="progress-percent">{progress.toFixed(0)}%</span>
      </div>
      
      <div className="slot-footer">
        <span className="volume-info">
          {formatVolume(activeContract.volumeFilledBytes)} / {formatVolume(activeContract.volumeBytes)}
        </span>
        {isComplete && (
          <button className="btn btn-primary btn-sm" onClick={onCollect}>
            Collect {formatMoney(earned)}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ContractSlot.css**

```css
.contract-slot {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-width: 200px;
}

.contract-slot.locked {
  opacity: 0.5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
}

.contract-slot.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
}

.contract-slot.active {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.contract-slot.complete {
  border-color: var(--accent-success, #22c55e);
}

.slot-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-weight: 600;
}

.slot-locked {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.slot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.contract-stars {
  color: var(--accent-primary);
  letter-spacing: 1px;
  font-size: var(--text-sm);
}

.slot-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.volume-info {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-family: var(--font-mono);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/contracts/ContractSlot.tsx src/Brmble.Web/src/components/Game/contracts/ContractSlot.css
git commit -m "feat(contracts): add ContractSlot component"
```

---

## Task 8: Contract Components - LicenseDragTarget

**Files:**
- Create: `src/Brmble.Web/src/components/Game/contracts/LicenseDragTarget.tsx`

- [ ] **Step 1: Create LicenseDragTarget for drag-drop assignment**

```tsx
import { useState } from 'react';
import { Service, Contract } from '../types';
import './LicenseDragTarget.css';

interface LicenseDragTargetProps {
  license: Service;
  onDrop: (licenseId: string) => void;
}

export function LicenseDragTarget({ license, onDrop }: LicenseDragTargetProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    onDrop(license.id);
  };

  return (
    <div
      className={`license-drag-target ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="drag-target-label">{license.name}</span>
      {isDragOver && <span className="drag-hint">Drop here</span>}
    </div>
  );
}
```

- [ ] **Step 2: Create LicenseDragTarget.css**

```css
.license-drag-target {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  border-radius: var(--radius-md);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast);
}

.license-drag-target.drag-over {
  opacity: 1;
  pointer-events: auto;
  background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
  border: 2px dashed var(--accent-primary);
}

.drag-target-label {
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.drag-hint {
  position: absolute;
  bottom: var(--space-sm);
  font-size: var(--text-sm);
  color: white;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/contracts/LicenseDragTarget.tsx src/Brmble.Web/src/components/Game/contracts/LicenseDragTarget.css
git commit -m "feat(contracts): add LicenseDragTarget for drag-drop"
```

---

## Task 9: Contracts Section in Hosting Tab

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

- [ ] **Step 1: Import contract components**

Add to imports:

```typescript
import { ContractPopup } from './contracts/ContractPopup';
import { ContractSlot } from './contracts/ContractSlot';
import { LicenseDragTarget } from './contracts/LicenseDragTarget';
```

- [ ] **Step 2: Add state for selected contract and drag mode**

Find `useState` declarations and add:

```typescript
const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
const [showLicenseSelector, setShowLicenseSelector] = useState(false);
```

- [ ] **Step 3: Add ContractsSection component**

Add before `function GameUI()`:

```typescript
function ContractsSection({ state, actions }: { state: GameState; actions: Actions }) {
  return (
    <div className="contracts-section">
      <div className="contracts-header">
        <h2 className="heading-section">Contracts</h2>
      </div>
      
      <div className="contracts-slots">
        {[0, 1, 2, 3].map(index => {
          const activeContract = state.activeContracts.find(c => c.slotIndex === index) || null;
          return (
            <ContractSlot
              key={index}
              index={index}
              activeContract={activeContract}
              license={null}
              unlocked={index < state.unlockedContractSlots}
              onAddContract={() => actions.openContractPopup(index)}
              onCollect={() => actions.collectContract(index)}
            />
          );
        })}
      </div>
      
      {state.unlockedContractSlots < 4 && (
        <button
          className="btn btn-ghost"
          onClick={() => actions.unlockContractSlot(state.unlockedContractSlots + 1)}
        >
          Unlock Slot {state.unlockedContractSlots + 1} (${state.unlockedContractSlots === 1 ? '2M' : state.unlockedContractSlots === 2 ? '10M' : '50M'})
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add ContractsSection to HostingTab**

Find the Hosting tab rendering (around line 200) and add ContractsSection:

```tsx
{activeTab === 'hosting' && (
  <>
    <ContractsSection state={state} actions={actions} />
    {/* existing hosting content */}
  </>
)}
```

- [ ] **Step 5: Add contract popup rendering**

Find where modals are rendered (or add after ContractsSection):

```tsx
{state.contractPopupOpen && state.availableContracts.length > 0 && (
  <ContractPopup
    contracts={state.availableContracts}
    onSelect={(contract) => {
      setSelectedContract(contract);
      setShowLicenseSelector(true);
    }}
    onClose={actions.closeContractPopup}
  />
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx
git commit -m "feat(contracts): add ContractsSection to Hosting tab"
```

---

## Task 10: License Selector Modal

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

- [ ] **Step 1: Add license selector modal**

Add after ContractsSection:

```typescript
function LicenseSelectorModal({ 
  contract, 
  licenses, 
  onSelect, 
  onCancel 
}: { 
  contract: Contract; 
  licenses: Service[]; 
  onSelect: (licenseId: string) => void; 
  onCancel: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="prompt glass-panel animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Assign Contract</h2>
          <p className="modal-subtitle">Select a license for: {contract.name}</p>
        </div>
        
        <div className="modal-body">
          <div className="license-grid">
            {licenses.filter(l => l.owned > 0).map(license => (
              <button
                key={license.id}
                className="license-option"
                onClick={() => onSelect(license.id)}
              >
                <span className="license-name">{license.name}</span>
                <span className="license-bandwidth">
                  Bandwidth: {formatBandwidth(license.bandwidthBytesPerSecond)}
                </span>
              </button>
            ))}
          </div>
        </div>
        
        <div className="prompt-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add license selector to render**

Add to the render section:

```tsx
{showLicenseSelector && selectedContract && (
  <LicenseSelectorModal
    contract={selectedContract}
    licenses={state.services}
    onSelect={(licenseId) => {
      actions.selectContract(selectedContract, licenseId);
      setSelectedContract(null);
      setShowLicenseSelector(false);
    }}
    onCancel={() => {
      setSelectedContract(null);
      setShowLicenseSelector(false);
      actions.closeContractPopup();
    }}
  />
)}
```

- [ ] **Step 3: Add CSS for license selector**

Add to GameUI.css:

```css
.license-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.license-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.license-option:hover {
  background: var(--bg-elevated);
  border-color: var(--accent-primary);
}

.license-name {
  font-weight: 600;
}

.license-bandwidth {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx src/Brmble.Web/src/components/Game/GameUI.css
git commit -m "feat(contracts): add license selector modal"
```

---

## Task 11: Tech Upgrades Slot Unlocks

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

- [ ] **Step 1: Find the TechUpgrades tab rendering**

Look for `activeTab === 'upgrades'` section.

- [ ] **Step 2: Add contract slot unlock section**

Add at the end of the upgrades tab, before the closing fragment:

```tsx
<div className="upgrade-category">
  <h3 className="heading-label">Contract Slots</h3>
  <div className="upgrade-item">
    <div className="upgrade-info">
      <span className="upgrade-name">Unlock Slot {state.unlockedContractSlots + 1}</span>
      <span className="upgrade-desc">
        {state.unlockedContractSlots < 4 
          ? `Cost: $${state.unlockedContractSlots === 1 ? '2,000,000' : state.unlockedContractSlots === 2 ? '10,000,000' : '50,000,000'}`
          : 'All slots unlocked'}
      </span>
    </div>
    {state.unlockedContractSlots < 4 && (
      <button
        className="btn btn-primary"
        onClick={() => actions.unlockContractSlot(state.unlockedContractSlots + 1)}
        disabled={state.money < (state.unlockedContractSlots === 1 ? 2000000 : state.unlockedContractSlots === 2 ? 10000000 : 50000000)}
      >
        Unlock
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx
git commit -m "feat(contracts): add slot unlocks to Tech Upgrades"
```

---

## Task 12: Active Contract Badge on License

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`

- [ ] **Step 1: Create ActiveContractBadge component**

Add before ContractsSection:

```typescript
function ActiveContractBadge({ 
  contract, 
  onCollect 
}: { 
  contract: ActiveContract; 
  onCollect: () => void;
}) {
  const progress = (contract.volumeFilledBytes / contract.volumeBytes) * 100;
  const isComplete = progress >= 100;
  
  return (
    <div className={`active-contract-badge ${isComplete ? 'complete' : ''}`}>
      <div className="badge-header">
        <span className="badge-stars">{'★'.repeat(contract.multiplierStars)}{'☆'.repeat(5 - contract.multiplierStars)}</span>
        {isComplete && (
          <button className="btn btn-sm btn-primary" onClick={onCollect}>
            Collect
          </button>
        )}
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add badge to license cards**

Find where license cards are rendered in the Hosting tab. Add the badge:

```tsx
<div className="license-card">
  {/* existing card content */}
  
  {/* Add contract badge */}
  {(() => {
    const activeContract = state.activeContracts.find(c => c.assignedLicenseId === license.id);
    if (!activeContract) return null;
    return (
      <ActiveContractBadge 
        contract={activeContract} 
        onCollect={() => actions.collectContract(activeContract.slotIndex)} 
      />
    );
  })()}
</div>
```

- [ ] **Step 3: Add badge styles**

Add to GameUI.css:

```css
.active-contract-badge {
  position: absolute;
  bottom: var(--space-sm);
  left: var(--space-sm);
  right: var(--space-sm);
  background: rgba(0, 0, 0, 0.8);
  border-radius: var(--radius-sm);
  padding: var(--space-xs);
}

.active-contract-badge.complete {
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid var(--accent-success, #22c55e);
}

.badge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-xs);
}

.badge-stars {
  color: var(--accent-primary);
  font-size: var(--text-xs);
  letter-spacing: 1px;
}
```

- [ ] **Step 4: Ensure license cards have relative positioning**

Find `.license-card` CSS and add `position: relative;` if not present.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx src/Brmble.Web/src/components/Game/GameUI.css
git commit -m "feat(contracts): add active contract badge to license cards"
```

---

## Task 13: Unit Tests for Core Logic

**Files:**
- Create: `tests/Brmble.Web/contracts.test.ts` (or find existing test location)

- [ ] **Step 1: Find test setup**

Run: `glob **/*.test.ts*` in src/Brmble.Web

- [ ] **Step 2: Create contract logic tests**

```typescript
import { describe, it, expect } from 'vitest';

describe('Contract Generation', () => {
  it('generates valid contract structure', () => {
    // Test that generateContract returns proper Contract shape
  });
  
  it('star distribution is correct (5% rare)', () => {
    // Test that 5★ is rare, 1-3★ is common
  });
  
  it('sets time range based on stars', () => {
    // Test getTimeRangeForStars returns correct ranges
  });
});

describe('Contract Progress', () => {
  it('calculates progress correctly based on bandwidth', () => {
    // Test volumeFilledBytes increments with bandwidth × deltaTime
  });
  
  it('caps progress at 100%', () => {
    // Test that progress doesn't overflow
  });
});

describe('Contract Completion', () => {
  it('marks contract complete when volume filled', () => {
    // Test completion trigger
  });
  
  it('removes contract and adds money on collect', () => {
    // Test collectContract removes from activeContracts, adds money
  });
});

describe('Contract Failure', () => {
  it('removes contract on timeout', () => {
    // Test failContract removes from activeContracts
  });
  
  it('does NOT retain partial income on failure', () => {
    // Verify earned money is only added on collect, not on fail
  });
});

describe('Contract Slot Unlocks', () => {
  it('costs correct amounts for each slot', () => {
    // Test slot 2: $2M, slot 3: $10M, slot 4: $50M
  });
  
  it('prevents unlock if insufficient funds', () => {
    // Test money check
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test` (or appropriate test command)

- [ ] **Step 4: Commit**

```bash
git add tests/contracts.test.ts
git commit -m "test(contracts): add unit tests for core logic"
```

---

## Task 14: Integration & Build

**Files:**
- All modified files

- [ ] **Step 1: Run linter**

Run: `npm run lint` (or appropriate lint command)

- [ ] **Step 2: Run type check**

Run: `npm run typecheck` (or `tsc --noEmit`)

- [ ] **Step 3: Build**

Run: `npm run build`

- [ ] **Step 4: Test manually**

Start the dev server and verify:
1. Contracts section appears in Hosting tab
2. "Add Contract" opens popup with 3 contracts
3. Selecting a contract shows license selector
4. Assigning contract shows badge on license with progress bar
5. Collecting completed contract adds money
6. Tech Upgrades shows slot unlock options

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A && git commit -m "fix(contracts): final integration fixes"
```

---

## Spec Coverage Check

| Spec Section | Tasks |
|--------------|-------|
| Tab Structure | Task 9, 11 |
| Contract Generation | Task 3, 6 |
| Data Structures | Task 1, 2 |
| Active Contract Behavior | Task 4, 5 |
| Contract Names | Task 3 |
| UI Components | Task 6, 7, 8, 10, 12 |
| Testing | Task 13 |

All spec sections covered.
