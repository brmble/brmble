# Rock-Paper-Scissors Mini-Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Port your Rock-Paper-Scissors game to Brmble with ZERO changes to game logic.

**CRITICAL: Port EXACTLY as-is. Don't redesign. Your code is complete.**

---

## Your Game Reference

Source: `docs/investigations/steen-pappier-schaar.md`

**DO NOT CHANGE anything inside the game except the wrapper:**

| Your Code | ACTION |
|-----------|--------|
| `MOVES` object | KEEP as-is (icon, beats, label, color) |
| AI strategy | KEEP exactly (your strategic logic is CORE FUN) |
| Battle flow (counting → reveal) | KEEP exactly (creates tension) |
| Tailwind classes | KEEP as-is (Brmble uses Tailwind) |
| Emojis (🪨📄✂️) | KEEP as-is (your aesthetic) |

---

## Task 1: Create RPSGame Component

**Files:**
- Create: `src/Brmble.Web/src/components/RPSGame/RPSGame.tsx`

- [ ] **Step 1: Copy your code exactly**

Copy ENTIRE file from `docs/investigations/steen-pappier-schaar.md` into `src/Brmble.Web/src/components/RPSGame/RPSGame.tsx`

- [ ] **Step 2: Rename component for Brmble**

Find line 20:
```tsx
const App: React.FC = () => {
```

Replace with:
```tsx
export function RPSGame({ onClose }: { onClose?: () => void }) {
```

- [ ] **Step 3: Add close button to header**

Find your title section (around line 159):
```tsx
<h1 className="text-4xl font-black tracking-tighter ...">
  Budget Duel
</h1>
```

Replace with:
```tsx
<div style={{ position: 'relative' }}>
  <h1 className="text-4xl font-black tracking-tighter ...">
    Budget Duel
  </h1>
  {onClose && (
    <button 
      onClick={onClose}
      style={{ position: 'absolute', right: 0, top: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}
    >
      ×
    </button>
  )}
</div>
```

- [ ] **Step 4: Fit into Brmble layout**

Find your main container (line 112):
```tsx
<div className="min-h-screen bg-slate-950 ...">
```

Replace with (remove min-h-screen so it fits in Brmble's content area):
```tsx
<div style={{ background: 'var(--bg-depth)', minHeight: '100vh' }}>
```

- [ ] **Step 5: Build and verify**

```bash
cd src/Brmble.Web && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/RPSGame/RPSGame.tsx
git commit -m "feat: add Rock-Paper-Scissors mini-game"
```

---

## Task 2: Add Game Selector

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add import**

After line 34 (NeonDGame import):
```tsx
import { RPSGame } from './components/RPSGame/RPSGame';
```

- [ ] **Step 2: Add state**

At line 215:
```tsx
const [showGame, setShowGame] = useState(false);
const [activeGame, setActiveGame] = useState<'neond' | 'rps'>('neond');  // ADD THIS
```

- [ ] **Step 3: Update rendering**

At line 2231-2232, replace:
```tsx
showGame ? (
  <NeonDGame onClose={() => setShowGame(false)} />
) : (
```

With:
```tsx
showGame ? (
  activeGame === 'rps' ? (
    <RPSGame onClose={() => setShowGame(false)} />
  ) : (
    <NeonDGame onClose={() => setShowGame(false)} />
  )
) : (
```

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: add game selector for NeonD and RPS"
```

---

## What NOT to Change

```
┌─────────────────────────────────────────────────────────┐
│  MOVES CONFIG - KEEP EXACTLY AS-IS                        │
│  {                                                      │
│    rock: { icon: '🪨', beats: 'scissors', label: 'Rock',  │
│           color: 'text-blue-400' },                     │
│    // etc                                               │
│  }                                                      │
│                                                         │
│  The UI uses:                                           │
│  - icon: for displaying the move in arena               │
│  - color: for styling participant buttons             │
│  - beats: for determining winner                       │
└─────────────────────────────────────────────────────────┘
```

- **icon** = used in the VS reveal
- **color** = used in buttons and score display
- **beats** = determines winner logic

Removing any of these BREAKS the game.

---

## Execution Options

**1. Subagent-Driven (recommended)** - Task-by-task with reviews

**2. Inline Execution** - Session with checkpoints

**Which approach?**