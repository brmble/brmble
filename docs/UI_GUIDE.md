# Brmble UI Contributor Guide

Audience: AI agents (Claude sessions) and human contributors building Brmble UI.
Format: Flat rulebook. Numbered rules, tables, do/don't examples. No fluff.

---

## 1. Quick Reference

| Resource | Path | Contents |
|---|---|---|
| Global tokens | `src/Brmble.Web/src/index.css` | 41 `:root` tokens (spacing, font sizes, layout, transitions, animations, heading scale) |
| Heading classes | `src/Brmble.Web/src/styles/headings.css` | 3-tier heading system |
| Theme template | `src/Brmble.Web/src/themes/_template.css` | 73 per-theme token slots with derivation formulas |

### Heading Classes (Quick)

| Class | Element | Size | Use |
|---|---|---|---|
| `.heading-title` | `<h2>` | 28px | Page titles, modal titles |
| `.heading-section` | `<h3>` | 18px | Uppercase section headers |
| `.heading-label` | `<h4>` | 10px | Uppercase italic sidebar labels |

### The Absolute Rule

**Never hardcode colors, font sizes, border-radius, or font families. Always use CSS custom property tokens.**

---

## 2. Token System Rules

All visual properties must come from CSS custom properties. Two layers exist:

### Layer 1: Global Tokens (41 in `:root`, `index.css`)

| Group | Tokens | Range |
|---|---|---|
| Spacing | `--space-2xs` through `--space-3xl` | 4px - 64px (8 tokens) |
| Font sizes | `--text-2xs` through `--text-4xl` | 10px - 40px (9 tokens) |
| Layout | `--sidebar-width`, `--header-height` | 280px, 60px (2 tokens) |
| Transitions | `--transition-fast`, `--transition-normal`, `--transition-slow` | 150ms, 250ms, 400ms (3 tokens) |
| Entrance animations | `--animation-fast/normal/slow`, `--stagger-step` | 150ms, 300ms, 400ms, 50ms (4 tokens) |
| Continuous animations | `--animation-blink` through `--animation-heartbeat` | 0.5s - 4s (9 tokens) |
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
| Section | `.heading-section` | `<h3>` | `--heading-section-size` (18px) | `--heading-section-color` | `text-transform: uppercase; letter-spacing: 0.05em` |
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

### Prompt Pattern

Reference: `src/Brmble.Web/src/hooks/usePrompt.tsx`, `src/Brmble.Web/src/components/Prompt/Prompt.css`

Use the `confirm()` function for any action that requires a user decision before proceeding (e.g., destructive actions, conflict resolution). Do **not** use `window.confirm()` — it returns `false` immediately in WebView2.

#### Setup (once, in App.tsx only)

```tsx
// App.tsx
import { usePrompt } from './hooks/usePrompt';

const { Prompt } = usePrompt();

return (
  <div className="app">
    {/* ... all other content ... */}
    <Prompt />   {/* must be last child */}
  </div>
);
```

`usePrompt()` must only be called **once** in the tree (in `App.tsx`). It registers a module-level force-update so that `confirm()` calls from any component trigger the correct re-render.

#### Usage (any component)

```tsx
import { confirm } from '../../hooks/usePrompt';

const result = await confirm({
  title: 'Are you sure?',
  message: 'This action cannot be undone.',
  confirmLabel: 'Delete',   // default: 'Confirm'
  cancelLabel: 'Cancel',    // default: 'Cancel'
});

if (result) {
  // user clicked Confirm
}
```

#### DOM structure

```
div.modal-overlay          (click → cancel)
  div.prompt.glass-panel.animate-slide-up   (stops propagation)
    div.modal-header
      h2.heading-title.modal-title
      p.modal-subtitle
    div.prompt-footer
      button.btn.btn-secondary   Cancel  (autoFocus, bottom-left)
      button.btn.btn-primary     Confirm (bottom-right)
```

Rules:
1. No close button — ESC and overlay click both cancel
2. Cancel is always `btn-secondary` on the left; Confirm is always `btn-primary` on the right
3. `<Prompt />` must be the **last child** of the root `<div className="app">` so it renders above all other content
4. Never call `usePrompt()` in more than one component — only the owner of `<Prompt />` should call it; all others use `confirm()` directly

### Form Inputs

| Element | Class / Component | Notes |
|---|---|---|
| Text input | `input.brmble-input` | Global style in `index.css` |
| Select dropdown | `<Select>` component | Custom themed dropdown (see Select Pattern below) |
| Toggle switch | `label.brmble-toggle > input[type=checkbox] + span.brmble-toggle-slider` | 44x24px, track uses `--radius-lg`, knob uses `--radius-md` |

### Buttons

