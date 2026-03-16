# Server Password Field Design

## Problem

The ServerList add/edit form is missing a password field. The backend (`voice.connect`) and `ConnectModal` both support passwords, but the ServerList form does not. When connecting from a saved server, the password is hardcoded to `''`.

Issue: #23 (remaining item — dialog sizing already fixed)

## Decision

Save the password with the server entry so users don't need to re-enter it each time.

## Design

### Changes

1. **Form state** (`ServerList.tsx`) — add `password: ''` to form initial state and the edit population logic
2. **Form UI** (`ServerList.tsx`) — add an optional password input (`type="password"`) below the Username field, labeled "Password (optional)", using existing `.brmble-input` class
3. **Saved server data** — `password` is already part of the `SavedServer` interface in `App.tsx`, so no interface changes needed
4. **Connect flow** (`App.tsx`) — when connecting from a saved server via `handleServerConnect`, pass `server.password` instead of hardcoding `''`

### What doesn't change

- No CSS additions needed (uses existing `.brmble-input` styling)
- No backend changes (MumbleAdapter already handles the `password` parameter)
- No changes to ConnectModal (already has a password field)
- No changes to the `SavedServer` interface (already includes `password`)

### Touch points

| File | Change |
|------|--------|
| `src/Brmble.Web/src/components/ServerList/ServerList.tsx` | Add `password` to form state, add password input field, include password when saving |
| `src/Brmble.Web/src/App.tsx` | Pass `server.password` in `handleServerConnect` |
