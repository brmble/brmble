# Theme Template System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the theming system into a modular, template-driven architecture with semantic token names, per-theme fonts, and 8 themes (Classic, Clean, 5 cocktails, Retro Terminal).

**Architecture:** CSS-first theme files in `src/themes/`, each scoped to `:root[data-theme="<id>"]`. A `theme-registry.ts` provides metadata, a `theme-loader.ts` handles dynamic font loading. `index.css` becomes structural-only.

**Tech Stack:** CSS Custom Properties, TypeScript, Vite static imports, Google Fonts dynamic loading

**Design doc:** `docs/plans/2026-02-27-theme-template-system-design.md`

---

## Phase 1: Infrastructure (Tasks 1-6)

Foundation work. No visual changes. App should look identical after this phase.

### Task 1: Create themes directory and extract Classic

**Files:**
- Create: `src/Brmble.Web/src/themes/classic.css`
- Modify: `src/Brmble.Web/src/index.css`
- Modify: `src/Brmble.Web/src/main.tsx`

**Step 1: Create the themes directory**

```bash
mkdir src/Brmble.Web/src/themes
```

**Step 2: Create `themes/classic.css`**

Extract lines 3-130 from `index.css` into a new file. The selector stays as bare `:root` so Classic is the default fallback.

```css
/* ═══════════════════════════════════════════════════
   Theme: Brmble Classic
   Cocktail: The Bramble — gin, lemon, blackberry liqueur
   Fonts: Cormorant Garamond (display), Outfit (body), JetBrains Mono (mono)
   
   The original. Deep purple backgrounds, warm cream text,
   berry-pink accents, grain overlay, mesh gradients.
   A vintage cocktail lounge at midnight.
   ═══════════════════════════════════════════════════ */

@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  /* ── Backgrounds ── */
  --bg-deep: #0f0a14;
  --bg-primary: #1a1025;
  --bg-glass: rgba(26, 16, 37, 0.85);
  --bg-hover: rgba(61, 42, 92, 0.3);
  --bg-hover-strong: rgba(100, 70, 150, 0.4);
  --bg-surface: rgba(61, 42, 92, 0.15);
  --bg-overlay: rgba(15, 10, 20, 0.80);
  --bg-elevated: rgba(26, 16, 37, 0.6);
  --bg-input: var(--bg-elevated);
  --bg-deep-glass: rgba(15, 10, 20, 0.4);
  --bg-hover-light: rgba(255, 255, 255, 0.08);
  --bg-surface-active: rgba(61, 42, 92, 0.6);

  /* ── Primary Accent (Berry Pink) ── */
  --accent-primary: #d4145a;
  --accent-primary-dark: #b8124d;
  --accent-primary-hover: #e8185f;
  --accent-primary-light: #e8326e;
  --accent-primary-glow: rgba(212, 20, 90, 0.4);
  --accent-primary-wash: rgba(212, 20, 90, 0.2);
  --accent-primary-ghost: rgba(212, 20, 90, 0.1);

  /* ── Secondary Accent (Lemon Yellow) ── */
  --accent-secondary: #f4d03f;
  --accent-secondary-glow: rgba(244, 208, 63, 0.3);
  --accent-secondary-subtle: rgba(244, 208, 63, 0.15);

  /* ── Success Accent (Mint Green) ── */
  --accent-success: #50c878;
  --accent-success-glow: rgba(80, 200, 120, 0.3);
  --accent-success-subtle: rgba(80, 200, 120, 0.15);

  /* ── Decorative Accent (Purple) ── */
  --accent-decorative: #7b4dff;
  --accent-decorative-glow: rgba(123, 77, 255, 0.5);
  --bg-avatar-start: #4a1a6b;
  --bg-avatar-end: #2d0f45;

  /* ── Danger Accent ── */
  --accent-danger: #ff6b6b;
  --accent-danger-strong: #ff4f5e;
  --accent-danger-text: #ff6b7a;
  --accent-danger-subtle: rgba(255, 107, 107, 0.12);
  --accent-danger-border: rgba(255, 107, 107, 0.4);
  --accent-danger-bg: rgba(255, 107, 107, 0.25);

  /* ── Status ── */
  --status-connected: #50c878;

  /* ── Text ── */
  --text-primary: #f5f0e8;
  --text-secondary: #a89fb8;
  --text-secondary-dim: rgba(168, 159, 184, 0.55);
  --text-secondary-muted: rgba(168, 159, 184, 0.7);
  --text-muted: #6b5f7a;
  --text-muted-dim: rgba(107, 95, 122, 0.5);
  --text-muted-strong: rgba(107, 95, 122, 0.85);

  /* ── Borders & Effects ── */
  --border-subtle: #3d2a5c;
  --border-glow: rgba(212, 20, 90, 0.3);

  /* ── Glass Effect ── */
  --glass-blur: blur(12px);
  --glass-border: 1px solid rgba(61, 42, 92, 0.5);

  /* ── Shadows ── */
  --shadow-dialog:
    0 0 0 1px var(--accent-primary-ghost),
    0 8px 32px rgba(15, 10, 20, 0.6),
    0 0 60px rgba(212, 20, 90, 0.08);
  --shadow-elevated: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-drop-subtle: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));

  /* ── Typography ── */
  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-body: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* ── Theme Features ── */
  --theme-noise-opacity: 0.03;
  --theme-mesh-bg: 
    radial-gradient(circle at 15% 15%, rgba(212, 20, 90, 0.08) 0%, transparent 40%),
    radial-gradient(circle at 85% 85%, rgba(123, 77, 255, 0.08) 0%, transparent 40%);
}
```

