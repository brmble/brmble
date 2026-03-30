# Watch Stream Context Menu Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Watch Stream" as the first option in the user right-click context menu, appearing only when the user is currently sharing their screen.

**Architecture:** Single task adding a conditional menu item to the existing user context menu in ChannelTree.tsx.

**Tech Stack:** React, TypeScript

---

### Task 1: Add Watch Stream Menu Item

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx:427-464`

- [ ] **Step 1: Add Watch Stream item to context menu items**

Find the context menu items array (starts around line 431). Add the Watch Stream item as the **first item** in the array, before Direct Message. The item should only appear when `contextMenu.userId` matches `sharingUserSession`.

Insert this code block at the beginning of the items array (around line 432):

```tsx
...(contextMenu.userId === String(sharingUserSession) ? [{
  type: 'item' as const,
  label: 'Watch Stream',
  icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  onClick: () => {
    const channelId = contextMenu.channelId ?? currentChannelId;
    onWatchScreenShare?.(`channel-${channelId}`);
  },
}] : []),
```

- [ ] **Step 2: Test the implementation**

1. Start the dev server: `cd src/Brmble.Web && npm run dev`
2. Start the client: `dotnet run --project src/Brmble.Client`
3. Right-click on a user who is not sharing - "Watch Stream" should not appear
4. Have a user start screen sharing
5. Right-click on the sharing user - "Watch Stream" should appear
6. Click "Watch Stream" - should open their screen share

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git commit -m "feat: add Watch Stream to user context menu"
```
