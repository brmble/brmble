# Channel Password Reconnect Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use saved channel passwords only through Mumble `Authenticate.tokens` by reconnecting after prompt/edit password changes.

**Architecture:** Keep native persistence via `voice.saveChannelPassword`. Remove same-session temporary password joins from the frontend flow and trigger the existing reconnect path after saving/removing a password. Update prompt copy and tests to communicate “Save and reconnect”.

**Tech Stack:** React + TypeScript frontend, existing bridge messages, Vitest + Testing Library.

---

### Task 1: Add Failing Frontend Tests

**Files:**
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Test join prompt reconnect behavior**

Assert a password entered from the join prompt sends `voice.saveChannelPassword`, then `voice.reconnect`, and does not send `voice.joinChannel` with a password.

- [ ] **Step 2: Test prompt copy**

Assert join prompt confirm label is `Save and reconnect` and message mentions reconnecting to authenticate the password.

- [ ] **Step 3: Test Edit Saved Password copy and reconnect**

Assert Edit Saved Password uses confirm label `Save and reconnect` and sends `voice.reconnect` after save/remove.

- [ ] **Step 4: Run focused tests for red**

Run:

```powershell
npm test -- src/App.screenShareStart.test.ts src/components/Sidebar/ChannelTree.test.tsx
```

Expected: failures because current code still sends password joins and does not reconnect.

### Task 2: Implement Save-And-Reconnect Flow

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

- [ ] **Step 1: Remove same-session token reuse from App**

Remove same-session password cache logic and do not pass entered passwords to `voice.joinChannel`.

- [ ] **Step 2: Add reconnect helper**

After `voice.saveChannelPassword`, send `voice.reconnect`.

- [ ] **Step 3: Update prompt copy**

Use message text that includes `Save the password and reconnect to authenticate it.` and confirm label `Save and reconnect`.

- [ ] **Step 4: Update ChannelTree saved-password prompt**

Use the same confirm label and reconnect after saving/removing saved password.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- src/App.screenShareStart.test.ts src/components/Sidebar/ChannelTree.test.tsx src/App.chatMode.test.ts src/utils/channelPasswords.test.ts
```

Expected: pass.

### Task 3: Verify And Commit

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
- Create: `docs/superpowers/plans/2026-05-23-channel-password-reconnect-authentication.md`

- [ ] **Step 1: Build frontend**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Commit relevant files only**

Run:

```powershell
git add -- "src/Brmble.Web/src/App.tsx" "src/Brmble.Web/src/App.screenShareStart.test.ts" "src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx" "src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx" "docs/superpowers/plans/2026-05-23-channel-password-reconnect-authentication.md"
git commit -m "fix: reconnect for channel password auth"
```

Expected: commit created; unrelated untracked files remain untouched.

---

## Self-Review

- Spec coverage: covers prompt save, edit saved password save/remove, reconnect, copy, and removing same-session password joins.
- Placeholder scan: no placeholder steps remain.
- Type consistency: uses existing bridge messages and test files.
