# Notification Badge Design

## Overview
Add a small red dot badge overlaid on the tray icon when the user has unread direct messages or a pending stream invite.

## Architecture
1. **TrayIcon.cs** - Add `UpdateBadge(bool hasUnreadDMs, bool hasPendingInvite)` method that regenerates the icon with an embedded badge pixel when state changes
2. **NativeBridge.cs** - Register handler for `notification.badge` messages from frontend

## Badge Rendering
- Darker red circle (~4px diameter) drawn in top-right corner of the 16x16 icon
- Position: x=11, y=2 (slight overlap with main icon)
- Badge drawn after main circle so it overlays
- Color: RGB(180, 30, 30) - darker red for good contrast against green/yellow icons

## Icon State Matrix

| Muted | Deafened | Badge | Icon Color | Tooltip |
|-------|----------|-------|------------|---------|
| ✗ | ✗ | ✗ | Green | "Brmble" |
| ✗ | ✗ | ✓ | Green | "Brmble (Unread)" |
| ✓ | ✗ | ✗ | Yellow | "Brmble (Muted)" |
| ✓ | ✗ | ✓ | Yellow | "Brmble (Muted, Unread)" |
| ✗ | ✓ | ✗ | Berry Red | "Brmble (Deafened)" |
| ✗ | ✓ | ✓ | Berry Red | "Brmble (Deafened, Unread)" |

## Bridge Protocol
- **Frontend → C#**: `notification.badge` message with `{ unreadDMs: boolean, pendingInvite: boolean }`
- TrayIcon exposes `UpdateBadge(unreadDMs || pendingInvite)` 
- TrayIcon exposes public method that NativeBridge handler calls

## Implementation Notes
- Badge state stored as boolean in TrayIcon
- Icon regeneration happens in `UpdateState()` - check badge state when regenerating
- Combine badge state with mute/deafen state for final icon selection
- No layout shift - badge embedded in existing 16x16 icon dimensions
