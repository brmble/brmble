# Brmblegotchi Growth Stages Design

## Overview

Add 5 growth stages with visual progression from an egg to a full Brmble. Keep the original Brmblegotchi look for all stages except Egg. Death shows a ghost state. Clicking Restart resets to Egg stage.

---

## Visual Design Philosophy

The Brmblegotchi retains its original aesthetic throughout all stages except Egg:
- Same ring system, face expressions, and animations
- Only the size and ring count change per stage
- Egg is the only stage with a distinct visual (oval shape with theme color)

---

## Stage Progression

| Stage | Rings | Scale | Animation | Available Actions |
|-------|-------|-------|-----------|-------------------|
| Egg | 0 | - | Egg shape wobbles | Click to hatch |
| Baby | 2 | 40% | Normal pulse | Clean |
| Child | 3 | 60% | Slow pulse (4s) | Feed, Clean |
| Teen | 4 | 85% | Normal pulse | Feed, Play, Clean |
| Adult | 4 | 100% | Full pulse | Feed, Play, Clean |
| Ghost | 4 | 100% | No pulse, dim | Restart |

---

## Visual Progression

### Egg Stage
- Oval/egg shape (not a circle)
- Uses user's current Brmble theme color (`--accent-primary`)
- No rings, no face
- Wobble animation (rotate ±5°)
- Click anywhere on widget to hatch

### Baby Stage (40% scale)
- 2 rings (outer + inner/center)
- Normal pulse animation (2s cycle)
- Smallest Brmble version
- Clean action only

### Child Stage (60% scale)
- 3 rings (outer, middle, center)
- Slow pulse animation (4s cycle)
- Medium size Brmble
- Feed and Clean actions

### Teen Stage (85% scale)
- 4 rings (full ring set)
- Normal pulse animation (2s cycle)
- Near adult size
- Feed, Play, and Clean actions

### Adult Stage (100% scale)
- Full original Brmblegotchi look (4 rings)
- Full pulse animation and mood states
- Fully grown
- Feed, Play, and Clean actions

### Ghost State
- 4 rings but no animation
- Dim opacity (0.3)
- Rings don't pulse
- Sad/expressionless look
- Click or Reset button to restart from Egg

---

## State Structure

### GrowthState
```typescript
interface GrowthState {
  stage: 'egg' | 'baby' | 'child' | 'teen' | 'adult' | 'ghost';
  stageStartTime: number;
  eggClicks: number;        // 0-10 for egg stage
  hasDied: boolean;         // true if ghost state was reached
}
```

### PetState
```typescript
interface PetState {
  hunger: number;           // exists from start, shown from child+
  happiness: number;       // exists from start, shown from teen+
  cleanliness: number;     // exists from start, shown from baby+
  lastUpdate: number;
  lastActionTime: number;
}
```

---

## Egg Interaction Details

1. Each click anywhere on the Brmblegotchi widget increments `eggClicks`
2. At 10 clicks → immediate hatch to Baby stage
3. After 2 min with 0 clicks → auto-hatch to Baby
4. No stat decay during Egg stage

---

## Timings (Configurable Constants)

```typescript
const STAGE_DURATIONS = {
  egg: 2 * 60 * 1000,      // 2 minutes
  baby: 2 * 60 * 1000,     // 2 minutes
  child: 2 * 60 * 1000,    // 2 minutes
  teen: 2 * 60 * 1000,     // 2 minutes
};
```

---

## Death Condition

- All stats hit 0 at any stage → Ghost state
- Stats persist at 0 (no negative values)
- UI shows ghost visual (dim, no animation)
- Settings "Reset Pet" button or clicking ghost resets to Egg stage
- All progress lost

---

## Components Modified

### Brmblegotchi.tsx
- Add GrowthState interface
- Add stage type and state management
- Add egg click handler
- Add stage transition logic
- Add ghost state handling
- Add stat visibility based on stage
- Modify decay calculation per stage
- Add reset handler

### Brmblegotchi.css
- Add `.stage-egg`, `.stage-baby`, `.stage-child`, `.stage-teen`, `.stage-adult`, `.stage-ghost`
- Add egg shape styles (oval, wobble, theme color)
- Add scale classes for each stage
- Add slow pulse for child stage
- Add ghost visual styles (no animation, dim)
- Adjust ring count per stage

### InterfaceSettingsTab.tsx
- Add "Reset Pet" button in Brmblegotchi settings section
- Emit `brmblegotchi-reset` event on click

---

## Settings Interface

In Settings → Interface → Brmblegotchi:
- Toggle: Enable Pet (existing)
- Button: Reset Pet (new)

Clicking "Reset Pet" sends a `brmblegotchi-reset` custom event that the Brmblegotchi component listens for.

---

## localStorage Schema

Key: `brmblegotchi-state`

```typescript
interface StoredState {
  hunger: number;
  happiness: number;
  cleanliness: number;
  lastUpdate: number;
  lastActionTime: number;
  stage: 'egg' | 'baby' | 'child' | 'teen' | 'adult' | 'ghost';
  stageStartTime: number;
  eggClicks: number;
  hasDied: boolean;
}
```

---

## Migration Strategy

For existing users with saved state:
- If no stage data exists, default to 'adult' (backwards compatible)
- New users start at 'egg' stage
- No stat loss on migration
