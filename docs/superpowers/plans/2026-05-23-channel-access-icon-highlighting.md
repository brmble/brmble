# Channel Access Icon Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight channel access icons only when they represent blocked access.

**Architecture:** Keep icon selection in `ChannelTree.tsx` and add a semantic modifier class for blocked access. Keep visual styling in `ChannelTree.css` using existing theme tokens.

**Tech Stack:** React + TypeScript + CSS tokens, Vitest + Testing Library.

---

### Task 1: Add Failing Tests For Highlight Semantics

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Write tests**

Add assertions that:

```tsx
expect(row?.querySelector('.channel-access-icon--blocked [data-icon="lock"]')).not.toBeNull();
expect(row?.querySelector('.channel-access-icon--blocked [data-icon="key-round"]')).not.toBeNull();
expect(row?.querySelector('.channel-access-icon--blocked [data-icon="unlock"]')).toBeNull();
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm test -- src/components/Sidebar/ChannelTree.test.tsx
```

Expected: new blocked class assertions fail.

### Task 2: Implement Highlight Class And Styling

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`

- [ ] **Step 1: Add blocked-access condition**

In `renderChannel`, compute blocked access as:

```tsx
const isAccessBlocked = lockIconName !== null && channel.canEnter !== true;
```

- [ ] **Step 2: Add class to icon wrapper**

Apply:

```tsx
className={`channel-access-icon${isAccessBlocked ? ' channel-access-icon--blocked' : ''}`}
```

- [ ] **Step 3: Add tokenized CSS**

Add:

```css
.channel-access-icon--blocked {
  color: var(--accent-danger);
  filter: drop-shadow(0 0 var(--glow-sm) var(--accent-danger));
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- src/components/Sidebar/ChannelTree.test.tsx
```

Expected: pass.

### Task 3: Verify And Commit

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
- Create: `docs/superpowers/plans/2026-05-23-channel-access-icon-highlighting.md`

- [ ] **Step 1: Build frontend**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Commit relevant files only**

Run:

```powershell
git add -- "src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx" "src/Brmble.Web/src/components/Sidebar/ChannelTree.css" "src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx" "docs/superpowers/plans/2026-05-23-channel-access-icon-highlighting.md"
git commit -m "fix: highlight blocked channel access icons"
```

Expected: commit created on `feature/channel-password-context-menu`; unrelated untracked files remain untouched.

---

## Self-Review

- Spec coverage: covers locked lock, unlocked lock, password locked, and password accessible states.
- Placeholder scan: no placeholder steps remain.
- Type consistency: uses existing `ChannelTree` classes and test structure.
