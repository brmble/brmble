# Custom Select Component Design

**Issue:** #157 — Style HTML select dropdowns to match theme  
**Date:** 2026-03-12  
**Branch:** `fix/ui-select-and-toggle-styling`

## Problem

All 6 `<select>` elements in the settings tabs use native browser dropdowns. The `<option>` elements render with the OS default styling (white background, no border-radius, no hover effects), which clashes with the dark-themed UI. Two inconsistent styling systems exist: `.brmble-input` (5 selects) and `.settings-select` (1 select in MessagesSettingsTab).

## Decision

Build a custom reusable `<Select>` React component with a portal-rendered dropdown, following the ContextMenu pattern for positioning/dismissal and the `.brmble-input` pattern for trigger styling.

## Component API

```tsx
interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}
```

- Controlled only (value + onChange)
- Single-select, no search/filter
- `placeholder` covers "Default" / "Last connected server" patterns (options with empty value)
- `disabled` covers the ConnectionSettingsTab case

## Visual Design

### Trigger (closed state)

- Styled like current `select.brmble-input`: `background: var(--bg-input)`, `border: 1px solid var(--border-subtle)`, `border-radius: var(--radius-sm)`
- CSS triangle arrow via `::after` on wrapper (same as `.select-wrapper`)
- Focus: `border-color: var(--accent-primary)`, `box-shadow: 0 0 0 1px var(--accent-primary-glow)`
- Disabled: `opacity: 0.5`, `pointer-events: none`
- Displays selected option label, or placeholder text in `var(--text-muted)` if no match

### Dropdown (open state)

- Rendered via `createPortal` to `document.body`
- `position: fixed`, positioned below trigger using `getBoundingClientRect()`
- Width matches trigger width
- `background: var(--bg-primary)`, `border: var(--glass-border)`, `border-radius: var(--radius-md)`, `box-shadow: var(--shadow-elevated)`
- Inner padding: `0.375rem`
- `z-index: 1000` (same tier as ContextMenu)
- `popIn` animation on open
- If dropdown overflows viewport bottom, flips above trigger

### Option items

- `padding: 0.5rem 0.75rem`, `border-radius: var(--radius-xs)`
- Hover: `background: var(--bg-hover)`, `color: var(--text-primary)`
- Selected: `background: var(--bg-surface-active)`, `color: var(--text-primary)`
- Font: `var(--font-body)`, `var(--text-sm)`

### Scroll

- `max-height: 240px`, `overflow-y: auto` when options exceed ~8 items
- Highlighted/selected option scrolled into view on open

## Interaction & Accessibility

### Opening/closing

- Click trigger toggles open/closed
- Click outside (document mousedown listener) closes
- Escape closes
- Selecting an option closes and fires onChange

### Keyboard navigation

- Trigger focused: ArrowDown / Space / Enter opens dropdown
- While open: ArrowUp/ArrowDown moves highlight
- Enter selects highlighted option
- Home/End jump to first/last
- Character typing jumps to matching option (type-ahead)

### ARIA

- Trigger: `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, `aria-activedescendant`
- Dropdown: `role="listbox"`
- Options: `role="option"`, `aria-selected`
- Linked via `aria-controls` + `id`

## File Structure

### New files

- `src/Brmble.Web/src/components/Select/Select.tsx`
- `src/Brmble.Web/src/components/Select/Select.css`
- `src/Brmble.Web/src/components/Select/index.ts`

### Modified files

- `AudioSettingsTab.tsx` — replace 3 native selects
- `ConnectionSettingsTab.tsx` — replace 1 native select (disabled state + Tooltip wrapper)
- `MessagesSettingsTab.tsx` — replace 1 native select, remove `.settings-select` usage
- `InterfaceSettingsTab.tsx` — replace 1 native select

### Cleanup

- Remove `.settings-select` styles from `MessagesSettingsTab.css`
- `select.brmble-input` / `.select-wrapper` styles in `index.css` can be removed if no native selects remain

## Affected Selects

| # | File | Value | Options | Disabled | Notes |
|---|------|-------|---------|----------|-------|
| 1 | AudioSettingsTab | `inputDevice` | Static (1) | No | |
| 2 | AudioSettingsTab | `outputDevice` | Static (1) | No | |
| 3 | AudioSettingsTab | `transmissionMode` | Static (3) | No | |
| 4 | ConnectionSettingsTab | `autoConnectServerId` | Hybrid (1 static + dynamic) | Yes | Wrapped in Tooltip |
| 5 | MessagesSettingsTab | `ttsVoice` | Hybrid (1 static + dynamic) | No | Conditionally rendered |
| 6 | InterfaceSettingsTab | `theme` | Fully dynamic | No | |
