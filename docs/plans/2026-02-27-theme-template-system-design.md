# Theme Template System Design

## Summary

Introduce a modular theme system with a self-documenting CSS template, semantic token naming, dynamic font loading, and 8 themes: Brmble Classic, Brmble Clean, Blue Lagoon, Cosmopolitan, Aperol Spritz, Midori Sour, Lemon Drop Martini, and Retro Terminal.

## Context

The current system has two themes (Classic and Clean) defined inline in `index.css` via CSS custom properties. Classic is the bare `:root` default; Clean overrides ~27 tokens via `:root[data-theme="clean"]`. All component CSS files consume tokens via `var(--token-name)` with near-zero hardcoded colors.

The goal is to make it fast and intuitive to create new themes while maintaining the cohesion that makes Classic feel polished.

## Architecture Decisions

### CSS-First Theme Files

Each theme is a standalone `.css` file in `src/Brmble.Web/src/themes/` scoped to `:root[data-theme="<id>"]`. All theme CSS is bundled by Vite and imported statically. Only the active theme's selector matches.

**Rationale:** CSS custom properties are purpose-built for this. No runtime overhead. Git-diffable. Works with the existing `data-theme` switching mechanism.

### Extract Classic from index.css

Classic moves to its own `themes/classic.css` file. `index.css` retains only structural tokens (spacing, radius, font sizes, transitions, layout) plus global resets and utility classes.

**Rationale:** Every theme is a peer file in the same directory. Consistent pattern for creating new themes. Classic remains the fallback since it's imported first in the chain.

### Semantic Token Naming

Rename cocktail-specific accent names to role-based names:

| Old | New | Role |
|-----|-----|------|
| `--accent-berry*` | `--accent-primary*` | Buttons, CTAs, focus rings |
| `--accent-lemon*` | `--accent-secondary*` | Links, highlights |
| `--accent-mint*` | `--accent-success*` | Connected, speaking, success |
| `--accent-purple*` | `--accent-decorative*` | Avatars, decorative elements |
| `--accent-danger*` | `--accent-danger*` | No change |

**Rationale:** `--accent-primary` being blue in Blue Lagoon makes intuitive sense. `--accent-berry` being blue does not.

### Per-Theme Fonts with Dynamic Loading

Each theme specifies its own font families. A `theme-loader.ts` utility swaps the Google Fonts `<link>` tag when themes change.

**Rationale:** Typography is a huge part of theme personality. Restricting all themes to the same fonts undermines distinctiveness.

### Per-Theme Accents

All accent colors (primary, secondary, success, decorative, danger) are overridable per theme.

**Rationale:** A Blue Lagoon theme with berry-pink buttons would feel incoherent. Each cocktail has its own color story.

## File Structure

```
src/Brmble.Web/src/
├── themes/
│   ├── _template.css            # Annotated template with design-intent docs
│   ├── theme-registry.ts        # Theme metadata (id, name, description, fontUrl)
│   ├── theme-loader.ts          # Dynamic font loading utility
│   ├── classic.css              # Brmble Classic (default)
│   ├── clean.css                # Brmble Clean
│   ├── blue-lagoon.css
│   ├── cosmopolitan.css
│   ├── aperol-spritz.css
│   ├── midori-sour.css
│   ├── lemon-drop.css
│   └── retro-terminal.css
```

## Template Design

### Three Starting Decisions

Every theme begins with 3 choices from which all tokens derive:

1. **Base Hue** (HSL degree) -- tints backgrounds, borders, text grays
2. **Primary Accent** (hex) -- the hero color for buttons and interactions
3. **Text Warmth** (warm/cool/tinted) -- determines `--text-primary` and gray tinting

### Design-Intent Annotations

The `_template.css` file includes rich documentation for each token group:

- **Formulas** for deriving values from the 3 base decisions (HSL ranges, alpha scales)
- **Worked examples** showing how Classic derived its specific values
- **Soft vs Hard spectrum** notes for adjusting intensity
- **Relationship explanations** (why tinted grays feel more cohesive than neutral grays)
- **Derivation chains** (how to go from a single accent hex to all 7 variants)

Example excerpt:

