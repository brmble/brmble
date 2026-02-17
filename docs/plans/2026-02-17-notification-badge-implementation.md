# Notification Badge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a small red dot badge overlaid on the tray icon when the user has unread direct messages or a pending stream invite.

**Architecture:** Badge embedded in icon pixel data at render time. Frontend sends `notification.badge` message to C#, which updates TrayIcon state.

**Tech Stack:** C# Win32, Shell_NotifyIcon, NativeBridge

---

### Task 1: Add badge state tracking to TrayIcon

**Files:**
- Modify: `src/Brmble.Client/TrayIcon.cs:84-90`

**Step 1: Add badge state field**

Add after line 89:
```csharp
private static bool _hasBadge;
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/TrayIcon.cs
git commit -m "feat: add badge state field to TrayIcon"
```

---

### Task 2: Add badge icon variants

**Files:**
- Modify: `src/Brmble.Client/TrayIcon.cs:170-175`

**Step 1: Add badge icon pointers**

Add after line 87:
```csharp
private static IntPtr _iconNormalBadge;
private static IntPtr _iconMutedBadge;
private static IntPtr _iconDeafenedBadge;
```

**Step 2: Modify CreateIcons to create badge variants**

Replace `CreateIcons()` method (lines 170-175):
```csharp
private static void CreateIcons()
{
    _iconNormal = CreateColoredIcon(0x00, 0xC8, 0x50);    // green
    _iconMuted = CreateColoredIcon(0xE8, 0xB0, 0x00);    // yellow/amber
    _iconDeafened = CreateColoredIcon(0xD4, 0x14, 0x5A); // berry red

    _iconNormalBadge = CreateColoredIconWithBadge(0x00, 0xC8, 0x50);
    _iconMutedBadge = CreateColoredIconWithBadge(0xE8, 0xB0, 0x00);
    _iconDeafenedBadge = CreateColoredIconWithBadge(0xD4, 0x14, 0x5A);
}
```

**Step 3: Add CreateColoredIconWithBadge method**

Add after `CreateColoredIcon` method (after line 210):
```csharp
private static IntPtr CreateColoredIconWithBadge(byte r, byte g, byte b)
{
    const int size = 16;
    var pixels = new byte[size * size * 4];

    for (int y = 0; y < size; y++)
    {
        for (int x = 0; x < size; x++)
        {
            var dx = x - 7.5;
            var dy = y - 7.5;
            var dist = Math.Sqrt(dx * dx + dy * dy);
            var idx = (y * size + x) * 4;

            if (dist <= 6.5)
            {
                pixels[idx + 0] = b;
                pixels[idx + 1] = g;
                pixels[idx + 2] = r;
                pixels[idx + 3] = 0xFF;
            }
            else if (dist <= 7.5)
            {
                var alpha = (byte)(255 * (7.5 - dist));
                pixels[idx + 0] = b;
                pixels[idx + 1] = g;
                pixels[idx + 2] = r;
                pixels[idx + 3] = alpha;
            }
        }
    }

    // Draw badge in top-right corner (darker red: RGB 180, 30, 30)
    DrawBadge(pixels, size, 180, 30, 30);

    return CreateIconFromArgb(size, pixels);
}

private static void DrawBadge(byte[] pixels, int size, byte r, byte g, byte b)
{
    const int badgeX = 11;
    const int badgeY = 2;
    const int badgeRadius = 2;

    for (int dy = -badgeRadius; dy <= badgeRadius; dy++)
    {
        for (int dx = -badgeRadius; dx <= badgeRadius; dx++)
        {
            if (dx * dx + dy * dy <= badgeRadius * badgeRadius)
            {
                var x = badgeX + dx;
                var y = badgeY + dy;
                if (x >= 0 && x < size && y >= 0 && y < size)
                {
                    var idx = (y * size + x) * 4;
                    pixels[idx + 0] = b;
                    pixels[idx + 1] = g;
                    pixels[idx + 2] = r;
                    pixels[idx + 3] = 0xFF;
                }
            }
        }
    }
}
```

**Step 4: Update Destroy to free badge icons**

Replace `Destroy()` method (lines 162-168):
```csharp
public static void Destroy()
{
    Shell_NotifyIcon(NIM_DELETE, ref _nid);
    if (_iconNormal != IntPtr.Zero) DestroyIcon(_iconNormal);
    if (_iconMuted != IntPtr.Zero) DestroyIcon(_iconMuted);
    if (_iconDeafened != IntPtr.Zero) DestroyIcon(_iconDeafened);
    if (_iconNormalBadge != IntPtr.Zero) DestroyIcon(_iconNormalBadge);
    if (_iconMutedBadge != IntPtr.Zero) DestroyIcon(_iconMutedBadge);
    if (_iconDeafenedBadge != IntPtr.Zero) DestroyIcon(_iconDeafenedBadge);
}
```

**Step 5: Commit**

```bash
git add src/Brmble.Client/TrayIcon.cs
git commit -m "feat: add badge icon variants with embedded red dot"
```

---

### Task 3: Add UpdateBadge method and integrate with UpdateState

**Files:**
- Modify: `src/Brmble.Client/TrayIcon.cs:112-138`

**Step 1: Modify UpdateState to use badge state**

Replace `UpdateState` method:
```csharp
public static void UpdateState(bool muted, bool deafened)
{
    _muted = muted;
    _deafened = deafened;

    UpdateIconAndTooltip();
}

public static void UpdateBadge(bool hasUnreadDMs, bool hasPendingInvite)
{
    _hasBadge = hasUnreadDMs || hasPendingInvite;
    UpdateIconAndTooltip();
}

private static void UpdateIconAndTooltip()
{
    var baseColor = _deafened ? " (Deafened)" : _muted ? " (Muted)" : "";
    var badgeSuffix = _hasBadge ? (baseColor.Length > 0 ? ", Unread" : " (Unread)") : "";
    _nid.szTip = "Brmble" + baseColor + badgeSuffix;

    if (_deafened)
    {
        _nid.hIcon = _hasBadge ? _iconDeafenedBadge : _iconDeafened;
    }
    else if (_muted)
    {
        _nid.hIcon = _hasBadge ? _iconMutedBadge : _iconMuted;
    }
    else
    {
        _nid.hIcon = _hasBadge ? _iconNormalBadge : _iconNormal;
    }

    _nid.uFlags = NIF_ICON | NIF_TIP;
    Shell_NotifyIcon(NIM_MODIFY, ref _nid);
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/TrayIcon.cs
git commit -m "feat: integrate badge state with UpdateState in TrayIcon"
```

---

### Task 4: Add bridge handler in Program.cs

**Files:**
- Modify: `src/Brmble.Client/Program.cs:106-150`

**Step 1: Add notification.badge handler**

Add after line 149 in `SetupBridgeHandlers`:
```csharp
_bridge.RegisterHandler("notification.badge", data =>
{
    var hasUnreadDMs = data.TryGetProperty("unreadDMs", out var u) && u.GetBoolean();
    var hasPendingInvite = data.TryGetProperty("pendingInvite", out var p) && p.GetBoolean();
    TrayIcon.UpdateBadge(hasUnreadDMs, hasPendingInvite);
    return Task.CompletedTask;
});
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: add notification.badge handler in bridge"
```

---

### Task 5: Build and verify

**Step 1: Build the project**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`

Expected: Build succeeds with no errors

**Step 2: Commit**

```bash
git add src/Brmble.Client/
git commit -m "feat: add notification badge to tray icon"
```
