# Idle Game Overlay Implementation Plan

**Goal:** Add an idle farming game as a floating overlay triggered by clicking the Brmble logo in the header.

**Architecture:** Copy game React components into Brmble.Web, add overlay state in App.tsx, adapt game's CSS to use Brmble's theme tokens.

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: Create Game component folder

**Files:**
- Create: `src/Brmble.Web/src/components/Game/types.ts`
- Create: `src/Brmble.Web/src/components/Game/useGameState.ts`
- Create: `src/Brmble.Web/src/components/Game/GameUI.tsx`
- Create: `src/Brmble.Web/src/components/Game/GameUI.css`

**Step 1: Copy game types**

Copy contents of `new game for brmble/src/types.ts` to `src/Brmble.Web/src/components/Game/types.ts`

**Step 2: Copy game hook**

Copy contents of `new game for brmble/src/hooks/useGameState.ts` to `src/Brmble.Web/src/components/Game/useGameState.ts`

**Step 3: Copy GameUI component**

Copy contents of `new game for brmble/src/components/GameUI/GameUI.tsx` to `src/Brmble.Web/src/components/Game/GameUI.tsx`

**Step 4: Copy GameUI styles**

Copy contents of `new game for brmble/src/components/GameUI/GameUI.css` to `src/Brmble.Web/src/components/Game/GameUI.css`

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Game/
git commit -m "feat(game): copy idle game components into Brmble.Web"
```

---

### Task 2: Add showGame state to App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add showGame state**

After line 177 (`const [showSettings, setShowSettings] = useState(false);`), add:

```typescript
const [showGame, setShowGame] = useState(false);
```

**Step 2: Pass onToggleGame to Header**

Find where Header is rendered (around line 350), add `onToggleGame={() => setShowGame(!showGame)}` to Header props.

**Step 3: Import Game component**

At top of file, add:

```typescript
import { GameUI } from './components/Game/GameUI';
```

**Step 4: Add GameUI to render**

Before closing `</div>` at end of return, add:

```tsx
{showGame && <GameUI onClose={() => setShowGame(false)} />}
```

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat(game): add showGame state and render GameUI overlay"
```

---

### Task 3: Add onToggleGame to Header and BrmbleLogo

**Files:**
- Modify: `src/Brmble.Web/src/components/Header/Header.tsx`
- Modify: `src/Brmble.Web/src/components/Header/BrmbleLogo.tsx`

**Step 1: Update Header props interface**

Add `onToggleGame?: () => void` to HeaderProps interface.

**Step 2: Pass to BrmbleLogo**

In Header render, change:

```tsx
<BrmbleLogo size={32} />
```

to:

```tsx
<BrmbleLogo size={32} onClick={onToggleGame} />
```

**Step 3: Update BrmbleLogo to accept onClick**

In BrmbleLogo.tsx, add `onClick?: () => void` to props and wrap the SVG in a button or add onClick to the wrapper.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Header/Header.tsx src/Brmble.Web/src/components/Header/BrmbleLogo.tsx
git commit -m "feat(game): add click handler to BrmbleLogo to toggle game"
```

---

### Task 4: Add onClose prop to GameUI and update CSS for Brmble themes

**Files:**
- Modify: `src/Brmble.Web/src/components/Game/GameUI.tsx`
- Modify: `src/Brmble.Web/src/components/Game/GameUI.css`

**Step 1: Add onClose prop to GameUI**

Update component to accept `onClose: () => void` prop and add a close button in the top-right corner.

**Step 2: Adapt CSS to use Brmble tokens**

Rewrite GameUI.css to use Brmble's theme tokens instead of the game's own variables. Reference existing component CSS files for patterns.

Replace game-specific variables:
- `--bg-deep`, `--bg-surface` → `--bg-primary`, `--bg-surface`
- `--text-primary`, `--text-secondary` → use same
- `--accent-primary` → `--accent-primary`

**Step 3: Add overlay styles**

Add styles for:
- `.game-overlay` - full-screen backdrop with semi-transparent background
- `.game-modal` - centered container with max-width ~600px
- `.game-close-btn` - close button positioning

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Game/GameUI.tsx src/Brmble.Web/src/components/Game/GameUI.css
git commit -m "feat(game): add close button and adapt styles to Brmble themes"
```

---

### Task 5: Verify and test

**Step 1: Build the frontend**

```bash
cd src/Brmble.Web && npm run build
```

**Step 2: Start the dev server**

```bash
cd src/Brmble.Web && npm run dev
```

**Step 3: Test the game overlay**

- Run Brmble.Client: `dotnet run --project src/Brmble.Client`
- Click the Brmble logo in the header
- Verify the game overlay appears
- Verify clicking outside closes it
- Verify the close button works
- Test that the game is playable (buy crops, upgrades)
- Verify theme matches current Brmble theme

**Step 4: Commit**

```bash
git commit -m "feat(game): complete idle game overlay feature"
```