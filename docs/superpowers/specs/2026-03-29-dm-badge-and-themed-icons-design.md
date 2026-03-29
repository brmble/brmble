# DM Badge Fix & Theme-Aware Native Icons

**Date:** 2026-03-29
**Issues:** #403 (DM badge count), #342 (Lemon Drop rename)
**Branch:** `fix/dm-badge-count-contacts`

## Summary

Three problems to fix:

1. The DM button badge shows total unread messages instead of the number of contacts with unreads.
2. The system tray icon switches from the real Brmble logo to a programmatic green circle when there are unreads.
3. The taskbar overlay shows a redundant Brmble logo on top of the Brmble logo.

Additionally, native icons should follow the user's selected theme, and the "Lemon Drop Martini" display name should be shortened to "Lemon Drop".

## Change 1: DM Badge Count

**Problem:** `useUnreadTracker.ts` sums `notificationCount` across all DM rooms. If Alice has 3 unreads and Bob has 2, the badge shows "5". It should show "2".

**Fix (useUnreadTracker.ts, ~line 503):**
Change `totalDmUnreadCount += state.notificationCount` to `totalDmUnreadCount += state.notificationCount > 0 ? 1 : 0`.

**Fix (App.tsx, ~line 422):**
The `totalDmUnreadCount` useMemo also adds Mumble ephemeral contact unreads. Change `total += contact.unreadCount` to `total += contact.unreadCount > 0 ? 1 : 0`.

**No other changes.** The badge rendering in `UserPanel.tsx` (9+ cap, animation) stays the same. Per-contact badges in `DMContactList.tsx` stay the same. The bridge still sends a boolean to C#.

## Change 2: Theme-Aware System Tray Icon

**Problem:** `_iconNormal` loads the real `Resources/brmble.ico` but `_iconNormalBadge` draws a programmatic green circle with a red dot. They look completely different.

**Fix:**

### 2a. Theme bridge message

The frontend sends a `notification.theme` message via the bridge:
- On app init (after theme is loaded from localStorage and applied)
- Whenever the user changes theme via the settings UI

This is implemented as a `useEffect` in `App.tsx` that watches the current theme ID and calls `bridge.send('notification.theme', { theme: currentThemeId })`.

Payload: `{ theme: "aperol-spritz" }`

The C# handler in `Program.cs` receives this and calls `TrayIcon.SetTheme(themeName)` and `TaskbarBadge.SetTheme(themeName)`.

### 2b. TrayIcon loads theme-specific .ico

`TrayIcon.SetTheme(string themeName)`:
1. Loads `Resources/{themeName}/brmble.ico` at 16x16 via `LoadImage`. Falls back to `Resources/brmble.ico` if the theme folder or .ico doesn't exist (handles `clean` theme which has no folder).
2. Sets `_iconNormal` to this loaded icon.
3. Creates `_iconNormalBadge` by reading the pixels of the loaded .ico and drawing the accent-color dot on top (same position and size as the current red dot: center (11,2), radius 2).
4. Muted and deafened variants remain programmatic colored circles (yellow/red) -- these are state indicators, not branding.
5. Calls `UpdateIconAndTooltip()` to apply immediately.

### 2c. Theme-to-accent-color map

C# needs a hardcoded map from theme name to accent RGB for the badge dot:

| Theme ID | Accent RGB | Hex |
|---|---|---|
| `classic` | (212, 20, 90) | `#d4145a` |
| `clean` | (212, 20, 90) | `#d4145a` |
| `blue-lagoon` | (0, 180, 216) | `#00b4d8` |
| `cosmopolitan` | (230, 57, 98) | `#e63962` |
| `aperol-spritz` | (232, 101, 26) | `#e8651a` |
| `midori-sour` | (0, 200, 83) | `#00c853` |
| `lemon-drop` | (245, 197, 24) | `#f5c518` |
| `retro-terminal` | (51, 255, 0) | `#33ff00` |

Default (unknown theme): fall back to `classic` accent `(212, 20, 90)`.

## Change 3: Taskbar Overlay

**Problem:** The overlay icon is the Brmble .ico itself. This shows a small Brmble logo on top of the main Brmble taskbar icon -- redundant and confusing.