**Step 3: Strip index.css**

Remove lines 1-130 (the `@import url(...)` and the entire `:root { ... }` block). Keep everything from `:root[data-theme="clean"]` onward (this will be moved in Task 2). The file should start with structural tokens only.

Add a new `:root` block at the top of `index.css` with ONLY the structural tokens:

```css
:root {
  /* ═══════════════════════════════════════════════════
     Structural Tokens — shared across all themes
     ═══════════════════════════════════════════════════ */

  /* Border Radius Scale */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 50%;

  /* Spacing Scale */
  --space-2xs: 0.25rem;
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  --space-3xl: 4rem;

  /* Font Size Scale */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 2rem;
  --text-4xl: 2.5rem;

  /* Layout */
  --sidebar-width: 280px;
  --header-height: 60px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 400ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

**Step 4: Update main.tsx imports**

Add theme imports after `index.css`:

```typescript
import './index.css'
import './themes/classic.css'
import App from './App.tsx'
```

**Step 5: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds with no errors. The app should look identical since Classic's tokens are still applied via bare `:root`.

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/themes/classic.css src/Brmble.Web/src/index.css src/Brmble.Web/src/main.tsx
git commit -m "refactor: extract Classic theme to themes/classic.css"
```

---

### Task 2: Extract Clean theme

**Files:**
- Create: `src/Brmble.Web/src/themes/clean.css`
- Modify: `src/Brmble.Web/src/index.css` (remove `:root[data-theme="clean"]` block)
- Modify: `src/Brmble.Web/src/main.tsx` (add import)

**Step 1: Create `themes/clean.css`**

Move the `:root[data-theme="clean"]` block (lines 132-167 of current index.css) into its own file. Update token names to use new semantic names.

