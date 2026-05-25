# Hide ACL Password Prefix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never show the internal Mumble `#` token selector prefix in admin-facing channel password inputs.

**Architecture:** Keep native ACL storage unchanged: Brmble writes password ACL token groups as `#password`. Normalize only the frontend parser that extracts the managed password for the Edit Channel dialog, so UI input values are always user-facing plain passwords.

**Tech Stack:** React + TypeScript + Vitest frontend.

---

## File Map

- `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`: contains `getManagedPasswordFromAclBody`, the frontend ACL snapshot parser that feeds `EditChannelDialog.initialPassword`.
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`: contains the admin Edit Channel regression test for managed password loading.

## Task 1: Add frontend regression test

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Add a test case for stripping the internal `#` selector**

Add this assertion to the existing `loads the managed password for edit and does not rewrite it when unchanged` test, or add a focused test with the same setup:

```ts
expect(editChannelDialogPropsRef.current?.initialPassword).toBe('secret-token');
```

Use ACL input containing:

```ts
{ applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret-token', allow: 0, deny: 0 }
```

- [ ] **Step 2: Run test to verify red**

Run:

```powershell
npm test -- src/components/Sidebar/ChannelTree.test.tsx -t "managed password"
```

Expected: FAIL because the frontend parser returns `#secret-token` instead of `secret-token`.

## Task 2: Normalize frontend managed password parsing

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

- [ ] **Step 1: Strip marker prefix and one leading `#`**

In `getManagedPasswordFromAclBody`, after extracting the selector from the marker group, return the selector without a leading `#`:

```ts
const selector = group.slice('__brmble_password_marker__:'.length);
return selector.startsWith('#') ? selector.slice(1) : selector;
```

- [ ] **Step 2: Run focused test to verify green**

Run:

```powershell
npm test -- src/components/Sidebar/ChannelTree.test.tsx -t "managed password"
```

Expected: PASS.

## Task 3: Verify related UI tests

**Files:**
- No edits unless tests fail.

- [ ] **Step 1: Run ChannelTree tests**

Run:

```powershell
npm test -- src/components/Sidebar/ChannelTree.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Build frontend**

Run:

```powershell
npm run build
```

Expected: PASS.
