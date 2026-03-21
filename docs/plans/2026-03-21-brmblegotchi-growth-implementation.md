# Brmblegotchi Growth Stages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 growth stages (Egg → Baby → Child → Teen → Adult) with visual progression, progressive stat reveals, and ghost/death state.

**Architecture:** Extend PetState with GrowthState containing stage, timestamps, and egg clicks. Modify decay calculation based on stage. Add CSS classes for each stage visual. Update localStorage schema.

**Tech Stack:** React + TypeScript, CSS animations, localStorage

---

## Tasks

### Task 1: Define Growth Types and Constants

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx:1-30`

**Step 1: Read current interface definitions**

Run: `Read Brmblegotchi.tsx lines 1-30`

**Step 2: Add GrowthStage type and constants after imports**

```typescript
type GrowthStage = 'egg' | 'baby' | 'child' | 'teen' | 'adult' | 'ghost';

interface GrowthState {
  stage: GrowthStage;
  stageStartTime: number;
  eggClicks: number;
  hasDied: boolean;
}

const STAGE_DURATIONS = {
  egg: 2 * 60 * 1000,
  baby: 2 * 60 * 1000,
  child: 2 * 60 * 1000,
  teen: 2 * 60 * 1000,
} as const;

const EGG_CLICKS_TO_HATCH = 10;
const EGG_AUTO_HATCH_TIME = 2 * 60 * 1000;
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): add growth stage types and constants"
```

---

### Task 2: Update State Interfaces and Defaults

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx:8-20`

**Step 1: Read current PetState interface**

Run: `Read Brmblegotchi.tsx lines 8-20`

**Step 2: Replace PetState interface with combined state**

```typescript
interface PetState {
  hunger: number;
  happiness: number;
  cleanliness: number;
  lastUpdate: number;
  lastActionTime: number;
}

const DEFAULT_GROWTH_STATE: GrowthState = {
  stage: 'egg',
  stageStartTime: Date.now(),
  eggClicks: 0,
  hasDied: false,
};

const DEFAULT_PET_STATE: PetState = {
  hunger: 100,
  happiness: 100,
  cleanliness: 100,
  lastUpdate: Date.now(),
  lastActionTime: 0,
};
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "refactor(Brmblegotchi): separate growth state from pet state"
```

---

### Task 3: Update State Loading with Migration

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx:130-170`

**Step 1: Read current loadState function**

Run: `Read Brmblegotchi.tsx lines 130-170`

**Step 2: Update loadState to handle migration and growth state**

```typescript
const loadState = (): { pet: PetState; growth: GrowthState } => {
  const saved = localStorage.getItem('brmblegotchi-state');
  if (saved) {
    const parsed = JSON.parse(saved);
    // Migration: if no stage data, default to adult (backwards compat)
    if (!parsed.stage) {
      return {
        pet: {
          hunger: parsed.hunger ?? 100,
          happiness: parsed.happiness ?? 100,
          cleanliness: parsed.cleanliness ?? 100,
          lastUpdate: parsed.lastUpdate ?? Date.now(),
          lastActionTime: parsed.lastActionTime ?? 0,
        },
        growth: {
          stage: 'adult',
          stageStartTime: Date.now(),
          eggClicks: 0,
          hasDied: false,
        },
      };
    }
    return { pet: parsed, growth: { stage: parsed.stage, stageStartTime: parsed.stageStartTime ?? Date.now(), eggClicks: parsed.eggClicks ?? 0, hasDied: parsed.hasDied ?? false } };
  }
  return { pet: { ...DEFAULT_PET_STATE }, growth: { ...DEFAULT_GROWTH_STATE } };
};
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): add state migration for growth stages"
```

---

### Task 4: Add Stage-Based Decay Calculation

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx:180-220`

**Step 1: Read current decay calculation (useEffect for decay)**

Run: `Read Brmblegotchi.tsx lines 180-220`

**Step 2: Add decay multiplier based on stage and stat**

```typescript
const getDecayMultiplier = (stat: keyof Pick<PetState, 'hunger' | 'happiness' | 'cleanliness'>, stage: GrowthStage): number => {
  if (stage === 'egg' || stage === 'ghost') return 0;
  
  const multipliers: Record<string, Record<string, number>> = {
    baby: { hunger: 1.0, happiness: 0, cleanliness: 0 },
    child: { hunger: 1.0, happiness: 1.0, cleanliness: 0 },
    teen: { hunger: 1.0, happiness: 1.0, cleanliness: 1.5 },
    adult: { hunger: 1.0, happiness: 1.0, cleanliness: 1.0 },
  };
  
  return multipliers[stage]?.[stat] ?? 0;
};
```

**Step 3: Modify decay calculation in useEffect**

Update the decay calculation to use `getDecayMultiplier` for each stat based on current stage.

**Step 4: Add death check after decay**