| Class | Use |
|---|---|
| `button.btn.btn-primary` | Primary actions (Connect, Save, Close) |
| `button.btn.btn-secondary` | Secondary actions |
| `button.btn.btn-ghost` | Tertiary/subtle actions |
| `button.btn.btn-danger` | Destructive actions (Disconnect, Ban) |
| `.btn-sm` | Small variant modifier (add to any btn) |
| `.btn-icon` | Icon-only button (36x36px square) |

### Tooltip Pattern

Reference: `src/Brmble.Web/src/components/Tooltip/Tooltip.tsx`

```tsx
import { Tooltip } from '../Tooltip/Tooltip';

<Tooltip content="Help text">
  <button>Hover me</button>
</Tooltip>

<Tooltip content={dynamicText} position="bottom">
  <span className="info-icon">?</span>
</Tooltip>

// Small buttons near edges — use align to prevent overflow
<Tooltip content="Leave Voice" position="bottom" align="start">
  <button className="btn btn-icon">...</button>
</Tooltip>

<Tooltip content="Settings" position="bottom" align="end">
  <button className="btn btn-icon">...</button>
</Tooltip>
```

Props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `content` | `string` | required | Tooltip text (supports multi-line via `\n`) |
| `children` | `ReactElement` | required | Trigger element |
| `position` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` | Preferred position (auto-flips on overflow) |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | Anchor alignment relative to trigger. For top/bottom: horizontal (start=left edge, end=right edge). For left/right: vertical (start=top edge, end=bottom edge). Use `start` for left/top-edge elements, `end` for right/bottom-edge elements |
| `delay` | `number` | `400` | Hover delay in ms |

Rules:
1. **Never use `title` attribute** -- always use `<Tooltip>` for hover text
2. Tooltip uses theme tokens (`--bg-deep`, `--text-primary`, `--border-subtle`, `--radius-sm`) -- no hardcoded colors
3. Empty `content` renders children only (no tooltip)
4. Multi-line text uses `\n` -- CSS handles line breaks via `white-space: pre-line`
5. Tooltip renders via portal (`document.body`) to escape overflow containers
6. Accessible: `role="tooltip"`, `aria-describedby`, Escape key dismissal
7. For small trigger elements (e.g. `btn-icon`) near window edges, use `align="start"` or `align="end"` to prevent the tooltip from overflowing off-screen
8. **Disabled elements** don't fire mouse/focus events -- wrap them in a `<span>` or `<div>` and attach the Tooltip to the wrapper instead

### Select Pattern

Reference: `src/Brmble.Web/src/components/Select/Select.tsx`, `Select.css`

```tsx
import { Select } from '../Select/Select';

const options = [
  { value: 'option1', label: 'Option One' },
  { value: 'option2', label: 'Option Two' },
];

<Select
  value={selectedValue}
  onChange={setSelectedValue}
  options={options}
/>

// Disabled select (e.g. locked setting)
<Select value={val} onChange={setVal} options={opts} disabled />

// With placeholder for unset state
<Select value="" onChange={setVal} options={opts} placeholder="Choose..." />
```

Props:

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | required | Currently selected option value |
| `onChange` | `(value: string) => void` | required | Selection change callback |
| `options` | `SelectOption[]` | required | Array of `{ value, label }` objects |
| `disabled` | `boolean` | `false` | Disables the trigger button |
| `className` | `string` | `''` | Additional CSS classes on the wrapper |
| `placeholder` | `string` | `undefined` | Shown when no option matches `value` |

#### DOM Structure

```
div.brmble-select
  button.brmble-select-trigger[role="combobox"]
    span  (selected label or placeholder)

// Portal to document.body (when open):
div.brmble-select-dropdown[role="listbox"]
  button.brmble-select-option[role="option"]  (one per option)