```
DERIVATION CHAIN (start with your chosen accent hex):
┌─────────────┬──────────────────────────────────────────┐
│ base        │ Your chosen color as-is                  │
│ dark        │ Darken 10-15% (pressed states)           │
│ hover       │ Lighten 8-10% (hover feedback)           │
│ light       │ Lighten 15-20% (softer variant)          │
│ glow        │ base at alpha 0.4 (box-shadow halos)     │
│ wash        │ base at alpha 0.2 (background tints)     │
│ ghost       │ base at alpha 0.1 (faint outlines)       │
└─────────────┴──────────────────────────────────────────┘
```

## Theme Designs

### Brmble Classic (default)
- **Base Hue:** 270deg (purple)
- **Primary Accent:** `#d4145a` (berry pink)
- **Text Warmth:** Warm cream (`#f5f0e8`)
- **Fonts:** Cormorant Garamond (display), Outfit (body), JetBrains Mono (mono)
- **Identity:** Vintage cocktail lounge. Deep purple backgrounds, warm tones, grain overlay, mesh gradients, glassmorphism.

### Brmble Clean
- **Base Hue:** 0deg (neutral, no tint)
- **Primary Accent:** Inherits Classic accents (not overridden)
- **Text Warmth:** Cool (pure white)
- **Fonts:** Same as Classic
- **Identity:** Stripped-down dark mode. No grain, no mesh, neutral grays. Clean and modern.

### Blue Lagoon
- **Base Hue:** 200deg (ocean blue)
- **Primary Accent:** `#00b4d8` (electric cyan-blue)
- **Text Warmth:** Cool -- pure white with blue-tinted grays
- **Fonts:** Playfair Display (display), DM Sans (body)
- **Identity:** Tropical, electric, poolside. Crisp blue-tinted darks. Cyan and deep blue mesh gradients.

### Cosmopolitan
- **Base Hue:** 345deg (deep cranberry-rose)
- **Primary Accent:** `#e63962` (cranberry pink)
- **Text Warmth:** Warm -- rose-tinted cream
- **Fonts:** Bodoni Moda (display), Manrope (body)
- **Identity:** Glamorous, fashion-editorial. Close to Classic in hue family but pushed toward luxury. More contrast, cleaner lines. Minimal grain.

### Aperol Spritz
- **Base Hue:** 25deg (burnt orange-amber)
- **Primary Accent:** `#e8651a` (Aperol orange)
- **Text Warmth:** Very warm -- amber-tinted cream `#faf0e0`
- **Fonts:** Fraunces (display), Nunito (body)
- **Identity:** Warmest theme. Mediterranean sunset, golden hour. Amber-glow backgrounds. Softer, rounder, inviting. Strong film grain.

### Midori Sour
- **Base Hue:** 145deg (deep emerald-green)
- **Primary Accent:** `#00c853` (electric Midori green)
- **Text Warmth:** Cool-neutral -- clean white with green-tinted grays
- **Fonts:** Space Mono (display), Lexend (body)
- **Identity:** Energetic, slightly techy. Bright green on dark emerald. Cyberpunk/neon Tokyo-at-night edge.

### Lemon Drop Martini
- **Base Hue:** 50deg (deep warm gold-amber)
- **Primary Accent:** `#f5c518` (bright lemon gold)
- **Text Warmth:** Warm -- golden cream
- **Fonts:** Sora (display), Plus Jakarta Sans (body)
- **Identity:** Brightest, most optimistic theme. Golden accent against warm darks. Premium and cheerful.

### Retro Terminal
- **Base Hue:** 0deg (pure neutral)
- **Primary Accent:** `#33ff00` (phosphor green)
- **Text Warmth:** Cold -- green-on-black
- **Fonts:** VT323 (display), IBM Plex Mono (body, monospaced everything)
- **Identity:** Monochrome green CRT. Everything monospaced. Highest noise (scanline effect). No glass, no mesh.

## Accent Mapping Across Themes

| Semantic Role | Classic | Blue Lagoon | Cosmo | Aperol | Midori | Lemon Drop | Terminal |
|---|---|---|---|---|---|---|---|
| `--accent-primary` | Berry pink | Cyan blue | Cranberry | Aperol orange | Neon green | Gold | Phosphor green |
| `--accent-secondary` | Lemon yellow | Coral | Rose gold | Warm amber | Teal | Warm white | Amber |
| `--accent-success` | Mint green | Seafoam | Lime | Olive green | Bright lime | Spring green | Bright green |
| `--accent-decorative` | Purple | Deep navy | Deep rose | Terracotta | Deep teal | Amber dark | Dark green |