```typescript
if (pet.hunger <= 0 && pet.happiness <= 0 && pet.cleanliness <= 0 && growth.stage !== 'ghost') {
  setGrowth(prev => ({ ...prev, stage: 'ghost', hasDied: true }));
}
```

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): add stage-based stat decay"
```

---

### Task 5: Add Egg Click Handler

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`

**Step 1: Add handleEggClick function**

```typescript
const handleEggClick = () => {
  if (growth.stage !== 'egg') return;
  
  const newClicks = growth.eggClicks + 1;
  
  if (newClicks >= EGG_CLICKS_TO_HATCH) {
    hatchToBaby();
  } else {
    setGrowth(prev => ({ ...prev, eggClicks: newClicks }));
  }
};
```

**Step 2: Add hatchToBaby function**

```typescript
const hatchToBaby = () => {
  setGrowth(prev => ({
    ...prev,
    stage: 'baby',
    stageStartTime: Date.now(),
    eggClicks: 0,
  }));
};
```

**Step 3: Wrap widget click handler to call handleEggClick when in egg stage**

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): add egg click hatching"
```

---

### Task 6: Add Auto-Stage Progression

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`

**Step 1: Add useEffect for stage progression**

```typescript
useEffect(() => {
  if (growth.stage === 'egg' || growth.stage === 'ghost') return;
  if (growth.stage === 'adult') return;

  const duration = STAGE_DURATIONS[growth.stage as keyof typeof STAGE_DURATIONS];
  if (!duration) return;

  const elapsed = Date.now() - growth.stageStartTime;
  
  if (elapsed >= duration) {
    const nextStage: Record<string, GrowthStage> = {
      baby: 'child',
      child: 'teen',
      teen: 'adult',
    };
    setGrowth(prev => ({
      ...prev,
      stage: nextStage[prev.stage] ?? 'adult',
      stageStartTime: Date.now(),
    }));
  }
}, [growth.stage, growth.stageStartTime]);
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): add auto stage progression"
```

---

### Task 7: Add Restart Handler for Ghost State

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`

**Step 1: Add handleRestart function**

```typescript
const handleRestart = () => {
  const newPetState: PetState = {
    ...DEFAULT_PET_STATE,
    lastUpdate: Date.now(),
  };
  const newGrowthState: GrowthState = {
    ...DEFAULT_GROWTH_STATE,
    stageStartTime: Date.now(),
  };
  setPet(newPetState);
  setGrowth(newGrowthState);
};
```

**Step 2: Update onMouseDown handler to call handleRestart when in ghost state**

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): add ghost restart functionality"
```

---

### Task 8: Update Save State to Include Growth Data

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx:260-280`

**Step 1: Read current saveState function**

Run: `Read Brmblegotchi.tsx lines 260-280`

**Step 2: Update to save combined state**

```typescript
const saveState = useCallback((pet: PetState, growth: GrowthState) => {
  localStorage.setItem('brmblegotchi-state', JSON.stringify({ ...pet, ...growth }));
}, []);
```

**Step 3: Update all setPet calls to also pass growth state**

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): persist growth state to localStorage"
```

---

### Task 9: Add CSS Stage Classes

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.css`

**Step 1: Add stage-specific container classes**

```css
.brmblegotchi.stage-egg .brmblegotchi-widget {
  cursor: pointer;
}

.brmblegotchi.stage-baby .brmblegotchi-container {
  transform: scale(0.4);
}

.brmblegotchi.stage-child .brmblegotchi-container {
  transform: scale(0.6);
}

.brmblegotchi.stage-teen .brmblegotchi-container {
  transform: scale(0.85);
}

.brmblegotchi.stage-adult .brmblegotchi-container {
  transform: scale(1);
}

