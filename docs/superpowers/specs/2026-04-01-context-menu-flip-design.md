# Context Menu Position Flip Design

## Context

The context menu in the Brmble sidebar currently constrains itself to stay within the window bounds. When right-clicking a channel at the bottom of the list, the menu appears cut off because it cannot overflow outside the window.

The original Mumble client uses Qt's `QMenu::exec()`, which automatically flips the menu to appear above the cursor when there isn't enough room below. This is the expected behavior users are familiar with.

## Problem

Current implementation in `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx` (lines 126-134):

```javascript
const maxX = window.innerWidth - rect.width - 8;
const maxY = window.innerHeight - rect.height - 8;
if (x > maxX) menuRef.current.style.left = `${maxX}px`;
if (y > maxY) menuRef.current.style.top = `${maxY}px`;
```

This clamps the position to fit within the viewport, preventing the natural flip behavior users expect.

## Solution

Implement position flipping similar to Qt's default behavior:

1. **Calculate available space** in each direction from the cursor position
2. **Flip vertically** if there's not enough room below (show above cursor)
3. **Flip horizontally** if there's not enough room to the right (show to the left of cursor)
4. **Only clamp as fallback** when flipping still doesn't provide enough space

### Algorithm

```
spaceBelow = window.innerHeight - y - 8
spaceRight = window.innerWidth - x - 8

if (menuHeight > spaceBelow AND menuHeight <= y):
    // Flip above if there's room
    finalY = y - menuHeight
else:
    finalY = y  // Keep below

if (menuWidth > spaceRight AND menuWidth <= x):
    // Flip left if there's room
    finalX = x - menuWidth
else:
    finalX = x  // Keep right
```

## Implementation

Modify the `useEffect` in `ContextMenu.tsx` (lines 126-134) to:
1. Calculate available space in all four directions
2. Determine whether to flip vertically and/or horizontally
3. Apply flip positioning before falling back to clamping

No changes to the component interface or other files required.

## Testing

- Right-click channel at bottom of sidebar → menu should appear above
- Right-click channel at far right edge → menu should appear to the left
- Right-click channel in middle → menu appears below/right as normal
- Menus with submenus continue to work correctly

## Files Affected

- `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx`
