# Hardcoded CSS Token Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all hardcoded font-size, border-radius, color, and font-family values in component CSS with design tokens, closing issue #198.

**Architecture:** Add one new global token (`--text-2xs`), then sweep every component CSS file replacing hardcoded values with the nearest token. Update `docs/UI_GUIDE.md` to document the new token. No JS changes, no layout changes.

**Tech Stack:** CSS custom properties, Vite dev server for visual QA

---

## Token Snap Mapping (reference)

### Font-size → token

| Hardcoded value(s) | Token | Token value |
|---|---|---|
| `0.5625rem` (9px), `0.625rem` (10px), `10px`, `11px` | `--text-2xs` | `0.625rem` (10px) — **NEW** |
| `0.6875rem` (11px), `0.75rem` (12px), `12px` | `--text-xs` | `0.75rem` (12px) |
| `0.8rem`, `0.8125rem` (13px), `0.85rem`, `0.875rem` (14px), `0.9rem`, `14px` | `--text-sm` | `0.875rem` (14px) |
| `0.9375rem` (15px), `1rem` (16px) | `--text-base` | `1rem` (16px) |
| `1.125rem` (18px) | `--text-lg` | `1.125rem` (18px) |
| `1.25rem` (20px), `1.35rem` (21.6px) | `--text-xl` | `1.25rem` (20px) |
| `1.5rem` (24px) | `--text-2xl` | `1.5rem` (24px) |
| `1.75rem` (28px) | `--heading-title-size` | `1.75rem` (28px) |
| `2.5rem` (40px), `3rem` (48px) | `--text-4xl` | `2.5rem` (40px) |

### Non-font-size fixes (issue #198)

| File | Line | Type | Hardcoded | Token |
|---|---|---|---|---|
| `index.css` | 112 | radius | `4px` | `var(--radius-xs)` |
| `index.css` | 340 | radius | `24px` | `var(--radius-full)` |
| `ChannelTree.css` | 174 | radius | `50%` | `var(--radius-full)` |
| `CertWizard.css` | 160 | font | `monospace` | `var(--font-mono)` |
| `index.css` | 260 | color | `#ffffff` | Needs design decision (see Task 8) |

---

## Task 1: Add `--text-2xs` token and update docs

**Files:**
- Modify: `src/Brmble.Web/src/index.css:12-20`
- Modify: `docs/UI_GUIDE.md:39`

**Step 1: Add the token to index.css**

In `index.css`, insert `--text-2xs` before `--text-xs`:

```css
  /* Font Size Scale */
  --text-2xs: 0.625rem;   /* 10px */
  --text-xs: 0.75rem;     /* 12px */
```

**Step 2: Update UI_GUIDE.md token table**

Change line 39 from:
```
| Font sizes | `--text-xs` through `--text-4xl` | 12px - 40px (8 tokens) |
```
to:
```
| Font sizes | `--text-2xs` through `--text-4xl` | 10px - 40px (9 tokens) |
```

**Step 3: Commit**

```
git add src/Brmble.Web/src/index.css docs/UI_GUIDE.md
git commit -m "feat: add --text-2xs token (10px) to font-size scale"
```

---

## Task 2: Migrate font-sizes in Sidebar components

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`

**Step 1: Sidebar.css replacements**

| Line | From | To |
|---|---|---|
| 11 | `font-size: 1.25rem` | `font-size: var(--text-xl)` |
| 18 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 64 | `font-size: 0.6875rem` | `font-size: var(--text-xs)` |
| 71 | `font-size: 0.75rem` | `font-size: var(--text-xs)` |
| 149 | `font-size: 0.6875rem` | `font-size: var(--text-xs)` |
| 169 | `font-size: 0.5625rem` | `font-size: var(--text-2xs)` |
| 226 | `font-size: 0.8rem` | `font-size: var(--text-sm)` |
| 239 | `font-size: 0.5625rem` | `font-size: var(--text-2xs)` |
| 279 | `font-size: 0.5625rem` | `font-size: var(--text-2xs)` |

**Step 2: ChannelTree.css replacements**

| Line | From | To |
|---|---|---|
| 2 | `font-size: 14px` | `font-size: var(--text-sm)` |
| 64 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |
| 72 | `font-size: 0.6875rem` | `font-size: var(--text-xs)` |
| 86 | `font-size: 0.625rem` | `font-size: var(--text-2xs)` |
| 154 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 162 | `font-size: 0.625rem` | `font-size: var(--text-2xs)` |

**Step 3: Commit**

```
git commit -m "fix: replace hardcoded font-sizes in Sidebar with tokens"
```

---

## Task 3: Migrate font-sizes in ServerList

**Files:**
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.css`

**Step 1: Replacements**

