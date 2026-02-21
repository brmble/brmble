# Deafen Disables Mute Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the user is deafened, disable and visually activate the mute button in the top bar, mirroring the existing `leftVoice` pattern.

**Architecture:** Pure rendering change in `UserPanel.tsx`. The `deafened` prop is already available. No state, no backend, no new props needed. The mute button's `disabled` attribute, CSS classes, icon, and title all gain `|| deafened` conditions identical to how `leftVoice` already works.

**Tech Stack:** React, TypeScript, Vite (`npm run build` to verify)

---

### Task 1: Update mute button rendering in UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx:60-81`

**Step 1: Apply the four condition changes to the mute button**

Replace the mute button block (lines 60–81) so that every condition that checks `leftVoice` also checks `deafened`:

```tsx
{onToggleMute && (
  <button 
    className={`user-panel-btn mute-btn ${(muted || leftVoice || deafened) ? 'active' : ''} ${(leftVoice || deafened) ? 'disabled' : ''}`}
    onClick={onToggleMute}
    disabled={leftVoice || deafened}
    title={muted || deafened ? 'Unmute' : 'Mute'}
  >
    {(muted || leftVoice || deafened) ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
    )}
  </button>
)}
```

Changes summary:
- `className active`: `muted || leftVoice` → `muted || leftVoice || deafened`
- `className disabled`: `leftVoice` → `leftVoice || deafened`
- `disabled` attr: `leftVoice` → `leftVoice || deafened`
- `title`: `muted ? 'Unmute' : 'Mute'` → `muted || deafened ? 'Unmute' : 'Mute'`
- Slashed icon condition: `muted || leftVoice` → `muted || leftVoice || deafened`

**Step 2: Build to verify no TypeScript or Vite errors**

```bash
cd src/Brmble.Web && npm run build
```
Expected: `✓ built in ~Xms` with no errors.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/UserPanel/UserPanel.tsx
git commit -m "fix: disable and activate mute button when deafened"
```
