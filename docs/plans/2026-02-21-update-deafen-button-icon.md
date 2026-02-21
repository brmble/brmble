# Update Top Bar Deafen Button Icon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the top bar deafen button's two SVG icons with the headset-style icons used in the channel tree, so both panels use the same visual language.

**Architecture:** Single file change in `UserPanel.tsx`. The deafen button has two SVG states — deafened (slash) and not deafened (no slash). Both are replaced with the headset-with-ear-cups shape from `ChannelTree.tsx`, scaled to 18×18. The not-deafened state shows the headset without the slash; the deafened/leftVoice state shows the headset with the diagonal slash line.

**Tech Stack:** React, TypeScript, Vite (`npm run build` to verify)

---

### Task 1: Replace deafen button SVGs in UserPanel.tsx

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx:44-56`

**Step 1: Replace both SVG blocks in the deafen button**

The current deafen button block (lines 37–58) contains two SVGs. Replace only the two SVG elements (lines 44–55) — keep the button wrapper, className, onClick, disabled, and title unchanged.

**Deafened / leftVoice state** (the `{(deafened || leftVoice) ? (` branch) — headset with slash:

```tsx
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <line x1="1" y1="1" x2="23" y2="23"></line>
  <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"></path>
  <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
</svg>
```

**Not deafened state** (the `: (` branch) — headset without slash:

```tsx
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"></path>
  <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
</svg>
```

The full resulting button block should look like:

```tsx
{onToggleDeaf && (
  <button 
    className={`user-panel-btn deaf-btn ${(deafened || leftVoice) ? 'active' : ''} ${leftVoice ? 'disabled' : ''}`}
    onClick={onToggleDeaf}
    disabled={leftVoice}
    title={deafened ? 'Undeafen' : 'Deafen'}
  >
    {(deafened || leftVoice) ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"></path>
        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"></path>
        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
      </svg>
    )}
  </button>
)}
```

**Step 2: Build to verify no errors**

```bash
cd src/Brmble.Web && npm run build
```
Expected: `✓ built in ~Xms` with no errors.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/UserPanel/UserPanel.tsx
git commit -m "fix: replace deafen button icons with headset style matching channel tree"
```
