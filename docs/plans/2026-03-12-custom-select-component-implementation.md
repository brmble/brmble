# Custom Select Component Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all 6 native `<select>` elements in settings tabs with a custom `<Select>` component that renders a portal-based dropdown matching the existing ContextMenu visual language.

**Architecture:** A controlled `<Select>` component with a trigger button styled like `.brmble-input` and a `createPortal`-rendered dropdown listbox. Uses `document mousedown` + Escape for dismissal, `getBoundingClientRect()` for positioning, and viewport-aware flip logic. Full ARIA combobox/listbox semantics with keyboard navigation.

**Tech Stack:** React 18, TypeScript, CSS custom properties (theme tokens from `index.css` / `_template.css`)

**Design doc:** `docs/plans/2026-03-12-custom-select-component-design.md`

---

### Task 1: Create the Select component (CSS)

**Files:**
- Create: `src/Brmble.Web/src/components/Select/Select.css`

**Step 1: Write the CSS file**

```css
/* Custom Select component — mirrors ContextMenu visual language */

.brmble-select {
  position: relative;
  display: inline-block;
}

.brmble-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  padding: 0.5rem var(--space-sm);
  padding-right: 2rem;
  font-family: var(--font-body);
  font-size: var(--text-sm);
  transition: all var(--transition-fast);
  outline: none;
  cursor: pointer;
  min-width: 150px;
  text-align: left;
  width: 100%;
}

.brmble-select-trigger:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary-glow);
}

.brmble-select-trigger:hover:not(:disabled) {
  border-color: var(--accent-primary);
}

.brmble-select-trigger:disabled {
  opacity: 0.5;
  pointer-events: none;
  cursor: not-allowed;
}

.brmble-select-trigger--open {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary-glow);
}

/* Arrow indicator */
.brmble-select::after {
  content: '';
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 5px solid var(--text-secondary);
  pointer-events: none;
  transition: transform var(--transition-fast);
}

.brmble-select--open::after {
  transform: translateY(-50%) rotate(180deg);
}

/* Placeholder text */
.brmble-select-placeholder {
  color: var(--text-muted);
}

/* Dropdown panel */
.brmble-select-dropdown {
  position: fixed;
  z-index: 1000;
  background: var(--bg-primary);
  border: var(--glass-border);
  border-radius: var(--radius-md);
  padding: 0.375rem;
  box-shadow: var(--shadow-elevated);
  animation: popIn var(--animation-fast) ease backwards;
  max-height: 240px;
  overflow-y: auto;
}

/* Option items */
.brmble-select-option {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  background: none;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brmble-select-option:hover,
.brmble-select-option--highlighted {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.brmble-select-option--selected {
  background: var(--bg-surface-active);
  color: var(--text-primary);
}

.brmble-select-option--selected:hover,
.brmble-select-option--selected.brmble-select-option--highlighted {
  background: var(--bg-surface-active);
  color: var(--text-primary);
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/Select/Select.css
git commit -m "feat: add Select component CSS with theme tokens"
```

---

### Task 2: Create the Select component (TSX)

**Files:**
- Create: `src/Brmble.Web/src/components/Select/Select.tsx`
- Create: `src/Brmble.Web/src/components/Select/index.ts`

**Step 1: Write the component**

Key implementation notes for the engineer:
- Use `createPortal(dropdown, document.body)` so dropdown escapes overflow-hidden containers
- Position dropdown using `triggerRef.current.getBoundingClientRect()` in a `useEffect` that runs when `isOpen` changes
- Flip above trigger if dropdown would overflow viewport bottom (compare `triggerRect.bottom + dropdownHeight > window.innerHeight`)
- Match dropdown width to trigger width
- `document.addEventListener('mousedown', handleClickOutside)` for click-outside dismissal (same pattern as `ContextMenu.tsx:28-42`)
- `document.addEventListener('keydown', handleKeyDown)` for Escape + arrow navigation
- Use `useId()` for unique ARIA `id` linking
- Track `highlightedIndex` in state for keyboard nav; scroll highlighted option into view via `scrollIntoView({ block: 'nearest' })`
- Type-ahead: on keypress, find first option starting with that character (case-insensitive)

