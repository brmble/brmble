# Context Menu Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement context menu position flipping so menus flip above/to the left when there's no room below/to the right, matching Qt/Mumble behavior.

**Architecture:** Modify the existing ContextMenu.tsx useEffect that handles positioning to implement flip logic instead of clamping.

**Tech Stack:** React, TypeScript

---

### Task 1: Implement Position Flipping Logic

**Files:**
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx:126-134`

- [ ] **Step 1: Read the existing ContextMenu.tsx to understand current implementation**

Read: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx`
Focus on lines 126-134 where positioning is handled.

- [ ] **Step 2: Modify the positioning useEffect to implement flip logic**

Replace the existing positioning code (lines 126-134) with:

```typescript
useEffect(() => {
  if (menuRef.current) {
    const rect = menuRef.current.getBoundingClientRect();
    const menuWidth = rect.width;
    const menuHeight = rect.height;
    
    const spaceBelow = window.innerHeight - y - 8;
    const spaceRight = window.innerWidth - x - 8;
    const spaceAbove = y - 8;
    const spaceLeft = x - 8;
    
    let finalX = x;
    let finalY = y;
    
    if (menuHeight > spaceBelow && menuHeight <= spaceAbove) {
      finalY = y - menuHeight;
    } else if (menuHeight > spaceBelow && menuHeight > spaceAbove) {
      finalY = Math.max(8, spaceAbove);
    }
    
    if (menuWidth > spaceRight && menuWidth <= spaceLeft) {
      finalX = x - menuWidth;
    } else if (menuWidth > spaceRight && menuWidth > spaceLeft) {
      finalX = Math.max(8, spaceLeft);
    }
    
    menuRef.current.style.left = `${finalX}px`;
    menuRef.current.style.top = `${finalY}px`;
  }
}, [x, y]);
```

- [ ] **Step 3: Verify the change compiles**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build completes without errors

- [ ] **Step 4: Test the behavior manually**

1. Build the frontend: `cd src/Brmble.Web && npm run build`
2. Run the client: `dotnet run --project src/Brmble.Client`
3. Right-click a channel at the bottom of the sidebar → menu should flip to appear above
4. Right-click a channel at the far right edge → menu should flip to appear to the left
5. Right-click in the middle → menu appears below/right as normal

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx
git commit -m "feat: add context menu position flipping"
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-01-context-menu-flip-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
