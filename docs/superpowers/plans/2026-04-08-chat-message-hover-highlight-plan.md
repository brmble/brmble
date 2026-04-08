# Chat Message Hover Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subtle background highlight to chat messages on hover, similar to Discord's message hover behavior.

**Architecture:** Single CSS rule change using existing `--bg-hover` token for theme compatibility.

**Tech Stack:** CSS (no React changes needed)

---

### Task 1: Add hover highlight to message bubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`

- [ ] **Step 1: Add hover rule to CSS**

After line 6 (closing brace of `.message-bubble`), add:

```css
.message-bubble:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 2: Verify syntax is correct**

Run: `npm run lint` in `src/Brmble.Web`
Expected: No CSS errors

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.css
git commit -m "feat: add hover highlight to chat messages"
```
