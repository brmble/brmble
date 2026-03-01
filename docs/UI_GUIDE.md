# Brmble UI Contributor Guide

Audience: AI agents (Claude sessions) and human contributors building Brmble UI.
Format: Flat rulebook. Numbered rules, tables, do/don't examples. No fluff.

---

## 1. Quick Reference

| Resource | Path | Contents |
|---|---|---|
| Global tokens | `src/Brmble.Web/src/index.css` | 39 `:root` tokens (spacing, font sizes, layout, transitions, animations, heading scale) |
| Heading classes | `src/Brmble.Web/src/styles/headings.css` | 3-tier heading system |
| Theme template | `src/Brmble.Web/src/themes/_template.css` | 73 per-theme token slots with derivation formulas |

### Heading Classes (Quick)

| Class | Element | Size | Use |
|---|---|---|---|
| `.heading-title` | `<h2>` | 28px | Page titles, modal titles |
| `.heading-section` | `<h3>` | 14px | Uppercase section headers |
| `.heading-label` | `<h4>` | 10px | Uppercase italic sidebar labels |

### The Absolute Rule

**Never hardcode colors, font sizes, border-radius, or font families. Always use CSS custom property tokens.**

---

## 2. Token System Rules

All visual properties must come from CSS custom properties. Two layers exist:

### Layer 1: Global Tokens (39 in `:root`, `index.css`)

| Group | Tokens | Range |
|---|---|---|
| Spacing | `--space-2xs` through `--space-3xl` | 4px - 64px (8 tokens) |
| Font sizes | `--text-xs` through `--text-4xl` | 12px - 40px (8 tokens) |
| Layout | `--sidebar-width`, `--header-height` | 280px, 60px (2 tokens) |
| Transitions | `--transition-fast`, `--transition-normal`, `--transition-slow` | 150ms, 250ms, 400ms (3 tokens) |
| Entrance animations | `--animation-fast/normal/slow`, `--stagger-step` | 150ms, 300ms, 400ms, 50ms (4 tokens) |
| Continuous animations | `--animation-blink` through `--animation-badge-pulse-delay` | 0.5s - 2.4s (8 tokens) |
| Heading scale | `--heading-title-size/color`, `--heading-section-size/color`, `--heading-label-size/color` | (6 tokens) |

### Layer 2: Per-Theme Tokens (73 in `_template.css`)

| Group | Count | Prefix |
|---|---|---|
| Backgrounds | 12 | `--bg-*` |
| Primary accent | 7 | `--accent-primary*` |
| Secondary accent | 3 | `--accent-secondary*` |
| Success accent | 3 | `--accent-success*` |
| Decorative accent | 4 | `--accent-decorative*`, `--bg-avatar-*` |
| Danger accent | 6 | `--accent-danger*` |
| Status | 1 | `--status-connected` |
| Text | 7 | `--text-*` |
| Borders & effects | 2 | `--border-*` |
| Glass | 3 | `--glass-*` |
| Shadows | 3 | `--shadow-*` |
| Glow | 3 | `--glow-*` |
| Border radius | 6 | `--radius-*` |
| Typography | 3 | `--font-*` |
| Heading scale | 6 | `--heading-*` |
| Theme features | 4 | `--theme-*` |

### Semantic Naming Convention

| Prefix | Purpose |
|---|---|
| `--bg-*` | Background colors and overlays |
| `--text-*` | Text colors |
| `--accent-*` | Accent colors (primary, secondary, success, danger, decorative) |
| `--radius-*` | Border radius values |
| `--space-*` | Spacing (padding, margin, gap) |
| `--transition-*` | Transition timing |
| `--glass-*` | Glass/frosted panel effects |
| `--shadow-*` | Box shadows and drop shadows |
| `--glow-*` | Glow spread radius |

### Do / Don't

| Don't | Do |
|---|---|
| `color: #f5f0e8` | `color: var(--text-primary)` |
| `background: rgba(61, 42, 92, 0.15)` | `background: var(--bg-surface)` |
| `border-radius: 8px` | `border-radius: var(--radius-md)` |
| `font-family: 'Cormorant Garamond'` | `font-family: var(--font-display)` |
| `transition: 150ms ease` | `transition: var(--transition-fast)` |
| `padding: 1rem` | `padding: var(--space-md)` |
| `box-shadow: 0 8px 32px rgba(0,0,0,0.4)` | `box-shadow: var(--shadow-elevated)` |

