# 2026-03-25-user-rightclick-admin-design.md

## Overview
This document details the design for expanding the user right-click context menu in the channel panel, focusing on adding configurable admin/moderator features, with strict compliance to UI visual standards (`UI_GUIDE.md`).

---

## 1. UI/UX Structure & User Interactions

- **Trigger:** Right-clicking a user in the channel (user) panel.
- **Menu options (for all users):**
    - Direct Message
    - User Info
    - Mute/Unmute (shows either, reflecting current user state)
- **Admin submenu (visible to admins/moderators only):**
    - Appears as an "Admin ▶" nested dropdown.
    - Contains:
        - Kick user
        - Ban user
        - Move to root (immediate shortcut; for other channels, drag-and-drop is used)
        - Priority Speaker (toggle, reflecting current state)

**Accessibility & Appearance:**
- All context menu logic and styling must follow `docs/UI_GUIDE.md` (tokens, spacing, interaction, themes).
- Keyboard and pointer navigation supported for all menu levels.
- The "Admin" menu is hidden entirely for users without privileges.

**Behavior Notes:**
- Drag-and-drop relocates a user to any channel; menu only provides shortcut to root.

---

## 2. Data Flow & Permissions Logic

- The context menu retrieves full user info and role for both the selected user and the current (acting) user.
- Only admins/moderators see the "Admin" section (hidden for everyone else).
- Mute/Unmute and Priority Speaker entries adapt to the current state of the selected user.
- Each menu action dispatches an event/command to the backend:
    - DM, Info: open local UI panels.
    - Mute, Priority: send state-update request.
    - Kick, Ban, Move to root: dispatch privileged commands.
- Any backend authorization or failure response will be surfaced to the acting user via standardized feedback UI (toast/dialog, per `UI_GUIDE.md`).

---

## 3. Testing, Compliance, Documentation

### Testing
- **Manual QA:**
    - Confirm all menu options appear correctly for each user role.
    - Validate all admin actions perform as intended and follow backend permissions.
    - Ensure all UI, visual tokens, and interaction states conform to `UI_GUIDE.md` (including dark/light themes).
    - Confirm drag-and-drop works for all channel moves except root, which uses menu.
- **Automated/unit:**
    - Unit and integration tests for menu visibility and dispatch/action logic, with stubs/mocks for backend events/permissions.

### Documentation
- Ensure code comments and user-facing docs reference and follow `UI_GUIDE.md`.
- Document role-based access in both UI code and relevant markdown/help sections.

---

## 4. Future Extensions
- Declarative or dynamic menu schema could be explored if additional conditional options or roles emerge in the future.

---

*Design agreed and frozen on 2026-03-25. See chat history for context/rationale.*
