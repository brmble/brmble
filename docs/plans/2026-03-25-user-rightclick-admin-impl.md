# User Right-Click Admin Features Implementation Plan

> Note for contributors: Implement the following tasks incrementally; each task can be a separate pull request.

**Goal:** Add admin submenu and Mute/Unmute toggle to user right-click context menus in the channel panel.

**Architecture:** Extend ContextMenu component to support nested submenus, restructure context menus in ChannelTree and Sidebar to group admin actions under an "Admin ▶" submenu and combine Mute/Unmute into a single toggle item.

**Tech Stack:** React, TypeScript, CSS custom properties (UI tokens)

---

## Task 1: Add Submenu Support to ContextMenu Component

**Files:**
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx`
- Modify: `src/Brmble.Web/src/components/ContextMenu/ContextMenu.css`

**Step 1: Update ContextMenu TypeScript interface**

Modify `ContextMenuItem` interface to support nested items:

```typescript
interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  children?: ContextMenuItem[];
}
```

**Step 2: Update ContextMenu component for submenu support**

Add nested submenu rendering with hover-triggered dropdowns positioned to the right of parent item.

**Step 3: Update ContextMenu CSS for submenu styling**

Add styles for:
- `.context-menu-item--has-children` to show arrow indicator (▶)
- Nested `.context-submenu` positioned absolutely
- Hover states for submenu items
- Proper z-index layering

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx src/Brmble.Web/src/components/ContextMenu/ContextMenu.css
git commit -m "feat: add submenu support to ContextMenu component"
```

---

## Task 2: Restructure ChannelTree Context Menu

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

**Step 1: Update context menu items structure**

Replace flat admin actions with nested admin submenu:

```typescript
items={[
  ...(!contextMenu.isSelf && onStartDM ? [{
    label: 'Send Direct Message',
    icon: <DMIcon />,
    onClick: () => onStartDM(contextMenu.userId, contextMenu.userName),
  }] : []),
  {
    label: 'User Information',
    icon: <InfoIcon />,
    onClick: () => setInfoDialogUser({ userId, userName, isSelf }),
  },
  ...(contextMenu.isSelf && onEditAvatar ? [{
    label: 'Edit Profile',
    icon: <ProfileIcon />,
    onClick: onEditAvatar,
  }] : []),
  ...(!contextMenu.isSelf && currentChannelId ? [
    {
      label: 'Mute/Unmute',
      icon: <MuteIcon />,
      onClick: () => bridge.send('voice.mute', { session: userSession }),
    }
  ] : []),
  ...(!contextMenu.isSelf && currentChannelId && (hasPermission(currentChannelId, Permission.Kick) || hasPermission(currentChannelId, Permission.Ban) || hasPermission(currentChannelId, Permission.MuteDeafen)) ? [
    {
      label: 'Admin',
      children: [
        ...(hasPermission(currentChannelId, Permission.MuteDeafen) ? [
          {
            label: 'Priority Speaker',
            icon: <StarIcon />,
            onClick: () => bridge.send('voice.setPrioritySpeaker', { session: userSession, enabled: !user?.prioritySpeaker }),
          },
        ] : []),
        ...(hasPermission(currentChannelId, Permission.Move) ? [
          {
            label: 'Move to Root',
            icon: <ArrowIcon />,
            onClick: () => bridge.send('voice.moveUser', { session: userSession, channelId: 0 }),
          },
        ] : []),
        ...(hasPermission(currentChannelId, Permission.Kick) ? [
          {
            label: 'Kick User',
            icon: <KickIcon />,
            onClick: () => bridge.send('voice.kick', { session: userSession }),
          },
        ] : []),
        ...(currentChannelId === 0 && hasPermission(currentChannelId, Permission.Ban) ? [
          {
            label: 'Ban User',
            icon: <BanIcon />,
            onClick: () => bridge.send('voice.ban', { session: userSession }),
          },
        ] : []),
      ],
    },
  ] : []),
]}
```

**Step 2: Find user object to get mute state**

Add lookup to find the target user for state-aware toggle:

```typescript
const targetUser = users.find(u => u.session === parseInt(contextMenu.userId));
```

**Step 3: Update Mute/Unmute label dynamically**

```typescript
label: targetUser?.muted ? 'Unmute' : 'Mute',
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git commit -m "feat: restructure ChannelTree context menu with admin submenu"
```

---

## Task 3: Restructure Sidebar Root Users Context Menu

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`

**Step 1: Find user object for state-aware options**

After finding target user, update menu items similarly to ChannelTree.

**Step 2: Update context menu structure**

Apply same pattern: Mute/Unmute toggle + Admin submenu for root users.

**Step 3: Handle "Move to Root" for non-root channel users**

Users in channels (not root, channelId !== 0) can be moved to root via admin submenu.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx
git commit -m "feat: restructure Sidebar context menu with admin submenu"
```

---

## Task 4: Add Backend Voice Command for Move to Root

**Files:**
- Modify: `src/Brmble.Client/Bridge/NativeBridge.cs`
- Modify: `src/Brmble.Client/Services/Voice/VoiceService.cs` (or similar)

**Step 1: Add handler for `voice.moveUser`**

Handle the new bridge message with `channelId: 0` for root move.

**Step 2: Verify existing `voice.moveUser` or `voice.move` command**

Check if `onJoinChannel` or similar already handles channel moves. If so, `voice.moveUser` may already exist.

**Step 3: Test the move to root functionality**

Manual QA: Right-click a user in a channel → Admin → Move to Root should relocate user.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Bridge/NativeBridge.cs src/Brmble.Client/Services/Voice/
git commit -m "feat: add voice.moveUser bridge command for root moves"
```

---

## Task 5: Manual QA Verification

**Files:**
- None (QA task)

**Step 1: Test admin submenu visibility**

- Log in as regular user → Admin submenu should be hidden
- Log in as admin/moderator → Admin submenu should appear with ▶ indicator

**Step 2: Test Mute/Unmute toggle**

- Right-click muted user → label should show "Unmute"
- Right-click unmuted user → label should show "Mute"
- Click should toggle state correctly

**Step 3: Test admin actions**

- Move to Root: User should move from channel to root (channel 0)
- Kick: User should be disconnected from server
- Ban: User should be banned (only in root channel per design)
- Priority Speaker: Toggle should reflect current user state

**Step 4: Test keyboard navigation**

- Tab through menu items
- Enter to select
- Escape to close

**Step 5: Test theme compatibility**

- Verify menu renders correctly in Classic theme
- Verify menu renders correctly in Retro Terminal theme

---

## Task 6: Final Build Verification

**Step 1: Run lint/typecheck**

```bash
cd src/Brmble.Web && npm run typecheck
```

**Step 2: Run build**

```bash
cd src/Brmble.Web && npm run build
```

**Step 3: Verify no console errors**

Load app, open context menu, verify no React errors in console.

**Step 4: Commit any remaining changes**

```bash
git add -A && git commit -m "chore: complete user rightclick admin feature"
```