---

## 3. Heading System

Reference: `src/Brmble.Web/src/styles/headings.css`

### Tiers

| Tier | Class | Element | Size Token | Color Token | Style |
|---|---|---|---|---|---|
| Title | `.heading-title` | `<h2>` | `--heading-title-size` (28px) | `--heading-title-color` | `letter-spacing: 0.02em` |
| Section | `.heading-section` | `<h3>` | `--heading-section-size` (14px) | `--heading-section-color` | `text-transform: uppercase; letter-spacing: 0.05em` |
| Label | `.heading-label` | `<h4>` | `--heading-label-size` (10px) | `--heading-label-color` | `text-transform: uppercase; letter-spacing: 0.18em; font-style: italic` |

### Shared Properties (All Tiers)

```css
font-family: var(--font-display);
font-weight: 600;
margin: 0;
```

### Usage Pattern

Heading classes are combined with component-specific classes for spacing and positioning:

```jsx
<h2 className="heading-title modal-title">Settings</h2>
<h3 className="heading-section settings-section-title">Input</h3>
<h4 className="heading-label">Channels</h4>
```

### Exclusions (NOT Part of the Heading System)

- `.header-logo` in `Header.tsx` -- uses CSS gradient text fill, standalone branding element
- `.user-info-label` in `UserInfoDialog.tsx` -- form field label for volume/mute/comment, not a structural heading

---

## 4. Component Patterns

### Modal Pattern

Reference: `ConnectModal.tsx`, `SettingsModal.tsx`

```
div.modal-overlay
  div.[modal-name].glass-panel.animate-slide-up
    button.modal-close  (optional, SVG X icon)
    div.modal-header
      h2.heading-title.modal-title
      p.modal-subtitle
    [content area - form, tabs, etc.]
    div.[modal]-footer
      button.btn.btn-primary
```

Rules:
1. Overlay uses `div.modal-overlay` with `onClick={onClose}`
2. Modal container always has `.glass-panel.animate-slide-up`
3. Content area stops propagation: `onClick={(e) => e.stopPropagation()}`
4. Title is always `h2.heading-title.modal-title`

### Settings Tab Pattern

Reference: `AudioSettingsTab.tsx`

```
div.[tab-name]-tab
  div.settings-section
    h3.heading-section.settings-section-title
    div.settings-item
    div.settings-item.settings-toggle
    div.settings-item.settings-slider
  div.settings-section
    h3.heading-section.settings-section-title
    ...
```

Rules:
1. Each logical group is a `div.settings-section`
2. Section title is always `h3.heading-section.settings-section-title`
3. Each control row is `div.settings-item` with optional modifier (`.settings-toggle`, `.settings-slider`)

### Sidebar Section Pattern

Reference: `Sidebar.tsx`

```
div.[section]-panel
  div.[section]-header
    h4.heading-label
    span.[section]-count
  div.[section]-list
    div.[item]-row
```

Example from `Sidebar.tsx`:
```
div.root-users-panel
  div.root-users-header
    h4.heading-label          "Connected"
    span.root-users-count
  div.root-users-list
    div.root-user-row
```

### Form Inputs

| Element | Class | Notes |
|---|---|---|
| Text input | `input.brmble-input` | Global style in `index.css` |
| Select dropdown | `div.select-wrapper > select.brmble-input` | Wrapper provides custom arrow |
| Toggle switch | `label.brmble-toggle > input[type=checkbox] + span.brmble-toggle-slider` | 44x24px |

### Buttons

| Class | Use |
|---|---|
| `button.btn.btn-primary` | Primary actions (Connect, Save, Close) |
| `button.btn.btn-secondary` | Secondary actions |
| `button.btn.btn-ghost` | Tertiary/subtle actions |
| `button.btn.btn-danger` | Destructive actions (Disconnect, Ban) |
| `.btn-sm` | Small variant modifier (add to any btn) |
| `.btn-icon` | Icon-only button (36x36px square) |