```css
/* ═══════════════════════════════════════════════════
   Theme: Brmble Clean
   Stripped-down dark mode. No grain, no mesh, neutral grays.
   Retains Classic accent colors but desaturates everything else.
   ═══════════════════════════════════════════════════ */

:root[data-theme="clean"] {
  --theme-noise-opacity: 0;
  --theme-mesh-bg: none;

  /* Desaturated Backgrounds */
  --bg-deep: #0a0a0a;
  --bg-primary: #121212;
  --bg-glass: rgba(18, 18, 18, 0.85);
  --bg-hover: rgba(255, 255, 255, 0.05);
  --bg-hover-strong: rgba(255, 255, 255, 0.1);
  --bg-surface: rgba(255, 255, 255, 0.03);
  --bg-overlay: rgba(10, 10, 10, 0.85);
  --bg-elevated: rgba(30, 30, 30, 0.9);
  --bg-input: rgba(30, 30, 30, 0.5);
  --bg-deep-glass: rgba(10, 10, 10, 0.5);
  --bg-hover-light: rgba(255, 255, 255, 0.08);
  --bg-surface-active: rgba(255, 255, 255, 0.08);

  /* Neutral Borders */
  --border-subtle: #2a2a2a;
  --glass-border: 1px solid rgba(255, 255, 255, 0.1);

  /* Neutral Text */
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --text-secondary-dim: rgba(160, 160, 160, 0.55);
  --text-secondary-muted: rgba(160, 160, 160, 0.7);
  --text-muted: #6b6b6b;
  --text-muted-dim: rgba(107, 107, 107, 0.5);
  --text-muted-strong: rgba(107, 107, 107, 0.85);

  /* Clean Shadows */
  --shadow-dialog:
    0 0 0 1px rgba(255, 255, 255, 0.1),
    0 12px 40px rgba(0, 0, 0, 0.8);
}
```

**Step 2: Remove the clean theme block from index.css**

Delete the entire `:root[data-theme="clean"] { ... }` block (lines 132-167).

**Step 3: Update main.tsx imports**

```typescript
import './index.css'
import './themes/classic.css'
import './themes/clean.css'
import App from './App.tsx'
```

**Step 4: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds. Both Classic and Clean themes should still work.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/themes/clean.css src/Brmble.Web/src/index.css src/Brmble.Web/src/main.tsx
git commit -m "refactor: extract Clean theme to themes/clean.css"
```

---

### Task 3: Rename accent tokens across all files

**Files to modify (mechanical find-and-replace):**
- `src/Brmble.Web/src/index.css` — global utilities use accent tokens
- `src/Brmble.Web/src/App.css`
- `src/Brmble.Web/src/themes/classic.css` — definitions already renamed in Task 1
- `src/Brmble.Web/src/themes/clean.css` — already renamed in Task 2
- `src/Brmble.Web/src/components/UserPanel/UserPanel.css`
- `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx` — line 168 hardcoded `var(--accent-mint)`
- `src/Brmble.Web/src/components/UserInfoDialog/UserInfoDialog.css`
- `src/Brmble.Web/src/components/Sidebar/Sidebar.css`
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`
- `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css`
- `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.css`
- `src/Brmble.Web/src/components/Header/Header.css`
- `src/Brmble.Web/src/components/ServerList/ServerList.css`
- `src/Brmble.Web/src/components/DMContactList/DMContactList.css`
- `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css`
- `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`
- `src/Brmble.Web/src/components/ChatPanel/MessageInput.css`
- `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`
- `src/Brmble.Web/src/components/CertWizard/CertWizard.css`

**Step 1: Run find-and-replace for each token family**

Execute these replacements across all `.css` and `.tsx` files in `src/Brmble.Web/src/`:

| Find | Replace |
|------|---------|
| `--accent-berry-dark` | `--accent-primary-dark` |
| `--accent-berry-hover` | `--accent-primary-hover` |
| `--accent-berry-light` | `--accent-primary-light` |
| `--accent-berry-glow` | `--accent-primary-glow` |
| `--accent-berry-wash` | `--accent-primary-wash` |
| `--accent-berry-ghost` | `--accent-primary-ghost` |
| `--accent-berry` | `--accent-primary` |
| `--accent-lemon-glow` | `--accent-secondary-glow` |
| `--accent-lemon-subtle` | `--accent-secondary-subtle` |
| `--accent-lemon` | `--accent-secondary` |
| `--accent-mint-glow` | `--accent-success-glow` |
| `--accent-mint-subtle` | `--accent-success-subtle` |
| `--accent-mint` | `--accent-success` |
| `--accent-purple-glow` | `--accent-decorative-glow` |
| `--accent-purple` | `--accent-decorative` |

**CRITICAL ORDER:** Replace longer names FIRST (e.g., `--accent-berry-dark` before `--accent-berry`), otherwise the shorter replacement will corrupt the longer names.

**Step 2: Verify no old names remain**