```

#### Keyboard Navigation

| Key | Action |
|---|---|
| `ArrowDown` / `ArrowUp` | Move highlight (wraps around) |
| `Home` / `End` | Jump to first / last option |
| `Enter` / `Space` | Select highlighted option |
| `Escape` | Close dropdown, return focus to trigger |
| Any letter | Type-ahead: jump to first matching option |

Rules:
1. **Always use `<Select>` instead of native `<select>`** -- native selects don't respect theme tokens
2. Dropdown renders via portal (`document.body`) to escape overflow containers -- follows the same pattern as ContextMenu and Tooltip
3. Position auto-flips above trigger if there isn't enough space below
4. Clicking outside or pressing Escape dismisses the dropdown
5. Full ARIA: `role="combobox"` on trigger, `role="listbox"` on dropdown, `role="option"` on items, `aria-expanded`, `aria-activedescendant`
6. Trigger and dropdown use theme tokens (`--bg-primary`, `--glass-border`, `--radius-md`, `--shadow-elevated`) -- no hardcoded values
7. **Disabled selects** with tooltips: wrap `<Select>` in a wrapper and attach `<Tooltip>` to the wrapper, since disabled buttons don't fire mouse events

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

---

## 9. Logo & Brand Assets

### Source File

`src/Brmble.Web/src/assets/brmble-logo.svg` — 1024x1024 viewBox, 35 paths, `currentColor` fill.

### BrmbleLogo Component

Reference: `src/Brmble.Web/src/components/Header/BrmbleLogo.tsx`, `BrmbleLogo.css`

```tsx
<BrmbleLogo size={32} />              // Header (hover animation)
<BrmbleLogo size={192} heartbeat />   // Welcome screen (continuous pulse)
```

Props:
| Prop | Type | Default | Use |
|---|---|---|---|
| `size` | `number` | `32` | Width/height in px |
| `heartbeat` | `boolean` | `false` | Enable continuous pulse animation |
| `className` | `string` | `''` | Additional CSS classes |

### Ring Architecture

Paths are grouped into 4 concentric rings by distance from center (512,512):

| Ring | Class | Paths | Movement | Gradient |
|---|---|---|---|---|
| Center | `.logo-ring-center` | 1 | None (fixed) | Yes |
| Inner | `.logo-ring-inner` | 6 | Smallest | Yes |
| Middle | `.logo-ring-middle` | 10 | Moderate | Yes |
| Outer | `.logo-ring-outer` | 18 | Largest | Yes |

Each path has `--dx`/`--dy` CSS custom properties (unit vector from center to path start point) used for directional translation.

### Animation Modes

**Hover** (default): Rings translate outward along their `--dx`/`--dy` vectors. All elements receive the same gradient transition from `--text-primary` to `--accent-secondary`.

**Heartbeat** (`heartbeat` prop): Continuous double-beat pulse (*thump-thump* ... rest). Duration controlled by `--animation-heartbeat` token. All elements share the same uniform gradient pulse.

### SVG Gradient ID Collisions

Multiple `<BrmbleLogo>` instances on the same page cause SVG gradient `id` collisions. The component solves this with a `useState`-based instance counter generating unique prefixes, passed to CSS via `--grad-center`, `--grad-inner`, `--grad-middle`, `--grad-outer` custom properties.

**Rule: Never use bare string IDs for SVG gradients/filters/clips. Always generate unique IDs per component instance.**

---

## 10. Animation & Motion

### Token Categories

| Category | Tokens | Use |
|---|---|---|
| Transitions | `--transition-fast/normal/slow` | Hover states, modals, page transitions |
| Entrance | `--animation-fast/normal/slow`, `--stagger-step` | One-shot slide/fade-in |
| Continuous | `--animation-blink` through `--animation-heartbeat` | Looping UI animations |

### Rules

1. **All animation durations must use tokens.** If no existing token fits, add a new one to `:root` in `index.css` and to the `prefers-reduced-motion` override block.
2. **`prefers-reduced-motion` must be respected.** Continuous animations in `index.css` are zeroed out globally. Component-level `@keyframes` should also have a `prefers-reduced-motion: reduce` fallback that sets `animation: none`.
3. **Hover animations use CSS transitions** via `transition` property with `--transition-*` tokens. Do not use `@keyframes` for hover effects.
4. **Continuous animations use `@keyframes`** with `--animation-*` tokens for duration. Always set `will-change` on animated properties.
5. **`color-mix(in srgb, ...)`** is the preferred method for intermediate color blends between theme tokens (e.g. 60% of `--text-primary` mixed with 40% of `--accent-secondary`).

### SVG Fill Transitions

SVG `fill` cannot transition between `currentColor` and `url(#gradient)`. The workaround:

1. Define gradient `<stop>` elements whose `stop-color` starts as `--text-primary` (visually identical to `currentColor`)
2. Transition the `stop-color` to the target color on hover/animation
3. Apply the gradient `fill` via CSS custom property: `fill: var(--grad-inner)`

This gives the appearance of transitioning from solid to gradient.

---

## 11. Inline SVG Guidelines

### When to Use Inline SVG

- **Icons** (< 24 paths): Inline in JSX with `currentColor` for theme compatibility
- **Logo** (35 paths, animated): Dedicated React component (`BrmbleLogo`)
- **Complex illustrations**: Use `<img>` tag referencing static asset

### Rules

1. **Always use `currentColor`** for fill/stroke on theme-aware SVGs. Never hardcode colors.
2. **Use `aria-label`** on decorative/branded SVGs. Use `aria-hidden="true"` on purely decorative icons adjacent to text labels.
3. **Component-specific dimensions** (icon sizes, avatar sizes, button sizes) that don't map to spacing tokens should use local CSS custom properties for documentation and reuse:
   ```css
   .my-component {
     --icon-size: 28px;
     width: var(--icon-size);
     height: var(--icon-size);
   }
   ```
4. **`overflow: visible`** must be set on SVGs with hover/animation effects that translate elements outside the viewBox.
