# Sidebar Channel Right-Click Context Menu — Design Spec

## 1. Trigger & Placement
- Context menu appears on right-click (or context menu keyboard shortcut) on any non-root voice channel in the sidebar.
- Placement, animation, and dismissal logic match the existing user right-click menu.

## 2. Menu Content & Layout
- Menu items:
  - Always: **Join**
  - Admin-only (with separator): **Edit**, **Add Subchannel**, **Remove**, **Listen to channel**
- “Add Subchannel” and “Edit” currently show placeholder popups with a close button.
- Visual separator is shown between “Join” and admin actions.
- No icons, text only—matching the user menu.

## 3. Action Handling & Confirmation
- **Join** and **Listen to channel**: perform action immediately.
- **Edit**: placeholder Brmble-styled popup.
- **Add Subchannel**: placeholder Brmble-styled popup.
- **Remove**: Brmble-styled popup requiring typing “Remove” before the confirm button enables. Modal is styled per Brmble standards.
- Only admins see admin actions.

## 4. Architecture & Extensibility
- Shared context menu component is used for both user and channel menus, parameterized for each context.
- Menu item config and permissions logic built into channel context menu trigger.
- Brmble-styled confirmation/placeholder modals for all relevant actions.
- Future roles (moderator, etc.) and new actions supported with minor config extensions.

## 5. Explicit constraints
- Menu is never shown on the root channel.
- Extensible for more prompts, role types, or additional options.
- (Add Subchannel/Edit are placeholders until those features are ready for implementation.)
