# Notification Dot Design

## Overview

Add a small blue notification dot to the system tray icon that appears when the user has unread messages (DMs, group messages) or stream invites.

## Background

The system tray icon currently shows three states based on mute/deafen status:
- Green circle: Normal
- Yellow circle: Muted
- Red circle: Deafened

We need to extend this to also indicate when there are unread notifications.

## Design

### Icon Variants

Add 3 new icon variants with a blue dot overlay in the top-right corner:
- Normal + notification (green circle with blue dot)
- Muted + notification (yellow circle with blue dot)  
- Deafened + notification (red circle with blue dot)

Total: 6 icon variants

### Color Palette

- Normal icon: Green (#00C850)
- Muted icon: Yellow/Amber (#E8B000)
- Deafened icon: Berry Red (#D4145A)
- Notification dot: Blue (#2196F3) - standard notification color

### API

Add a public method to TrayIcon class:

```csharp
public static void SetNotification(bool hasNotification)
```

This method:
- Takes a boolean indicating whether to show/hide the notification dot
- Updates the current icon to the notification variant if true, or regular variant if false
- Persists the notification state so it combines correctly with mute/deafen state

### Integration

The JavaScript frontend will call this method via the existing C# ↔ JavaScript bridge when:
- A new direct message is received
- A new group/channel message is received
- A stream invite is received

The frontend is responsible for tracking notification state and clearing it when the user views the notifications.

## State Matrix

| Muted | Deafened | Notification | Icon |
|-------|----------|--------------|------|
| No    | No       | No           | Green circle |
| No    | No       | Yes          | Green circle + blue dot |
| Yes   | No       | No           | Yellow circle |
| Yes   | No       | Yes          | Yellow circle + blue dot |
| No    | Yes      | No           | Red circle |
| No    | Yes      | Yes          | Red circle + blue dot |

## Acceptance Criteria

1. Tray icon shows notification dot when `SetNotification(true)` is called
2. Notification dot appears in top-right corner of icon
3. Notification dot is clearly visible (blue) against all icon backgrounds
4. `SetNotification(false)` removes the notification dot
5. Notification state correctly combines with mute/deafen state (6 variants)
6. JavaScript bridge can trigger notification state change
