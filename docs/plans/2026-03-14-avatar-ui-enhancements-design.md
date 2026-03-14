# Avatar UI Enhancements Design

Issues: #273, #278, #279

## Overview

Three related avatar improvements that enhance the profile settings layout, add a dedicated avatar editor modal, and introduce rich user tooltips with enlarged avatars and comments.

## Issue #273: Upload/Remove Button Repositioning

**Current state:** Upload and Remove buttons sit below the avatar info block in ProfileSettingsTab, inconsistent with the Export/Import button layout elsewhere in settings.

**Change:** Keep the 80px hero avatar and display name on the left. Use flexbox to push the Upload and Remove buttons to the right side of the `.profile-avatar-section`, stacked vertically.

**Files changed:**
- `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx` — wrap buttons in a right-aligned container
- `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.css` — flexbox layout for avatar section

## Issue #278: Dedicated Avatar Editor Modal

**Current state:** Clicking the header avatar opens the Settings modal (same as gear button). Two buttons do the same thing.

**Change:** Create a new `AvatarEditorModal` component. The header avatar click opens this modal instead of settings. Add "Edit Avatar" to self right-click context menus. Disable the header avatar button when disconnected.

**New component:** `AvatarEditorModal`
- Location: `src/Brmble.Web/src/components/AvatarEditorModal/`
- Shows current avatar at ~120px with display name
- Upload button triggers the existing `AvatarUpload` crop/zoom flow
- Remove button removes the avatar
- Standard modal pattern (glass-panel, overlay, focus trap, Escape to close)
- Designed as a foundation for future #274 enhancements (zoom, background, border)

**Wiring changes:**
- `App.tsx`: New `showAvatarEditor` state; `onAvatarClick` opens AvatarEditorModal instead of settings
- `Sidebar.tsx` and `ChannelTree.tsx`: Add "Edit Avatar" context menu item for self users
- `UserPanel.tsx`: Disable avatar button when not connected (visual + functional)

## Issue #279: Rich User Tooltip with Enlarged Avatar + Comment

**Current state:** Hovering over users in channel tree and sidebar shows simple text-only tooltips. Comments exist in the User type and are editable in UserInfoDialog, but not surfaced in hover UI.

**Change:** Create a `UserTooltip` component that shows a 64px avatar, username, and comment preview on hover. Replace simple text tooltips on user rows.

**New component:** `UserTooltip`
- Location: `src/Brmble.Web/src/components/UserTooltip/`
- 64px Avatar + bold username + comment (truncated to ~2 lines)
- Glass-panel card aesthetic, consistent with existing tooltip styling
- Comment editing stays in UserInfoDialog (no changes needed)

**Integration:**
- `ChannelTree.tsx`: Replace `<Tooltip content={user.name}>` on user rows with `<UserTooltip user={user}>`
- `Sidebar.tsx`: Same replacement on root user rows

## Component Dependencies

```
AvatarEditorModal
├── Avatar (existing, 120px)
├── AvatarUpload (existing, reused as-is)
└── Standard modal pattern (glass-panel, focus trap)

UserTooltip
├── Avatar (existing, 64px)
└── Tooltip positioning logic
```

## Design Decisions

1. **Keep hero avatar in settings** — The 80px avatar in ProfileSettingsTab stays; only button positions change.
2. **Reuse AvatarUpload** — The crop/zoom flow is mature; the new modal wraps it rather than rebuilding it.
3. **Comment editing stays in UserInfoDialog** — No duplication of editing UI; tooltip is read-only.
4. **Disabled state for disconnected** — Header avatar button gets opacity reduction and no-op click when disconnected.