Run: `cd src/Brmble.Web && grep -r "accent-berry\|accent-lemon\|accent-mint\|accent-purple" src/ --include="*.css" --include="*.tsx"`
Expected: Zero results.

**Step 3: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add -A src/Brmble.Web/src/
git commit -m "refactor: rename accent tokens to semantic names (berry→primary, lemon→secondary, mint→success, purple→decorative)"
```

---

### Task 4: Create theme registry and font loader

**Files:**
- Create: `src/Brmble.Web/src/themes/theme-registry.ts`
- Create: `src/Brmble.Web/src/themes/theme-loader.ts`

**Step 1: Create `theme-registry.ts`**

```typescript
export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  fontUrl: string;
}

export const themes: ThemeDefinition[] = [
  {
    id: 'classic',
    name: 'Brmble Classic',
    description: 'The original Bramble cocktail palette — vintage lounge',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  {
    id: 'clean',
    name: 'Brmble Clean',
    description: 'Stripped-down dark mode — neutral and modern',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
];

export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.find(t => t.id === id);
}

export function getDefaultTheme(): ThemeDefinition {
  return themes[0]; // Classic
}
```

**Step 2: Create `theme-loader.ts`**

```typescript
import { getTheme, getDefaultTheme } from './theme-registry';

const FONT_LINK_ID = 'brmble-theme-fonts';

/**
 * Load the fonts for a given theme by updating the <link> tag in <head>.
 * Creates the link element if it doesn't exist.
 */
export function loadThemeFonts(themeId: string): void {
  const theme = getTheme(themeId) ?? getDefaultTheme();

  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  // Only update if the URL actually changed
  if (link.href !== theme.fontUrl) {
    link.href = theme.fontUrl;
  }
}

/**
 * Apply a theme: set data-theme attribute and load fonts.
 */
export function applyTheme(themeId: string): void {
  document.documentElement.setAttribute('data-theme', themeId);
  loadThemeFonts(themeId);
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/themes/theme-registry.ts src/Brmble.Web/src/themes/theme-loader.ts
git commit -m "feat: add theme registry and font loader"
```

---

### Task 5: Wire up theme loader to main.tsx and SettingsModal

**Files:**
- Modify: `src/Brmble.Web/src/main.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx` (line 177)
- Modify: `src/Brmble.Web/src/themes/classic.css` (remove `@import url(...)` line)

**Step 1: Update main.tsx**

Replace the current theme-application block and add font loading:

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes/classic.css'
import './themes/clean.css'
import { applyTheme } from './themes/theme-loader'
import App from './App.tsx'

// Apply theme before render to prevent flash
try {
  const stored = localStorage.getItem('brmble-settings');
  if (stored) {
    const settings = JSON.parse(stored);
    if (settings?.appearance?.theme) {
      applyTheme(settings.appearance.theme);
    }
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**Step 2: Update SettingsModal.tsx**

In `handleAppearanceChange` (line 173-178), replace the direct `setAttribute` call with `applyTheme`:

```typescript
import { applyTheme } from '../../themes/theme-loader';

// In handleAppearanceChange:
const handleAppearanceChange = (appearance: AppearanceSettings) => {
  const newSettings = { ...settings, appearance };
  setSettings(newSettings);
  bridge.send('settings.set', { settings: newSettings });
  applyTheme(appearance.theme);
};
```

Also add `localStorage` persistence (bug fix — currently only shortcuts persist to localStorage):

```typescript
const handleAppearanceChange = (appearance: AppearanceSettings) => {
  const newSettings = { ...settings, appearance };
  setSettings(newSettings);
  bridge.send('settings.set', { settings: newSettings });
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  applyTheme(appearance.theme);
};
```

**Step 3: Remove `@import url(...)` from classic.css**

The font `@import` in `classic.css` is now handled by the theme-loader. Remove the first line:

```css
@import url('https://fonts.googleapis.com/css2?...');
```

The theme-loader will create a `<link>` element that loads the correct fonts.

**Step 4: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/main.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx src/Brmble.Web/src/themes/classic.css
git commit -m "feat: wire theme loader into startup and settings, fix localStorage persistence"
```

---

### Task 6: Update Settings UI to use theme registry

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`

**Step 1: Update InterfaceSettingsTypes.ts**

Change the theme type from a union to `string`:

```typescript
export interface AppearanceSettings {
  theme: string;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'classic',
};
```

**Step 2: Update InterfaceSettingsTab.tsx**

Import the theme registry and populate the dropdown dynamically:

```typescript
import { themes } from '../../themes/theme-registry';

// Replace the hardcoded <select> options:
<select
  className="brmble-input"
  value={localAppearance.theme}
  onChange={(e) => handleThemeChange(e.target.value)}
>
  {themes.map(t => (
    <option key={t.id} value={t.id}>{t.name}</option>
  ))}
</select>
```

Remove the type assertion `as 'classic' | 'clean'` from the `onChange` handler since `theme` is now `string`.

**Step 3: Fix the select SVG dropdown arrow**

In `index.css`, find the `select.brmble-input` rule (around line 100 in the stripped file). Replace the hardcoded stroke color `%23f5f0e8` with `%23currentColor`:

```css
select.brmble-input {
  /* ... */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  /* ... */
}
```

Note: `currentColor` in an SVG data URI may not work in all browsers. If it doesn't render, use a CSS-only approach with a border triangle or a separate SVG element. Test this.

**Step 4: Build and verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds. Settings dropdown now shows themes from the registry.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTypes.ts src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx src/Brmble.Web/src/index.css
git commit -m "feat: dynamic theme dropdown from registry, fix SVG arrow theming"
```

---

## Phase 2: Theme Template (Task 7)

### Task 7: Create the annotated theme template

**Files:**
- Create: `src/Brmble.Web/src/themes/_template.css`

**Step 1: Write the template**

Create `_template.css` with the full design-intent documentation as specified in the design doc. Include:

- The "3 decisions" header block
- Each token group with HSL formulas, derivation chains, Classic worked examples
- Soft/hard spectrum notes
- Tinting rationale
- Every token that a theme must define (~55 tokens)

See the design doc `docs/plans/2026-02-27-theme-template-system-design.md` "Template Design" section for the full annotation style.

The template should use a placeholder selector:

```css
:root[data-theme="THEME_SLUG"] {
  /* ... all tokens ... */
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/themes/_template.css
git commit -m "docs: add annotated theme template with design-intent documentation"
```

---

## Phase 3: Cocktail Themes (Tasks 8-13)

Each task creates one theme. For each theme: create the CSS file, add the Google Fonts `@import`, register in `theme-registry.ts`, import in `main.tsx`, build and verify.

### Task 8: Blue Lagoon theme

**Files:**
- Create: `src/Brmble.Web/src/themes/blue-lagoon.css`
- Modify: `src/Brmble.Web/src/themes/theme-registry.ts`
- Modify: `src/Brmble.Web/src/main.tsx`

**Color derivation:**
- Base Hue: 200° (ocean blue)
- Primary Accent: `#00b4d8` (electric cyan-blue)
- Text Warmth: Cool (pure white with blue-tinted grays)
- Fonts: Playfair Display (display), DM Sans (body), JetBrains Mono (mono)

Derive all 55 tokens from these base decisions using the formulas in `_template.css`.

Register in theme-registry:
```typescript
{
  id: 'blue-lagoon',
  name: 'Blue Lagoon',
  description: 'Tropical electric cyan — poolside cool',
  fontUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
},
```

Add import to `main.tsx`.

Build and verify: `cd src/Brmble.Web && npm run build`

Commit: `git commit -m "feat: add Blue Lagoon theme"`

---

### Task 9: Cosmopolitan theme

**Files:**
- Create: `src/Brmble.Web/src/themes/cosmopolitan.css`
- Modify: `src/Brmble.Web/src/themes/theme-registry.ts`
- Modify: `src/Brmble.Web/src/main.tsx`

**Color derivation:**
- Base Hue: 345° (deep cranberry-rose)
- Primary Accent: `#e63962` (cranberry pink)
- Text Warmth: Warm (rose-tinted cream)
- Fonts: Bodoni Moda (display), Manrope (body), JetBrains Mono (mono)

Build, verify, commit: `git commit -m "feat: add Cosmopolitan theme"`

---

### Task 10: Aperol Spritz theme

**Files:**
- Create: `src/Brmble.Web/src/themes/aperol-spritz.css`
- Modify: `src/Brmble.Web/src/themes/theme-registry.ts`
- Modify: `src/Brmble.Web/src/main.tsx`

**Color derivation:**
- Base Hue: 25° (burnt orange-amber)
- Primary Accent: `#e8651a` (Aperol orange)
- Text Warmth: Very warm (amber-tinted cream `#faf0e0`)
- Fonts: Fraunces (display), Nunito (body), JetBrains Mono (mono)

Build, verify, commit: `git commit -m "feat: add Aperol Spritz theme"`

---

### Task 11: Midori Sour theme

**Files:**
- Create: `src/Brmble.Web/src/themes/midori-sour.css`
- Modify: `src/Brmble.Web/src/themes/theme-registry.ts`
- Modify: `src/Brmble.Web/src/main.tsx`

**Color derivation:**
- Base Hue: 145° (deep emerald-green)
- Primary Accent: `#00c853` (electric Midori green)
- Text Warmth: Cool-neutral (clean white with green-tinted grays)
- Fonts: Space Mono (display), Lexend (body), JetBrains Mono (mono)

Build, verify, commit: `git commit -m "feat: add Midori Sour theme"`

---

### Task 12: Lemon Drop Martini theme

**Files:**
- Create: `src/Brmble.Web/src/themes/lemon-drop.css`
- Modify: `src/Brmble.Web/src/themes/theme-registry.ts`
- Modify: `src/Brmble.Web/src/main.tsx`

**Color derivation:**
- Base Hue: 50° (deep warm gold-amber)
- Primary Accent: `#f5c518` (bright lemon gold)
- Text Warmth: Warm (golden cream)
- Fonts: Sora (display), Plus Jakarta Sans (body), JetBrains Mono (mono)

Build, verify, commit: `git commit -m "feat: add Lemon Drop Martini theme"`

---

### Task 13: Retro Terminal theme

**Files:**
- Create: `src/Brmble.Web/src/themes/retro-terminal.css`
- Modify: `src/Brmble.Web/src/themes/theme-registry.ts`
- Modify: `src/Brmble.Web/src/main.tsx`

**Color derivation:**
- Base Hue: 0° (pure neutral, no tint)
- Primary Accent: `#33ff00` (phosphor green)
- Text Warmth: Cold (green-on-black)
- Fonts: VT323 (display), IBM Plex Mono (body + mono)
- Special: Highest noise opacity (0.06), no mesh, no glass effects

This theme is the most distinctive — everything is monospaced, scanline grain effect, flat black backgrounds, phosphor green accents.

Build, verify, commit: `git commit -m "feat: add Retro Terminal theme"`

---

## Phase 4: Verification (Task 14)

### Task 14: Full build and integration test

**Step 1: Clean build**

```bash
cd src/Brmble.Web && rm -rf dist && npm run build
```

Expected: Build succeeds with no errors or warnings.

**Step 2: Run dotnet build**

```bash
dotnet build
```

Expected: Build succeeds. The `CopyWebDist` MSBuild target copies `dist/` to output.

**Step 3: Run tests**

```bash
dotnet test
```

Expected: All existing tests pass.

**Step 4: Manual verification checklist**

- [ ] Classic theme loads by default (no `data-theme` attribute needed)
- [ ] Each theme can be selected in Settings > Interface > Theme
- [ ] Theme persists across app restart (localStorage + bridge)
- [ ] Fonts change when switching themes
- [ ] No hardcoded color values visible (everything uses tokens)
- [ ] Noise grain overlay responds to `--theme-noise-opacity`
- [ ] Mesh gradient background responds to `--theme-mesh-bg`
- [ ] Select dropdown arrows visible in all themes

**Step 5: Final commit**

If any fixes were needed during verification, commit them.

```bash
git commit -m "test: verify theme system end-to-end"
```