**Fix:** Replace `LoadBrmbleOverlayIcon()` with `CreateAccentDotIcon()` that draws a small filled circle (12x12 or 16x16) in the theme's accent color. Same color map as above. When theme changes, regenerate the overlay icon.

`TaskbarBadge.SetTheme(string themeName)`:
1. Look up accent RGB from the theme map.
2. Create a new overlay icon: a small filled circle in that color with anti-aliased edges.
3. Store as `_badgeIcon`.
4. If badge is currently shown, re-apply via `SetOverlayIcon` to update the color immediately.

## Change 4: Theme-Aware Taskbar Icon

**Problem:** The main taskbar icon always shows the root `Resources/brmble.ico` regardless of theme.

**Fix:** When `notification.theme` is received, also update the main window icon:

1. Load `Resources/{themeName}/brmble.ico` at 16x16 (ICON_SMALL) and 32x32 (ICON_BIG).
2. Send `WM_SETICON` with both `ICON_SMALL` and `ICON_BIG` to the main window handle.
3. Fall back to `Resources/brmble.ico` if the theme folder doesn't exist.

This logic lives in `Program.cs` alongside the existing `notification.theme` handler, or in a small helper method on `Win32Window`.

## Change 5: Rename "Lemon Drop Martini" to "Lemon Drop" (#342)

**Files to change:**
- `src/Brmble.Web/src/themes/theme-registry.ts` line 47: `name: 'Lemon Drop Martini'` -> `name: 'Lemon Drop'`
- `src/Brmble.Web/src/themes/lemon-drop.css` line 2: update CSS comment
- `src/Brmble.Web/src/themes/lemon-drop.css` line 4: update CSS comment
- `src/Brmble.Web/src/themes/_template.css`: update comments referencing "Lemon Drop Martini" (lines ~620, ~697, ~701, ~728)

No folder rename needed -- the folder is already `lemon-drop`. No ID change needed.

## Data Flow

```
Frontend (theme change or init)
  |
  |--> bridge.send('notification.theme', { theme: 'aperol-spritz' })
  |
  v
Program.cs handler
  |
  |--> TrayIcon.SetTheme('aperol-spritz')
  |      |-> Load Resources/aperol-spritz/brmble.ico (16x16)
  |      |-> Set _iconNormal = loaded .ico
  |      |-> Create _iconNormalBadge = loaded .ico + accent dot overlay
  |      |-> UpdateIconAndTooltip()
  |
  |--> TaskbarBadge.SetTheme('aperol-spritz')
  |      |-> Create _badgeIcon = accent-colored dot
  |      |-> If badge active, re-apply overlay
  |
  |--> Win32Window.SetIcon(hwnd, 'aperol-spritz')
         |-> Load 16x16 + 32x32 from Resources/aperol-spritz/brmble.ico
         |-> SendMessage(WM_SETICON, ICON_SMALL, ...)
         |-> SendMessage(WM_SETICON, ICON_BIG, ...)
```

## Files Modified

| File | Change |
|---|---|
| `src/Brmble.Web/src/hooks/useUnreadTracker.ts` | Count contacts instead of summing messages |
| `src/Brmble.Web/src/App.tsx` | Count ephemeral contacts instead of summing unreads; send `notification.theme` on init and theme change |
| `src/Brmble.Client/Program.cs` | Add `notification.theme` bridge handler |
| `src/Brmble.Client/TrayIcon.cs` | Add `SetTheme()`, load theme .ico, draw themed badge dot on real icon |
| `src/Brmble.Client/TaskbarBadge.cs` | Add `SetTheme()`, replace logo overlay with accent dot |
| `src/Brmble.Client/Win32Window.cs` | Add `SetIcon()` helper for WM_SETICON |
| `src/Brmble.Web/src/themes/theme-registry.ts` | Rename "Lemon Drop Martini" to "Lemon Drop" |
| `src/Brmble.Web/src/themes/lemon-drop.css` | Update comments |
| `src/Brmble.Web/src/themes/_template.css` | Update comments |

## Out of Scope

- Per-contact badges in `DMContactList.tsx` -- already correct
- Numeric counts in tray/taskbar -- staying boolean
- Muted/deafened tray icon variants -- staying as programmatic colored circles
- `clean` theme .ico -- falls back to root `Resources/brmble.ico` (no dedicated folder)
