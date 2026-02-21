# Hide Root Channel & Surface Root Users Design

**Date:** 2026-02-21

## Problem

The Mumble root channel (id=0, no parent) appears as a regular channel row in the `ChannelTree`. Users who are in the root channel are listed inside it as if it were a voice channel. This is confusing because the root channel is not a joinable voice channel — it is a lobby/waiting area.

## Goal

1. Hide the root channel name/row from the channel tree.
2. Display users in the root channel in a dedicated section **below** the "Users online" status panel and **above** the channel tree.
3. Root-channel users are shown with a muted grey colour to distinguish them from users in voice channels.

## Approach: Filter in Sidebar (Option A)

All logic lives in `Sidebar.tsx`. `ChannelTree` receives only non-root channels and non-root users — it needs no changes to its rendering logic.

### Root channel identification

A channel is the root if it has no `parent` field (or `parent === undefined`). Since Mumble always sends exactly one root channel (id=0), we identify it as the first channel with `parent === undefined` after the channel list is populated. We use `channels.find(ch => ch.parent === undefined)` to find it.

### What changes

**`Sidebar.tsx`**
- Compute `rootChannel` and `rootUsers` from props.
- Render a `.root-users-panel` section (only when `connected && rootUsers.length > 0`) between `.server-status-panel` and `.sidebar-divider`.
- Pass `channels.filter(ch => ch !== rootChannel)` and `users.filter(u => u.channelId !== rootChannel?.id)` to `<ChannelTree>`.

**`Sidebar.css`**
- Style `.root-users-panel` as a small panel (similar visual weight to `.server-status-panel`).
- Style `.root-user-row` with muted grey text (`var(--text-muted)`), mic status icon, mute/deafen icons.
- Self user in root channel gets the same `(you)` badge treatment but grey, not mint.

### Layout (top → bottom in sidebar)

```
[ server-info-panel          ]
[ server-status-panel        ]  ← "Logged in as" / "Users online N"
[ root-users-panel           ]  ← grey user rows, only when root has users
[ sidebar-divider            ]
[ sidebar-channels (tree)    ]  ← no root channel row, only sub-channels
```

### Styling decisions

- Root user name: `var(--text-muted)` (grey)
- Self in root: name stays `var(--text-muted)` but a `(you)` badge is shown (muted mint or plain grey)
- No hover join behaviour (root channel is not joinable)
- Mute/deafen icons same as in the tree (same SVGs), also muted grey

## Out of scope

- Sorting root users
- Clicking root users to join root channel
- Any backend changes
