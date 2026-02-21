# Swap Deaf/Muted Icon Order in Channel and Connected Panels

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Swap the muted and deafened status icon order in ChannelTree and Sidebar user rows from `[muted][deaf][mic]` to `[deaf][muted][mic]`, matching the top bar button order.

**Architecture:** Pure DOM order swap in two render files. No logic, no CSS, no prop changes. The SVG blocks are moved — deaf before muted — in both `ChannelTree.tsx` and `Sidebar.tsx`.

**Tech Stack:** React, TypeScript, Vite (`npm run build` to verify)

---

### Task 1: Swap icon order in ChannelTree.tsx

**Files:**
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx:189-205`

**Step 1: Replace the `<span className="user-status">` icon block**

Replace lines 189–205 with the icons in `[deaf][muted][mic]` order:

```tsx
<span className="user-status">
  <svg className={`status-icon status-icon--deaf${user.deafened ? '' : ' status-icon--hidden'}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
  </svg>
  <svg className={`status-icon status-icon--muted${user.muted ? '' : ' status-icon--hidden'}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
  </svg>
  <svg className="status-icon status-icon--mic" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
</span>
```

**Step 2: Build to verify no errors**

```bash
cd src/Brmble.Web && npm run build
```
Expected: `✓ built in ~Xms` with no errors.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChannelTree.tsx
git commit -m "fix: swap deaf/muted icon order in channel tree user rows"
```

---

### Task 2: Swap icon order in Sidebar.tsx

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:124-141`

**Step 1: Replace the `<span className="root-user-status">` icon block**

Replace lines 124–141 with the icons in `[deaf][muted][mic]` order:

```tsx
<span className="root-user-status">
  <svg className={`status-icon status-icon--deaf${user.deafened ? '' : ' status-icon--hidden'}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
    <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
  </svg>
  <svg className={`status-icon status-icon--muted${user.muted ? '' : ' status-icon--hidden'}`} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
  </svg>
  <svg className="status-icon status-icon--mic" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
</span>
```

**Step 2: Build to verify no errors**

```bash
cd src/Brmble.Web && npm run build
```
Expected: `✓ built in ~Xms` with no errors.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx
git commit -m "fix: swap deaf/muted icon order in connected panel user rows"
```
