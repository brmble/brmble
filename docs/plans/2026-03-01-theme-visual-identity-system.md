# Theme Visual Identity System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give each Brmble theme a unique visual identity through per-theme texture overlays, glow intensities, border radii, and overlay blur — plus fix theme-integration bugs found during audit.

**Architecture:** Expand the Theme Features section from 2 tokens to ~14 tokens. The `body::before` overlay becomes fully token-driven (texture, blend mode, scale). Glow spread sizes, overlay backdrop blur, and border-radius scale move into theme files so each theme can express its personality beyond color alone.

**Tech Stack:** CSS custom properties, SVG data URIs, CSS `mix-blend-mode`, `repeating-linear-gradient`

---

## Summary of Changes

| Category | New Tokens | Files Modified |
|---|---|---|
| Texture overlay | `--theme-noise-texture`, `--theme-noise-blend`, `--theme-noise-scale` | 8 theme CSS files + index.css |
| Glow spread | `--glow-sm`, `--glow-md`, `--glow-lg` | 8 theme CSS files + index.css + 5 component CSS files |
| Overlay blur | `--glass-blur-overlay` | 8 theme CSS files + 4 component CSS files |
| Border radius | `--radius-xs` through `--radius-xl` + `--radius-full` | 8 theme CSS files + index.css (move from `:root` to themes) |
| Bug fixes | (none — using existing tokens) | MessagesSettingsTab.css, CertWizard.tsx |

Total new tokens per theme: 10 (`--theme-noise-texture`, `--theme-noise-blend`, `--theme-noise-scale`, `--glow-sm`, `--glow-md`, `--glow-lg`, `--glass-blur-overlay`, plus the 6 radius tokens move from global to per-theme).

---

## Task 1: Add Texture Tokens to Classic (Reference Theme)

**Files:**
- Modify: `src/Brmble.Web/src/themes/classic.css` (Theme Features section, ~line 90)
- Modify: `src/Brmble.Web/src/index.css` (body::before, lines 74-87)

**Step 1: Add new texture tokens to classic.css**

In `classic.css`, replace the Theme Features section with:

```css
  /* Theme Features */
  --theme-noise-opacity: 0.03;
  --theme-noise-texture: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  --theme-noise-blend: overlay;
  --theme-noise-scale: cover;
  --theme-mesh-bg:
    radial-gradient(circle at 15% 15%, rgba(212, 20, 90, 0.08) 0%, transparent 40%),
    radial-gradient(circle at 85% 85%, rgba(123, 77, 255, 0.08) 0%, transparent 40%);
```

**Step 2: Update `body::before` in index.css to use new tokens**

Replace the hardcoded `background-image` in `body::before` (line 85) with:

```css
body::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 9999;
  opacity: var(--theme-noise-opacity);
  background-image: var(--theme-noise-texture);
  background-size: var(--theme-noise-scale);
  mix-blend-mode: var(--theme-noise-blend);
  transition: opacity var(--transition-normal);
}
```

**Step 3: Verify Classic still looks identical**

Run: `cd src/Brmble.Web && npm run dev`
Expected: Classic theme looks exactly the same — film grain, same opacity, same pattern.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/themes/classic.css src/Brmble.Web/src/index.css
git commit -m "feat(themes): add texture tokens and make body::before token-driven"
```

---

## Task 2: Add Texture Tokens to All Other Themes

**Files:**
- Modify: `src/Brmble.Web/src/themes/clean.css`
- Modify: `src/Brmble.Web/src/themes/blue-lagoon.css`
- Modify: `src/Brmble.Web/src/themes/cosmopolitan.css`
- Modify: `src/Brmble.Web/src/themes/aperol-spritz.css`
- Modify: `src/Brmble.Web/src/themes/midori-sour.css`
- Modify: `src/Brmble.Web/src/themes/lemon-drop.css`
- Modify: `src/Brmble.Web/src/themes/retro-terminal.css`

**Step 1: Add texture tokens to each theme**

Each theme gets unique `--theme-noise-texture`, `--theme-noise-blend`, and `--theme-noise-scale` values. Add these to the existing Theme Features section of each file.

### clean.css
```css
:root[data-theme="clean"] {
  --theme-noise-opacity: 0;
  --theme-noise-texture: none;
  --theme-noise-blend: normal;
  --theme-noise-scale: cover;
  --theme-mesh-bg: none;
}
```

### retro-terminal.css — CRT Scanlines
```css
  /* Theme Features — CRT scanline overlay */
  --theme-noise-opacity: 0.06;
  --theme-noise-texture: repeating-linear-gradient(
    0deg,
    rgba(255, 255, 255, 0.03) 0px,
    rgba(255, 255, 255, 0.03) 1px,
    transparent 1px,
    transparent 3px
  );
  --theme-noise-blend: overlay;
  --theme-noise-scale: 100% 100%;
  --theme-mesh-bg: none;