.brmblegotchi.stage-ghost .brmblegotchi-container {
  filter: grayscale(100%) opacity(0.7);
  animation: none;
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.css
git commit -m "feat(Brmblegotchi): add stage scale CSS classes"
```

---

### Task 10: Add Egg Visual Styles

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.css`

**Step 1: Add egg-specific styles (hide rings, show egg shape with theme color)**

```css
.brmblegotchi.stage-egg .brmblegotchi-ring-outer,
.brmblegotchi.stage-egg .brmblegotchi-ring-middle,
.brmblegotchi.stage-egg .brmblegotchi-ring-inner,
.brmblegotchi.stage-egg .brmblegotchi-ring-center {
  display: none;
}

.brmblegotchi.stage-egg .brmblegotchi-pet {
  width: 60px;
  height: 80px;
  background: var(--accent-primary);
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  cursor: pointer;
  animation: egg-wobble 2s ease-in-out infinite;
}

@keyframes egg-wobble {
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
}
```

**Step 2: Add slow pulse for child stage**

```css
.brmblegotchi.stage-child .brmblegotchi-ring-outer,
.brmblegotchi.stage-child .brmblegotchi-ring-middle,
.brmblegotchi.stage-child .brmblegotchi-ring-inner,
.brmblegotchi.stage-child .brmblegotchi-ring-center {
  animation-duration: 4s;
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.css
git commit -m "feat(Brmblegotchi): add egg visual styles and slow pulse for child"
```

---

### Task 11: Add Ghost/Corpse Visual Styles

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.css`

**Step 1: Add ghost face styles**

```css
.brmblegotchi.stage-ghost .brmblegotchi-eye {
  background: transparent;
}

.brmblegotchi.stage-ghost .brmblegotchi-eye::before,
.brmblegotchi.stage-ghost .brmblegotchi-eye::after {
  content: '';
  position: absolute;
  width: 100%;
  height: 2px;
  background: var(--brmble-ring-color, #6366f1);
  top: 50%;
  left: 0;
  transform: translateY(-50%) rotate(45deg);
}

.brmblegotchi.stage-ghost .brmblegotchi-eye::after {
  transform: translateY(-50%) rotate(-45deg);
}

.brmblegotchi.stage-ghost .brmblegotchi-mouth {
  width: 20px;
  height: 10px;
  border: none;
  border-top: 3px solid var(--brmble-ring-color, #6366f1);
  border-radius: 0;
  transform: rotate(180deg);
}

.brmblegotchi.stage-ghost .brmblegotchi-widget {
  cursor: pointer;
}

.brmblegotchi.stage-ghost .brmblegotchi-restart-hint {
  position: absolute;
  bottom: -30px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-body, sans-serif);
  font-size: 12px;
  color: var(--brmble-ring-color, #6366f1);
  opacity: 0.8;
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.css
git commit -m "feat(Brmblegotchi): add ghost/corpse visual styles"
```

---

### Task 12: Update Render Logic for Stages

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`

**Step 1: Add stage classes to container**

```typescript
<div className={`brmblegotchi stage-${growth.stage} ${growth.eggClicks >= 3 ? `crack-${growth.eggClicks}` : ''}`}>
```

**Step 2: Add ghost restart hint when in ghost state**

```typescript
{growth.stage === 'ghost' && (
  <div className="brmblegotchi-restart-hint">Click to Restart</div>
)}
```

**Step 3: Conditionally render actions based on stage**

```typescript
{growth.stage !== 'egg' && growth.stage !== 'ghost' && (
  <div className="brmblegotchi-actions">
    {/* existing actions */}
  </div>
)}
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): update render logic for growth stages"
```

---

### Task 13: Hide Stats Based on Stage

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`

**Step 1: Add stat visibility conditions**

```typescript
const showCleanliness = growth.stage !== 'egg';
const showHunger = growth.stage !== 'egg' && growth.stage !== 'baby';
const showHappiness = growth.stage !== 'egg' && growth.stage !== 'baby' && growth.stage !== 'child';
```

**Step 2: Conditionally render stat bars**

```typescript
{showCleanliness && (
  <div className="brmblegotchi-stat">...</div>
)}
{showHunger && (
  <div className="brmblegotchi-stat">...</div>
)}
{showHappiness && (
  <div className="brmblegotchi-stat">...</div>
)}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): hide stats based on growth stage"
```

---

### Task 14: Update Ring Count Per Stage

**Files:**
- Modify: `src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx`

**Step 1: Determine ring count based on stage**

```typescript
const getRingCount = (stage: GrowthStage): number => {
  switch (stage) {
    case 'egg': return 0;
    case 'baby': return 2;
    case 'child': return 3;
    case 'teen': return 4;
    case 'adult': return 4;
    case 'ghost': return 4;
    default: return 4;
  }
};
```

**Step 2: Conditionally render rings based on count**

```typescript
{[...Array(getRingCount(growth.stage))].map((_, i) => (
  <div key={i} className={`brmblegotchi-ring brmblegotchi-ring-${['outer', 'middle', 'inner', 'center'][i]}`} />
))}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Brmblegotchi/Brmblegotchi.tsx
git commit -m "feat(Brmblegotchi): render rings based on growth stage"
```

---

### Task 15: Test Growth Stages

**Step 1: Run the frontend dev server**

```bash
cd src/Brmble.Web && npm run dev
```

**Step 2: Test in browser:**
1. Clear localStorage or open incognito
2. Verify Egg stage appears (oval shape, wobble)
3. Click 10 times, verify hatch to Baby
4. Wait 2 min or set shorter duration in code, verify progression
5. Check stat visibility per stage
6. Let all stats hit 0, verify Ghost state appears
7. Click Restart, verify Egg stage again

**Step 3: Commit**

```bash
git add .
git commit -m "test(Brmblegotchi): verify growth stages work end-to-end"
```

---

## Execution Options

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