```tsx
import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import './Select.css';

export interface SelectOption {
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

export function Select({ value, onChange, options, disabled, className, placeholder }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const listboxId = useId();
  const triggerId = useId();

  const selectedOption = options.find(o => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? '';
  const isPlaceholder = !selectedOption && !!placeholder;

  // Position dropdown relative to trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !dropdownRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const dropdownRect = dropdownRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom - 8;
    const spaceAbove = triggerRect.top - 8;
    const fitsBelow = spaceBelow >= Math.min(dropdownRect.height, 240);

    setDropdownStyle({
      left: triggerRect.left,
      width: triggerRect.width,
      ...(fitsBelow
        ? { top: triggerRect.bottom + 4 }
        : { top: triggerRect.top - dropdownRect.height - 4 }),
    });
  }, []);

  // Open/close handlers
  const open = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    const idx = options.findIndex(o => o.value === value);
    setHighlightedIndex(idx >= 0 ? idx : 0);
  }, [disabled, options, value]);

  const close = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const selectOption = useCallback((optionValue: string) => {
    onChange(optionValue);
    close();
  }, [onChange, close]);

  // Position on open and on scroll/resize
  useEffect(() => {
    if (!isOpen) return;
    // Defer to allow dropdown to render and measure
    requestAnimationFrame(updatePosition);

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, highlightedIndex]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          close();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex(i => (i + 1) % options.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex(i => (i - 1 + options.length) % options.length);
          break;
        case 'Home':
          e.preventDefault();
          setHighlightedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setHighlightedIndex(options.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < options.length) {
            selectOption(options[highlightedIndex].value);
          }
          break;
        default:
          // Type-ahead: jump to first option starting with pressed character
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            const char = e.key.toLowerCase();
            const idx = options.findIndex(o => o.label.toLowerCase().startsWith(char));
            if (idx >= 0) setHighlightedIndex(idx);
          }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex, options, close, selectOption]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      open();
    }
  };

  const activeDescendant = isOpen && highlightedIndex >= 0
    ? `${listboxId}-option-${highlightedIndex}`
    : undefined;

  return (
    <div className={`brmble-select${isOpen ? ' brmble-select--open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        className={`brmble-select-trigger${isOpen ? ' brmble-select-trigger--open' : ''}`}
        disabled={disabled}
        onClick={() => isOpen ? close() : open()}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={isPlaceholder ? 'brmble-select-placeholder' : undefined}>
          {displayLabel}
        </span>
      </button>

      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={triggerId}
          className="brmble-select-dropdown"
          style={dropdownStyle}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;
            let cls = 'brmble-select-option';
            if (isSelected) cls += ' brmble-select-option--selected';
            if (isHighlighted) cls += ' brmble-select-option--highlighted';
            return (
              <button
                key={option.value}
                ref={el => { optionRefs.current[index] = el; }}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cls}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
```

**Step 2: Write the barrel export**

```ts
export { Select } from './Select';
export type { SelectOption } from './Select';
```

**Step 3: Build and verify no compile errors**

Run: `npm run build` (from `src/Brmble.Web`)
Expected: Build succeeds (component is not imported anywhere yet)

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Select/
git commit -m "feat: add custom Select component with portal dropdown and keyboard nav"
```

---

### Task 3: Migrate AudioSettingsTab (3 selects)

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`

**Step 1: Replace the 3 native selects**

Add import at top:
```tsx
import { Select } from '../Select';
```

Replace **Input Device** (lines 149-157):
```tsx
<div className="settings-item">
  <label>Input Device</label>
  <Select
    value={localSettings.inputDevice}
    onChange={(v) => handleChange('inputDevice', v)}
    options={[{ value: 'default', label: 'Default' }]}
  />
</div>
```

Replace **Output Device** (lines 186-197):
```tsx
<div className="settings-item">
  <label>Output Device</label>
  <Select
    value={localSettings.outputDevice}
    onChange={(v) => handleChange('outputDevice', v)}
    options={[{ value: 'default', label: 'Default' }]}
  />
</div>
```

Replace **Transmission Mode** (lines 214-227):
```tsx
<div className="settings-item">
  <label>Transmission Mode</label>
  <Select
    value={localSettings.transmissionMode}
    onChange={(v) => handleChange('transmissionMode', v as TransmissionMode)}
    options={[
      { value: 'pushToTalk', label: 'Push to Talk' },
      { value: 'voiceActivity', label: 'Voice Activity' },
      { value: 'continuous', label: 'Continuous' },
    ]}
  />
</div>
```

Note: Remove the `<div className="select-wrapper">` wrappers — the `<Select>` component handles its own wrapping.

**Step 2: Build and verify**

Run: `npm run build` (from `src/Brmble.Web`)
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat: migrate AudioSettingsTab to custom Select component"
```

---

### Task 4: Migrate ConnectionSettingsTab (1 select with disabled + Tooltip)

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx`

**Step 1: Replace the native select**

Add import at top:
```tsx
import { Select } from '../Select';
```

Replace the `handleServerChange` function (lines 31-34) — it currently expects `React.ChangeEvent<HTMLSelectElement>`, change to accept a plain string:
```tsx
const handleServerChange = (value: string) => {
  onChange({ ...settings, autoConnectServerId: value === '' ? null : value });
};
```

Replace the select JSX (lines 72-91):
```tsx
<div className="server-dropdown-row">
  <label>Connect to</label>
  <Tooltip content={tooltipText}>
    <Select
      value={settings.autoConnectServerId ?? ''}
      onChange={handleServerChange}
      disabled={!settings.autoConnectEnabled}
      options={[
        { value: '', label: 'Last connected server' },
        ...servers.map(s => ({ value: s.id, label: s.label })),
      ]}
    />
  </Tooltip>
</div>
```

Note: The `<div className="select-wrapper">` and `<div className="select-tooltip-target">` wrappers are removed. The `<Select>` component's root `<div>` serves as the Tooltip's child element directly.

**Step 2: Build and verify**

Run: `npm run build` (from `src/Brmble.Web`)
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.tsx
git commit -m "feat: migrate ConnectionSettingsTab to custom Select component"
```

---

### Task 5: Migrate MessagesSettingsTab (1 select)

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.css`

**Step 1: Replace the native select**

Add import at top of `MessagesSettingsTab.tsx`:
```tsx
import { Select } from '../Select';
```

Replace the TTS Voice select JSX (lines 114-128):
```tsx
<div className="settings-item">
  <label>TTS Voice</label>
  <Select
    value={localSettings.ttsVoice}
    onChange={(v) => handleChange('ttsVoice', v)}
    options={[
      { value: '', label: 'Default' },
      ...voices.map(voice => ({ value: voice.name, label: voice.name })),
    ]}
  />
</div>
```

**Step 2: Remove `.settings-select` styles from `MessagesSettingsTab.css`**

Delete lines 3-17 (the `.settings-select` and `.settings-select:focus` rules). If those are the only styles in the file, delete the entire file contents and leave just the comment or remove the CSS import from the TSX.

**Step 3: Build and verify**

Run: `npm run build` (from `src/Brmble.Web`)
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.css
git commit -m "feat: migrate MessagesSettingsTab to custom Select, remove .settings-select"
```

---

### Task 6: Migrate InterfaceSettingsTab (1 select)

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`

**Step 1: Replace the native select**

Add import at top:
```tsx
import { Select } from '../Select';
```

Replace the theme select JSX (lines 42-55):
```tsx
<div className="settings-item">
  <label>Aesthetic</label>
  <Select
    value={localAppearance.theme}
    onChange={handleThemeChange}
    options={themes.map(t => ({ value: t.id, label: t.name }))}
  />
</div>
```

Note: Remove the `<div className="select-wrapper">` wrapper.

**Step 2: Build and verify**

Run: `npm run build` (from `src/Brmble.Web`)
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx
git commit -m "feat: migrate InterfaceSettingsTab to custom Select component"
```

---

### Task 7: Clean up old native select styles

**Files:**
- Modify: `src/Brmble.Web/src/index.css`

**Step 1: Remove unused native select styles**

Remove the following from `index.css` (lines 400-439):
- `select.brmble-input` rule (lines 400-407)
- `select.brmble-input + .select-arrow` comment block (lines 409-414)
- `.select-wrapper` rule (lines 416-420)
- `.select-wrapper::after` rule (lines 422-434)
- `select.brmble-input option` rule (lines 436-439)

Keep `.brmble-input` and `.brmble-input:focus` (lines 383-398) — those are still used by text inputs and range inputs.

**Step 2: Verify no remaining references to `select-wrapper` or `select.brmble-input`**

Search for `select-wrapper` and `select.brmble-input` across the codebase. If any remain, do not remove the styles.

**Step 3: Build and run tests**

Run: `npm run build` (from `src/Brmble.Web`)
Run: `dotnet test` (from repo root)
Expected: Both pass

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/index.css
git commit -m "refactor: remove unused native select styles from index.css"
```

---

### Task 8: Visual verification

**Step 1: Run the app in dev mode**

```bash
cd src/Brmble.Web && npm run dev
# In another terminal:
dotnet run --project src/Brmble.Client
```

**Step 2: Verify each select in the settings modal**

Open Settings (gear icon). For each tab, verify:

- **Audio tab**: Input Device, Output Device, Transmission Mode dropdowns open, display options, close on click-outside/Escape, keyboard nav works
- **Connection tab**: Auto-Connect server dropdown works when enabled, is disabled (grayed) when toggle is off, Tooltip still appears on hover
- **Messages tab**: TTS Voice dropdown appears when TTS is enabled, lists voices, selects correctly
- **Interface tab**: Aesthetic/theme dropdown lists themes, switching themes applies immediately

**Step 3: Test with Classic and Retro Terminal themes**

Switch between themes and verify the dropdown panel adapts (border-radius should be near-zero in Retro Terminal, rounded in Classic).

**Step 4: Test edge cases**

- Open a dropdown near the bottom of the settings modal — verify it flips above the trigger
- Keyboard: Tab to a select, press ArrowDown to open, arrow through options, Enter to select
- Type a letter while dropdown is open — verify type-ahead jumps to matching option

---

## Summary of all commits

1. `feat: add Select component CSS with theme tokens`
2. `feat: add custom Select component with portal dropdown and keyboard nav`
3. `feat: migrate AudioSettingsTab to custom Select component`
4. `feat: migrate ConnectionSettingsTab to custom Select component`
5. `feat: migrate MessagesSettingsTab to custom Select, remove .settings-select`
6. `feat: migrate InterfaceSettingsTab to custom Select component`
7. `refactor: remove unused native select styles from index.css`
