# Chat UI Improvements Design

**Date:** 2026-03-15
**Branch:** `feature/chat-ui-improvements-263-286-287-288`
**Issues:** #263, #286, #287, #288

## Overview

Four related chat UI improvements that reduce visual noise, fix a z-index bug, and add a polished scrolling indicator to sticky date dividers.

---

## Issue #286: Remove Chat Message Hover Highlight

### Problem
The background highlight on message hover adds visual noise and makes the chat feel cluttered.

### Solution
Remove `background: var(--bg-hover-light)` from `.message-bubble:hover` in `MessageBubble.css`. Keep the hover-triggered timestamp reveal on collapsed messages (`.message-bubble--collapsed:hover .message-hover-time { opacity: 1 }`).

### Files Changed
- `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css` — remove hover background rule

### Not Changed
- Search active match highlighting (`search-active-match`) stays as-is (it's a search indicator, not a hover effect)
- Timestamp reveal on hover stays

---

## Issue #287: Increase Chat Avatar Size to 48px

### Problem
The 40px avatar is undersized relative to the username + first message line height.

### Solution
Increase avatar from 40px to 48px. Update all related width/min-width values to keep alignment.

### Changes
- `MessageBubble.tsx` — change `<Avatar size={40}>` to `<Avatar size={48}>`
- `MessageBubble.css`:
  - `.message-avatar` width/min-width: `40px` -> `48px`
  - `.message-gutter` width/min-width: `40px` -> `48px`

---

## Issue #288: Redesign Sticky Date Divider with Cascading Dots

### Problem
The sticky date divider uses a distinct background color and box-shadow that stands out too much when scrolling.

### Solution
Two parts:

**Part 1 — Visual redesign:**
- Remove the distinct `background-color: var(--bg-primary)` and `box-shadow` from `.is-stuck` state
- Make the stuck divider look identical to normal inline date dividers (transparent background, line-and-label style)

**Part 2 — Cascading dot indicator:**
Add a vertical dot indicator below the sticky header that communicates "there are more messages above from this day."

**Dot behavior:**
- When stuck with 3+ messages above: show 3 dots
- When 2 messages remain above: show 2 dots
- When 1 message remains above: show 1 dot
- When 0 remain (unsticks): no dots, normal inline divider

**Visual spec:**
```
[ ── March 15, 2026 ── ]    <- sticky, transparent bg
            ·
            ·
            ·
[message A            3:42 PM]
[message B            3:45 PM]
```

Dots: 4-5px diameter circles, `var(--text-tertiary)` color, centered horizontally, `var(--space-xs)` (6px) vertical spacing between dots.

**Implementation approach: IntersectionObserver-based counting**

For each date section, observe the messages near the section start. Track how many messages are above the viewport within that section. Derive the dot count as `min(hiddenCount, 3)`.

This fits the existing IntersectionObserver pattern already used for sticky detection. The observer watches message elements within each date group and counts how many have scrolled above the container's top edge.

**Dot animation:** Dots fade out (opacity transition, `var(--transition-fast)`) when "eaten" as messages scroll into view.

### Files Changed
- `ChatPanel.tsx` — add message visibility tracking per section, render dot indicator
- `ChatPanel.css` — remove `.is-stuck` background/shadow, add dot indicator styles

---

## Issue #263: Sticky Date Divider Hides Unread Divider

### Problem
The sticky date header (z-index: 2, with opaque background) covers the "New Messages" unread divider when auto-scrolling to the unread position.

### Solution
Largely resolved by #288's redesign (transparent sticky header). Additionally:

1. **Z-index fix:** Give `.chat-unread-divider` z-index: 3 (above sticky header's z-index: 2)
2. **Scroll offset:** Adjust the scroll-to-unread logic to account for the sticky header height, so the unread divider appears below the sticky header rather than behind it

### Files Changed
- `ChatPanel.css` — add `z-index: 3; position: relative;` to `.chat-unread-divider`
- `ChatPanel.tsx` — adjust `scrollIntoView` offset for unread divider to account for sticky header height

---

## Interaction Between Issues

- #288 (transparent sticky header) directly helps #263 (unread divider visibility)
- #286 (remove hover highlight) and #287 (avatar size) are independent
- All four changes touch `MessageBubble.css` or `ChatPanel.css`/`.tsx` so they should be implemented on the same branch to avoid conflicts

## Implementation Order

1. #286 (simplest, CSS-only)
2. #287 (small, component + CSS)
3. #288 (most complex, requires new observer logic + CSS)
4. #263 (builds on #288, CSS + scroll offset tweak)
