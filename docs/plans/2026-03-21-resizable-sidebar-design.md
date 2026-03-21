# Resizable Sidebar Design

**Issue:** #345 — Make sidebar horizontally resizable
**Date:** 2026-03-21

## Summary

Add a drag handle to the sidebar's right edge so users can resize it horizontally. Width persists per profile via localStorage.

## Constraints

| Constraint | Value |
|---|---|
| Min width | 340px (current fixed width) |
| Max width | 600px |
| Default | 340px |

## Approach: Custom `useResizable` Hook

A zero-dependency hook that manages pointer events on a drag handle.

### Hook API

```ts
useResizable({
  minWidth: number,
  maxWidth: number,
  defaultWidth: number,
  storageKey: string,
  fingerprint: string
}) => {
  width: number,
  handleProps: { ref, onPointerDown },
  isDragging: boolean
}
```

### Drag Behavior

- `pointerdown` on handle: call `setPointerCapture`, set `isDragging`, add `user-select: none` to `<body>`
- `pointermove`: clamp `e.clientX` between min/max, update width state
- `pointerup`: release pointer capture, remove `user-select: none`, persist width to localStorage
- Double-click: reset to default width

### Drag Handle Element

A `<div className="sidebar-resize-handle">` as the last child of `.sidebar`:

- 4px wide, `position: absolute; right: 0; top: 0; bottom: 0`
- Invisible by default; on hover shows `var(--border-subtle)` vertical line
- `cursor: col-resize`
- Active drag state: `var(--accent-primary)` 2px line
- `::before` pseudo-element extends hit area 4px outward (total 8px grab zone)

### Persistence

Follows existing per-profile localStorage convention:

- Key: `brmble-sidebar-width_{fingerprint}` (plain `brmble-sidebar-width` when no fingerprint)
- Written on `pointerup` only (not during drag)
- On profile switch: hook reads from new scoped key, falls back to 340px default

No migration needed — this is a new key with no legacy data.

## Files Changed

| File | Change |
|---|---|
| `src/Brmble.Web/src/hooks/useResizable.ts` | **New** — reusable resize hook |
| `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` | Add drag handle, use hook, apply inline width |
| `src/Brmble.Web/src/components/Sidebar/Sidebar.css` | Drag handle styles |
| `src/Brmble.Web/src/App.css` | Remove fixed `width`/`min-width` on `.sidebar`, let inline style drive width |
| `src/Brmble.Web/src/index.css` | Add `--sidebar-min-width` and `--sidebar-max-width` tokens |

## Design Decisions

1. **Min = current width (340px):** The sidebar can only grow, not shrink below its current design.
2. **Pointer events over mouse events:** Better touch support, `setPointerCapture` avoids iframe/WebView2 event stealing.
3. **Persist on pointerup only:** Avoids localStorage thrashing during drag.
4. **No animation during drag:** Direct width tracking; `prefers-reduced-motion` respected for any non-drag transitions.
5. **Double-click to reset:** Discoverable way to return to default width.