## Theme Switching Flow

### Runtime
```
User selects theme in Settings
  -> handleThemeChange(themeId)
     -> document.documentElement.setAttribute('data-theme', themeId)
     -> loadThemeFonts(themeId)  // swap <link> href from theme-registry
     -> persist to localStorage + bridge.send('settings.set', ...)
```

### Startup (before React render, in main.tsx)
```
Read localStorage('brmble-settings')
  -> Apply data-theme attribute
  -> Load correct fonts via <link> tag
  -> Render React
```

## Font Loading

`theme-loader.ts` manages a `<link id="brmble-theme-fonts">` element:
- On theme switch: update `href` to the new theme's Google Fonts URL
- On startup: set `href` before first render to prevent FOUT
- Each theme's `fontUrl` is defined in `theme-registry.ts`

## Changes to Existing Files

### index.css
- Remove `@import url(...)` for fonts (moved to theme-loader)
- Remove all color/accent/text/border/shadow/glass tokens (moved to theme files)
- Retain: spacing scale, radius scale, font size scale, transitions, layout tokens, global resets, scrollbar styles, selection, focus, utility classes (`.btn`, `.glass-panel`, `.brmble-input`), animations
- Fix `select.brmble-input` SVG arrow to use `currentColor` instead of hardcoded `#f5f0e8`

### All 23 component CSS files
- Mechanical find-and-replace for accent token renames (berry->primary, lemon->secondary, mint->success, purple->decorative)

### InterfaceSettingsTypes.ts
- Change `theme: 'classic' | 'clean'` to `theme: string`

### InterfaceSettingsTab.tsx
- Import `themes` from `theme-registry.ts`
- Populate `<select>` dropdown dynamically from registry

### main.tsx
- Import all theme CSS files
- Call `loadThemeFonts()` on startup before React render

### SettingsModal.tsx
- Import and call `loadThemeFonts()` during theme change handler

## Migration Steps

1. Create `src/themes/` directory
2. Extract Classic tokens from `index.css` into `themes/classic.css`
3. Move Clean tokens from `index.css` into `themes/clean.css`
4. Strip `index.css` to structural-only tokens + resets + utilities
5. Rename accent tokens across all CSS files (mechanical find-and-replace)
6. Create `theme-registry.ts` and `theme-loader.ts`
7. Update `main.tsx` imports and startup font loading
8. Update `InterfaceSettingsTab.tsx` to use registry
9. Update `InterfaceSettingsTypes.ts` to use `string` type
10. Fix SVG dropdown arrow to use `currentColor`
11. Create `_template.css` with full design-intent documentation
12. Build cocktail themes one by one using the template
13. Test theme switching end-to-end

## Token Inventory

### Structural (stay in index.css, shared across all themes)

| Category | Tokens |
|----------|--------|
| Spacing | `--space-2xs` through `--space-3xl` (8 tokens) |
| Border Radius | `--radius-xs` through `--radius-full` (6 tokens) |
| Font Sizes | `--text-xs` through `--text-4xl` (8 tokens) |
| Layout | `--sidebar-width`, `--header-height` (2 tokens) |
| Transitions | `--transition-fast`, `--transition-normal`, `--transition-slow` (3 tokens) |

### Per-Theme (defined in each theme file)

| Category | Count | Notes |
|----------|-------|-------|
| Backgrounds | 14 | Deep through avatar gradient |
| Primary Accent | 7 | base + dark/hover/light/glow/wash/ghost |
| Secondary Accent | 3 | base + glow/subtle |
| Success Accent | 3 | base + glow/subtle |
| Decorative Accent | 2 | base + glow |
| Danger Accent | 6 | base + strong/text/subtle/border/bg |
| Status | 1 | connected |
| Text | 7 | primary/secondary/muted + dim/strong variants |
| Borders & Glass | 4 | subtle, glow, blur, border |
| Shadows | 3 | dialog, elevated, drop-subtle |
| Typography | 3 | display, body, mono font families |
| Theme Features | 2 | noise opacity, mesh background |
| **Total** | **55** | |