| Line | From | To |
|---|---|---|
| 60 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |
| 113 | `font-size: 1.25rem` | `font-size: var(--text-xl)` |
| 130 | `font-size: 1.125rem` | `font-size: var(--text-lg)` |
| 139 | `font-size: 0.75rem` | `font-size: var(--text-xs)` |
| 153 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 158 | `font-size: 0.75rem` | `font-size: var(--text-xs)` |
| 165 | `font-size: 1.25rem` | `font-size: var(--text-xl)` |
| 174 | `font-size: 3rem` | `font-size: var(--text-4xl)` |
| 182 | `font-size: 1rem` | `font-size: var(--text-base)` |
| 188 | `font-size: 0.875rem !important` | `font-size: var(--text-sm) !important` |
| 267 | `font-size: 1.25rem` | `font-size: var(--text-xl)` |

**Step 2: Commit**

```
git commit -m "fix: replace hardcoded font-sizes in ServerList with tokens"
```

---

## Task 4: Migrate font-sizes in CertWizard

**Files:**
- Modify: `src/Brmble.Web/src/components/CertWizard/CertWizard.css`

**Step 1: Replacements**

| Line | From | To |
|---|---|---|
| 37 | `font-size: 2.5rem` | `font-size: var(--text-4xl)` |
| 46 | `font-size: 0.9rem` | `font-size: var(--text-sm)` |
| 58 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |
| 65 | `font-size: 1rem` | `font-size: var(--text-base)` |
| 88 | `font-size: 0.85rem` | `font-size: var(--text-sm)` |
| 120 | `font-size: 1.5rem` | `font-size: var(--text-2xl)` |
| 124 | `font-size: 0.9rem` | `font-size: var(--text-sm)` |
| 130 | `font-size: 0.775rem` | `font-size: var(--text-xs)` |
| 146 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |
| 161 | `font-size: 0.75rem` | `font-size: var(--text-xs)` |

**Step 2: Commit**

```
git commit -m "fix: replace hardcoded font-sizes in CertWizard with tokens"
```

---

## Task 5: Migrate font-sizes in UserInfoDialog and UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/UserInfoDialog/UserInfoDialog.css`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: UserInfoDialog.css replacements**

| Line | From | To |
|---|---|---|
| 47 | `font-size: 1.35rem` | `font-size: var(--text-xl)` |
| 56 | `font-size: 0.7rem` | `font-size: var(--text-xs)` |
| 83 | `font-size: 0.9rem` | `font-size: var(--text-sm)` |
| 111 | `font-size: 0.8rem` | `font-size: var(--text-sm)` |
| 117 | `font-size: 0.85rem` | `font-size: var(--text-sm)` |
| 137 | `font-size: 0.85rem` | `font-size: var(--text-sm)` |
| 166 | `font-size: 0.85rem` | `font-size: var(--text-sm)` |
| 214 | `font-size: 0.7rem` | `font-size: var(--text-xs)` |
| 235 | `font-size: 0.8rem` | `font-size: var(--text-sm)` |

**Step 2: UserPanel.css replacements**

| Line | From | To |
|---|---|---|
| 31 | `font-size: 0.625rem` | `font-size: var(--text-2xs)` |

**Step 3: Commit**

```
git commit -m "fix: replace hardcoded font-sizes in UserInfoDialog and UserPanel with tokens"
```

---

## Task 6: Migrate font-sizes in ChatPanel components

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.css`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`

**Step 1: ChatPanel.css replacements**

| Line | From | To |
|---|---|---|
| 58 | `font-size: 1.25rem` | `font-size: var(--text-xl)` |
| 75 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 113 | `font-size: 0.75rem` | `font-size: var(--text-xs)` |

**Step 2: MessageInput.css replacements**

| Line | From | To |
|---|---|---|
| 29 | `font-size: 0.9375rem` | `font-size: var(--text-base)` |

**Step 3: MessageBubble.css replacements**

| Line | From | To |
|---|---|---|
| 30 | `font-size: 1rem` | `font-size: var(--text-base)` |
| 53 | `font-size: 0.9375rem` | `font-size: var(--text-base)` |
| 62 | `font-size: 0.6875rem` | `font-size: var(--text-xs)` |
| 68 | `font-size: 0.9375rem` | `font-size: var(--text-base)` |

**Step 4: Commit**

```
git commit -m "fix: replace hardcoded font-sizes in ChatPanel with tokens"
```

---

## Task 7: Migrate font-sizes in remaining components

**Files:**
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ConnectionSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/ConnectModal/ConnectModal.css`
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.css`
- Modify: `src/Brmble.Web/src/components/Header/Header.css`
- Modify: `src/Brmble.Web/src/components/Version/Version.css`
- Modify: `src/Brmble.Web/src/App.css`
- Modify: `src/Brmble.Web/src/index.css` (line 240, `.btn-sm`)

