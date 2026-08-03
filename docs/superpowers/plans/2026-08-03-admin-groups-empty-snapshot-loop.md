# Admin Groups Empty-Snapshot Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the admin groups editor from repeatedly hydrating state while the ACL snapshot is unavailable.

**Architecture:** Keep stable empty array identities at module scope in `AdminGroupsSection.tsx`. Extend the existing focused Vitest suite so its mocked refresh transitions from a null snapshot to a real snapshot and verifies the component hydrates without repeatedly refreshing.

**Tech Stack:** React, TypeScript, Vitest, Testing Library.

## Global Constraints

- Touch only `AdminGroupsSection.tsx` and its focused test, plus this plan/spec documentation.
- Preserve existing draft hydration and local-edit behavior for non-null snapshots.
- Do not modify unrelated working-tree changes.

---

### Task 1: Add the empty-snapshot regression test

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

- [x] **Step 1: Add a test whose mocked refresh supplies the snapshot**

Configure `refreshSpy` to assign `aclAdminState.snapshot = createSnapshot()` and rerender the view. Start from `snapshot: null`, render the component, and assert `refreshSpy` is called once and `@Officers` appears after the refresh-driven rerender.

- [x] **Step 2: Run the focused test before changing production code**

Run: `npm run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

Expected: the new test fails because the current fallback arrays retrigger the hydration effect and the refresh mock is invoked repeatedly.

### Task 2: Stabilize the empty fallback arrays

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx`

- [x] **Step 1: Define stable empty arrays at module scope**

Add typed module-level constants for empty groups and ACLs, then replace `snapshot?.groups ?? []` and `snapshot?.acls ?? []` with those constants. Do not alter the hook or effect conditions.

- [x] **Step 2: Run the focused test after the minimal fix**

Run: `npm run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

Expected: all tests in the file pass, including the new empty-snapshot transition test.

### Task 3: Verify the changed frontend

**Files:**
- Verify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx`
- Verify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

- [x] **Step 1: Run type-check**

Run: `npm run type-check`

Expected: exit code 0 with no TypeScript errors.

- [x] **Step 2: Run the frontend build**

Run: `npm run build`

Expected: exit code 0 with a successful Vite production build.

- [x] **Step 3: Inspect the final diff**

Run: `git diff -- src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

Expected: only stable fallback constants and the focused regression test are changed.