---

## 5. Theme Compatibility

### Core Principle

Every theme defines the same 73 tokens. If your UI only uses tokens, it automatically works across all 8 themes.

### Creating New Themes

Follow `_template.css` "3 Decisions" framework:
1. **Base Hue** -- HSL degree that tints all neutral surfaces
2. **Primary Accent** -- single hero hex color
3. **Text Warmth** -- warm / cool / tinted

### Retro Terminal Deviations

Retro Terminal (`retro-terminal.css`) breaks several assumptions that other themes share. Account for these:

| Property | Most Themes | Retro Terminal |
|---|---|---|
| Glass blur | `blur(6-12px)` | `blur(0px)` -- no blur at all |
| Border radius | `4-18px` range | `0-4px` range (near-zero) |
| Display font | Serif (Cormorant Garamond, etc.) | Monospace (VT323) -- wider characters |
| Body font | Sans-serif (Outfit, etc.) | Monospace (IBM Plex Mono) -- wider characters |
| `--heading-section-color` | `var(--accent-secondary)` | `var(--accent-primary)` (green) |
| `--heading-label-color` | `var(--text-muted)` | `var(--accent-primary-glow)` (green glow) |
| Mesh background | Radial gradients | `none` |

**Implications:**
- Do not rely on glass blur for readability -- content must be legible on flat backgrounds
- Do not assume rounded corners -- layouts must work with sharp edges
- Layouts must handle wider monospace characters without overflow

### Visual Testing Rule

**Check new UI against at minimum Classic and Retro Terminal themes before shipping.**

---

## 6. Typography

| Token | Use | Classic | Retro Terminal |
|---|---|---|---|
| `var(--font-display)` | Headings, avatars, large display text | Cormorant Garamond | VT323 |
| `var(--font-body)` | All body text, chat, settings, UI labels | Outfit | IBM Plex Mono |
| `var(--font-mono)` | Code blocks, badges, technical readouts | JetBrains Mono | JetBrains Mono |

**Rule: Never set `font-family` directly in component CSS. Always use the token.**

---

## 7. Interaction States

### Hover

- Background: use `--bg-hover` / `--bg-hover-light` / `--bg-hover-strong` for background changes
- Timing: `transition: var(--transition-fast)` (150ms)
- Prefer background changes + subtle transforms over border changes

### Active / Pressed

- `transform: scale(0.95)` for tactile feel
- Accent color swap (e.g. primary to secondary) for emphasis

### Focus

- Use `:focus-visible` only -- no focus rings on mouse click
- Dual-ring box-shadow pattern:
  ```css
  box-shadow: 0 0 0 2px var(--bg-deep), 0 0 0 4px var(--accent-primary);
  ```
- This is already set globally in `index.css` -- only override if a component needs different behavior

### Transition Tokens

| Token | Duration | Use |
|---|---|---|
| `--transition-fast` | 150ms | Hover states, micro-interactions |
| `--transition-normal` | 250ms | Modals, panel transitions |
| `--transition-slow` | 400ms | Page transitions |

---

## 8. Spatial Rules

### Spacing Scale

Use `--space-*` tokens for all padding, margin, and gap values.

| Token | Value |
|---|---|
| `--space-2xs` | 4px |
| `--space-xs` | 8px |
| `--space-sm` | 12px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |
| `--space-2xl` | 48px |
| `--space-3xl` | 64px |

### Border Radius Scale

Use `--radius-*` tokens. Do not assume rounded corners exist (Retro Terminal is near-zero).

| Token | Classic | Retro Terminal |
|---|---|---|
| `--radius-xs` | 4px | 0px |
| `--radius-sm` | 6px | 0px |
| `--radius-md` | 8px | 2px |
| `--radius-lg` | 12px | 2px |
| `--radius-xl` | 16px | 4px |
| `--radius-full` | 50% | 50% |

### Negative Space

Intentional negative space is a design principle. Let content breathe. Do not pack elements tightly. Use `--space-md` (16px) or larger as default component padding. Use `--space-sm` (12px) minimum between related items within a group.