**Step 1: DMContactList.css**

| Line | From | To |
|---|---|---|
| 46 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 61 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 102 | `font-size: 0.75rem` | `font-size: var(--text-xs)` |
| 125 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 132 | `font-size: 0.6875rem` | `font-size: var(--text-xs)` |
| 138 | `font-size: 0.75rem` | `font-size: var(--text-xs)` |
| 151 | `font-size: 0.625rem` | `font-size: var(--text-2xs)` |

**Step 2: SettingsModal.css**

| Line | From | To |
|---|---|---|
| 28 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 82 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |
| 87 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |

**Step 3: ShortcutsSettingsTab.css**

| Line | From | To |
|---|---|---|
| 3 | `font-size: 12px` | `font-size: var(--text-xs)` |
| 42 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |

**Step 4: MessagesSettingsTab.css**

| Line | From | To |
|---|---|---|
| 10 | `font-size: 14px` | `font-size: var(--text-sm)` |

**Step 5: AudioSettingsTab.css**

| Line | From | To |
|---|---|---|
| 38 | `font-size: 12px` | `font-size: var(--text-xs)` |

**Step 6: ConnectionSettingsTab.css**

| Line | From | To |
|---|---|---|
| 3 | `font-size: 12px` | `font-size: var(--text-xs)` |
| 16 | `font-size: 10px` | `font-size: var(--text-2xs)` |
| 32 | `font-size: 12px` | `font-size: var(--text-xs)` |
| 49 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |

**Step 7: ConnectModal.css**

| Line | From | To |
|---|---|---|
| 61 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |
| 83 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |

**Step 8: ContextMenu.css**

| Line | From | To |
|---|---|---|
| 24 | `font-size: 0.8125rem` | `font-size: var(--text-sm)` |

**Step 9: Header.css**

| Line | From | To |
|---|---|---|
| 23 | `font-size: 1.75rem` | `font-size: var(--heading-title-size)` |

**Step 10: Version.css**

| Line | From | To |
|---|---|---|
| 5 | `font-size: 11px` | `font-size: var(--text-2xs)` |

**Step 11: App.css**

| Line | From | To |
|---|---|---|
| 39 | `font-size: 0.875rem` | `font-size: var(--text-sm)` |
| 98 | `font-size: 1.125rem` | `font-size: var(--text-lg)` |

**Step 12: index.css `.btn-sm`**

| Line | From | To |
|---|---|---|
| 240 | `font-size: 0.6875rem` | `font-size: var(--text-xs)` |

**Step 13: Commit**

```
git commit -m "fix: replace hardcoded font-sizes in remaining components with tokens"
```

---

## Task 8: Fix non-font-size hardcoded values (issue #198)

**Files:**
- Modify: `src/Brmble.Web/src/index.css` (lines 112, 340)
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css` (line 174)
- Modify: `src/Brmble.Web/src/components/CertWizard/CertWizard.css` (line 160)

**Step 1: index.css — scrollbar thumb radius**

Line 112: `border-radius: 4px` → `border-radius: var(--radius-xs)`

**Step 2: index.css — toggle slider radius**

Line 340: `border-radius: 24px` → `border-radius: var(--radius-full)`

**Step 3: ChannelTree.css — badge circle**

Line 174: `border-radius: 50%` → `border-radius: var(--radius-full)`

**Step 4: CertWizard.css — monospace font**

Line 160: `font-family: monospace` → `font-family: var(--font-mono)`

**Step 5: Commit**

```
git commit -m "fix: replace remaining hardcoded radii and font-family with tokens"
```

> **Note on `#ffffff` (index.css:260):** This is the text color on `.btn-primary` over `--accent-primary` backgrounds. No existing token maps to "white text on accent." Leave this as-is for now; a `--text-on-accent` token can be added in a separate design decision.

---

## Task 9: Build and verify

**Step 1: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

Expected: build succeeds with no errors.

**Step 2: Verify no remaining hardcoded font-sizes in components**

Search all component CSS files for `font-size:` not using `var(--`:

```bash
rg "font-size:" --include="*.css" src/Brmble.Web/src/components/ | rg -v "var\(--"
```

Expected: zero results.

**Step 3: Verify no remaining px-based font-sizes anywhere**

```bash
rg "font-size:\s*\d+px" --include="*.css" src/Brmble.Web/src/
```

Expected: zero results.

---

## Task 10: Final commit and cleanup

**Step 1: Verify all changes are committed**

```bash
git status
```

**Step 2: If any unstaged changes remain, commit them**

```bash
git add -A && git commit -m "fix: final cleanup for hardcoded CSS token migration"
```