```
Rationale: Horizontal scanlines every 3px. White lines with low opacity so they work on the dark CRT background. `background-size: 100% 100%` prevents tiling artifacts since this is a repeating gradient. The user approved this direction.

### blue-lagoon.css — Flowing Water Turbulence
```css
  /* Theme Features — watery turbulence */
  --theme-noise-opacity: 0.02;
  --theme-noise-texture: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='turbulence' baseFrequency='0.4' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  --theme-noise-blend: soft-light;
  --theme-noise-scale: cover;
  --theme-mesh-bg:
    radial-gradient(circle at 15% 15%, rgba(0, 180, 216, 0.08) 0%, transparent 40%),
    radial-gradient(circle at 85% 85%, rgba(46, 82, 179, 0.08) 0%, transparent 40%);
```
Rationale: `type='turbulence'` (not fractalNoise) gives flowing/organic shapes. Lower `baseFrequency='0.4'` makes larger, more watery patterns. Larger viewBox 400x400 for more detail. `soft-light` blend is gentler than overlay.

### cosmopolitan.css — Fine Silky Grain
```css
  /* Theme Features — fine editorial grain */
  --theme-noise-opacity: 0.015;
  --theme-noise-texture: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  --theme-noise-blend: soft-light;
  --theme-noise-scale: cover;
  --theme-mesh-bg:
    radial-gradient(circle at 15% 15%, rgba(230, 57, 98, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 85% 85%, rgba(140, 45, 106, 0.05) 0%, transparent 40%);
```
Rationale: High baseFrequency (1.2) + 5 octaves = very fine, almost invisible grain. Like magazine print texture. `soft-light` keeps it elegant and subtle.

### aperol-spritz.css — Sun-Dappled Soft Grain
```css
  /* Theme Features — sun-dappled warm grain */
  --theme-noise-opacity: 0.045;
  --theme-noise-texture: url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.5' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  --theme-noise-blend: overlay;
  --theme-noise-scale: cover;
  --theme-mesh-bg:
    radial-gradient(circle at 15% 15%, rgba(232, 101, 26, 0.10) 0%, transparent 40%),
    radial-gradient(circle at 85% 85%, rgba(153, 77, 51, 0.08) 0%, transparent 40%);
```
Rationale: Low baseFrequency (0.5) = larger soft blobs. 3 octaves keeps it smooth. Higher opacity (0.045) like strong film grain. `overlay` blend for warm sun-dappled feel.

### midori-sour.css — Sharp Digital Noise
```css
  /* Theme Features — sharp digital noise */
  --theme-noise-opacity: 0.03;
  --theme-noise-texture: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='turbulence' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  --theme-noise-blend: overlay;
  --theme-noise-scale: cover;
  --theme-mesh-bg:
    radial-gradient(circle at 10% 20%, rgba(0, 200, 83, 0.10) 0%, transparent 35%),
    radial-gradient(circle at 90% 80%, rgba(34, 110, 110, 0.08) 0%, transparent 35%),
    radial-gradient(circle at 50% 50%, rgba(45, 184, 168, 0.05) 0%, transparent 50%);
```
Rationale: `type='turbulence'` (not fractalNoise) gives sharper, more digital-feeling pattern. High baseFrequency (0.9) keeps it crisp. Cyberpunk aesthetic.

### lemon-drop.css — Dreamy Soft Focus
```css
  /* Theme Features — dreamy soft-focus grain */
  --theme-noise-opacity: 0.025;
  --theme-noise-texture: url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  --theme-noise-blend: soft-light;
  --theme-noise-scale: cover;
  --theme-mesh-bg:
    radial-gradient(circle at 10% 20%, rgba(245, 197, 24, 0.10) 0%, transparent 35%),
    radial-gradient(circle at 90% 80%, rgba(122, 90, 31, 0.08) 0%, transparent 35%),
    radial-gradient(circle at 50% 50%, rgba(212, 206, 191, 0.05) 0%, transparent 50%);
```
Rationale: Medium-low baseFrequency (0.55) for soft dreamy blobs. 3 octaves keeps it smooth. `soft-light` blend for gentle golden glow through the texture.

**Step 2: Verify all themes switch correctly**

Run dev server, cycle through all 8 themes in Settings. Each should show a distinct texture character:
- Classic: fine film grain
- Clean: nothing
- Retro Terminal: horizontal scanlines
- Blue Lagoon: flowing watery shapes
- Cosmopolitan: barely-there silky grain
- Aperol Spritz: large warm dappled blobs
- Midori Sour: sharp digital static
- Lemon Drop: soft dreamy haze

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/themes/
git commit -m "feat(themes): add unique texture overlays per theme (#170)"
```

---

## Task 3: Add Glow Tokens

**Files:**
- Modify: `src/Brmble.Web/src/index.css` (add glow token defaults to `:root`, update `speaking-pulse` keyframes + `.btn-primary` + `:focus-visible`)
- Modify: All 8 theme CSS files (add `--glow-sm`, `--glow-md`, `--glow-lg`)
- Modify: `src/Brmble.Web/src/components/UserInfoDialog/UserInfoDialog.css`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.css`

**Step 1: Define glow token values per theme**

| Theme | `--glow-sm` | `--glow-md` | `--glow-lg` |
|---|---|---|---|
| classic | `8px` | `12px` | `20px` |
| clean | `8px` | `12px` | `20px` |
| blue-lagoon | `8px` | `12px` | `20px` |
| cosmopolitan | `6px` | `10px` | `16px` |
| aperol-spritz | `8px` | `12px` | `20px` |
| midori-sour | `10px` | `14px` | `22px` |
| lemon-drop | `8px` | `12px` | `20px` |
| retro-terminal | `12px` | `18px` | `28px` |

Cosmopolitan is more refined/subtle. Retro-terminal has intense phosphor glow. Midori-sour is slightly more energetic.

Add to each theme file in the Theme Features section:
```css
  --glow-sm: <value>;
  --glow-md: <value>;
  --glow-lg: <value>;
```

**Step 2: Update `speaking-pulse` keyframe in index.css**

Replace (line 185-188):
```css
@keyframes speaking-pulse {
  0%, 100% { box-shadow: 0 0 var(--glow-sm) var(--accent-success-glow); }
  50%      { box-shadow: 0 0 var(--glow-md) var(--accent-success-glow); }
}
```

**Step 3: Update `.btn-primary` in index.css**

Replace (lines 261, 266):
```css
.btn-primary {
  /* ... */
  box-shadow: 0 0 var(--glow-md) var(--accent-primary-glow);
}

.btn-primary:hover:not(:disabled) {
  /* ... */
  box-shadow: 0 0 var(--glow-lg) var(--accent-primary-glow);
}
```

**Step 4: Update component CSS files**

Replace all hardcoded glow pixel values with the appropriate token. Mapping:

| Hardcoded | Token |
|---|---|
| `0 0 8px <color>` | `0 0 var(--glow-sm) <color>` |
| `0 0 10px <color>` | `0 0 var(--glow-sm) <color>` |
| `0 0 12px <color>` | `0 0 var(--glow-md) <color>` |
| `0 0 16px <color>` | `0 0 var(--glow-md) <color>` |
| `0 0 20px <color>` | `0 0 var(--glow-lg) <color>` |
| `0 0 24px <color>` | `0 0 var(--glow-lg) <color>` |

Apply to these specific locations:

**UserInfoDialog.css:**
- Line 87: `0 0 12px` → `0 0 var(--glow-md)`
- Line 92: `0 0 20px` → `0 0 var(--glow-lg)`
- Line 190: `0 0 10px` → `0 0 var(--glow-sm)`
- Line 196: `0 0 16px` → `0 0 var(--glow-md)`
- Line 206: `0 0 10px` → `0 0 var(--glow-sm)`
- Line 250: `0 0 12px` → `0 0 var(--glow-md)`
- Line 255: `0 0 20px` → `0 0 var(--glow-lg)`

**UserPanel.css:**
- Line 163: `0 0 20px` → `0 0 var(--glow-lg)`
- Line 175: `0 0 12px` → `0 0 var(--glow-md)`

**ChannelTree.css:**
- Line 173: `0 0 12px` → `0 0 var(--glow-md)`

**AudioSettingsTab.css:**
- Line 26: `0 0 8px` → `0 0 var(--glow-sm)`
- Line 33: `0 0 12px` → `0 0 var(--glow-md)`

**MessageInput.css:**
- Line 20: `0 0 20px` → `0 0 var(--glow-lg)`
- Line 54: `0 0 16px` → `0 0 var(--glow-md)`

**NOTE:** Do NOT change `0 0 0 Npx` ring/outline shadows (like focus rings or badge outlines). Those are structural, not glow effects.

**Step 5: Verify**

Switch to retro-terminal, hover over buttons — glows should be noticeably larger. Switch to cosmopolitan — glows should be refined and subtle.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(themes): add per-theme glow intensity tokens (--glow-sm/md/lg)"
```

---

## Task 4: Add Overlay Blur Token

**Files:**
- Modify: All 8 theme CSS files (add `--glass-blur-overlay`)
- Modify: `src/Brmble.Web/src/components/UserInfoDialog/UserInfoDialog.css`
- Modify: `src/Brmble.Web/src/components/ConnectModal/ConnectModal.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/CloseDialog/CloseDialog.css`

**Step 1: Add `--glass-blur-overlay` to each theme**

| Theme | `--glass-blur-overlay` | Rationale |
|---|---|---|
| classic | `blur(6px)` | Subtle backdrop blur for overlays |
| clean | `blur(6px)` | Same as classic (inherits palette) |
| blue-lagoon | `blur(6px)` | Standard |
| cosmopolitan | `blur(8px)` | Slightly more polished/frosted |
| aperol-spritz | `blur(6px)` | Standard |
| midori-sour | `blur(4px)` | Slightly less — cyberpunk is sharper |
| lemon-drop | `blur(6px)` | Standard |
| retro-terminal | `blur(0px)` | CRTs don't have glass blur. Must be 0. |

Add to Glass Effect section of each theme file:
```css
  --glass-blur-overlay: blur(Npx);
```

**Step 2: Update the 4 component files**

Replace hardcoded `backdrop-filter: blur(Npx)` with `backdrop-filter: var(--glass-blur-overlay)`:

- `UserInfoDialog.css` line 5: `backdrop-filter: blur(6px)` → `backdrop-filter: var(--glass-blur-overlay)`
- `ConnectModal.css` line 8: `backdrop-filter: blur(8px)` → `backdrop-filter: var(--glass-blur-overlay)`
- `ShortcutsSettingsTab.css` line 12: `backdrop-filter: blur(6px)` → `backdrop-filter: var(--glass-blur-overlay)`
- `CloseDialog.css` line 5: `backdrop-filter: blur(6px)` → `backdrop-filter: var(--glass-blur-overlay)`

**Step 3: Verify**

Switch to retro-terminal, open a modal (click a user, or Settings > Shortcuts > reassign to trigger conflict). The overlay backdrop should NOT be blurred (flat CRT look).

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(themes): add --glass-blur-overlay token, fix retro-terminal modal blur"
```

---

## Task 5: Move Border Radius Scale to Theme Files

**Files:**
- Modify: `src/Brmble.Web/src/index.css` (remove radius tokens from `:root`)
- Modify: All 8 theme CSS files (add radius tokens)

**Step 1: Remove radius tokens from global `:root` in index.css**

Remove these lines from `:root` (lines 3-8):
```css
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 50%;
```

**Step 2: Add radius tokens to each theme**

| Theme | xs | sm | md | lg | xl | full | Rationale |
|---|---|---|---|---|---|---|---|
| classic | `4px` | `6px` | `8px` | `12px` | `16px` | `50%` | Standard (same as before) |
| clean | `4px` | `6px` | `8px` | `12px` | `16px` | `50%` | Same as classic |
| blue-lagoon | `4px` | `6px` | `8px` | `12px` | `16px` | `50%` | Standard |
| cosmopolitan | `4px` | `8px` | `10px` | `14px` | `18px` | `50%` | Rounder — polished magazine feel |
| aperol-spritz | `4px` | `6px` | `8px` | `12px` | `16px` | `50%` | Standard warm |
| midori-sour | `3px` | `5px` | `6px` | `10px` | `14px` | `50%` | Slightly tighter — techy |
| lemon-drop | `4px` | `6px` | `8px` | `12px` | `16px` | `50%` | Standard |
| retro-terminal | `0px` | `0px` | `2px` | `2px` | `4px` | `50%` | Sharp corners — CRT monitor. `radius-full` stays `50%` for avatar circles. |

Add to each theme file at the top (before Backgrounds section):

```css
  /* Border Radius Scale */
  --radius-xs: Npx;
  --radius-sm: Npx;
  --radius-md: Npx;
  --radius-lg: Npx;
  --radius-xl: Npx;
  --radius-full: 50%;
```

**Step 3: Verify**

Switch to retro-terminal — all panels, buttons, cards should have sharp corners (0-2px radii). Avatars should remain circular. Switch to cosmopolitan — everything slightly rounder.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(themes): move border-radius scale to per-theme tokens"
```

---

## Task 6: Fix Bug — MessagesSettingsTab.css Wrong Token Names

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.css`

**Step 1: Replace wrong token names with correct Brmble tokens**

Replace the entire file content with:

```css
/* Messages settings tab styles - inherits from parent settings styles */

.settings-select {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
}

.settings-select:focus {
  outline: none;
  border-color: var(--accent-primary);
}
```

Token mapping:
- `--input-bg` (non-existent) → `--bg-input` (correct)
- `--border-color` (non-existent) → `--border-subtle` (correct)
- `--accent-color` (non-existent) → `--accent-primary` (correct)
- Hardcoded `border-radius: 4px` → `var(--radius-xs)` (correct)
- `--text-primary` fallback removed (token always exists)

**Step 2: Verify**

Open Settings > Messages tab. The select dropdown should use theme colors correctly.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.css
git commit -m "fix: use correct theme tokens in MessagesSettingsTab"
```

---

## Task 7: Fix Bug — CertWizard.tsx Hardcoded Color

**Files:**
- Modify: `src/Brmble.Web/src/components/CertWizard/CertWizard.tsx` (lines 224 and 247)

**Step 1: Replace hardcoded hex with theme token**

At line 224 and 247, replace:
```tsx
{error && <p style={{ color: '#ff6b7a', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>}
```

With:
```tsx
{error && <p style={{ color: 'var(--accent-danger-text)', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</p>}
```

**Step 2: Verify**

Navigate to identity settings, trigger the cert wizard, cause an error. The error text should be themed correctly (not always classic's red).

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/CertWizard/CertWizard.tsx
git commit -m "fix: use theme token for error color in CertWizard"
```

---

## Task 8: Update Theme Template

**Files:**
- Modify: `src/Brmble.Web/src/themes/_template.css`

**Step 1: Add documentation for all new tokens**

Update the `_template.css` file to include the new token categories:
- Border Radius Scale section (6 tokens)
- Theme Features section expanded with texture tokens (3 new)
- Glow Scale section (3 tokens)
- Glass Effect section expanded with `--glass-blur-overlay`

Use the same documentation style as existing sections with comments explaining what each token controls and sensible defaults for new themes.

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/themes/_template.css
git commit -m "docs(themes): update template with new visual identity tokens"
```

---

## Task 9: Final Verification

**Step 1: Build check**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build, no errors.

**Step 2: Visual spot check**

Cycle through all 8 themes and verify:
- [ ] Classic: Film grain, standard glow, standard radii
- [ ] Clean: No texture, no mesh, same everything else as classic
- [ ] Retro Terminal: Scanlines, large glow, sharp corners, no blur on modals
- [ ] Blue Lagoon: Flowing watery texture, standard glow
- [ ] Cosmopolitan: Barely-visible fine grain, subtle glow, rounder corners
- [ ] Aperol Spritz: Warm large-blob grain, standard glow
- [ ] Midori Sour: Sharp digital noise, slightly larger glow, slightly tighter radii
- [ ] Lemon Drop: Dreamy soft-focus grain, standard glow

**Step 3: Commit any final tweaks**

If values need adjustment after visual review, update and commit.
