# Design: Default Avatar Silhouette in User Rows

**Date:** 2026-02-21
**Related issue:** #76 (Show Mumble user avatar when highlighting a user)

## Summary

Add a default person-silhouette avatar icon to user rows in the channel tree and connected users panel. This is a prerequisite for issue #76, which will replace the silhouette with real Mumble avatar textures when available.

## Scope

- `src/Brmble.Web/src/components/ChannelTree.tsx`
- `src/Brmble.Web/src/components/ChannelTree.css`
- `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- `src/Brmble.Web/src/components/Sidebar/Sidebar.css`

No new files. No bridge or backend changes.

## Current State

User rows in both panels currently render:

```
[status icons]  Username
```

There is no avatar element at all. Status icons are inline SVGs for deaf/muted/mic state.

## Proposed Change

User rows will render:

```
[avatar]  [status icons]  Username
```

### Avatar Element

A `<div className="user-avatar-icon">` containing the same person-silhouette SVG already used in `UserPanel.tsx`:

```tsx
<div className="user-avatar-icon" title={user.name}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="14" r="8" />
    <path d="M12 2C12 2 8 2 8 6C8 10 12 14 12 14C12 14 16 10 16 6C16 2 12 2 12 2Z"
          fill="var(--accent-mint)" />
  </svg>
</div>
```

### CSS

Add `.user-avatar-icon` to `ChannelTree.css` and `Sidebar.css`:

- 20×20px circle
- Background: `var(--bg-elevated)` (dark aubergine)
- `border-radius: 50%`
- `flex-shrink: 0`
- Aligned with the existing row flex layout

The `speaking` glow animation from `UserPanel` is **not** included — out of scope.

## Future Compatibility (Issue #76)

When #76 is implemented, the avatar div becomes an `<img>` with a fallback:

```tsx
<div className="user-avatar-icon" title={user.name}>
  {user.avatarUrl
    ? <img src={user.avatarUrl} alt={user.name} />
    : <svg>/* silhouette */</svg>
  }
</div>
```

No structural changes to row layout will be needed.

## Out of Scope

- Forwarding `texture`/`texture_hash` from Mumble protobuf through the C# bridge
- `UserPanel` bottom bar (already has its own avatar icon)
- `MessageBubble` / `DMContactList` (already show first-letter initials)
- Speaking glow animation on user row avatars
