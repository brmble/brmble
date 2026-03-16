# Server Password Field Design

## Problem

The ServerList add/edit form is missing a password field. The backend (`voice.connect`) and `ConnectModal` both support passwords, but the ServerList form does not. When connecting from a saved server, the password is hardcoded to `''`.

Issue: #23 (remaining item — dialog sizing already fixed)

## Decision

Save the password with the server entry so users don't need to re-enter it each time. Plaintext storage is acceptable for this use case.

## Design

### Changes

1. **C# `ServerEntry` record** (`IServerlistService.cs`) — add `Password` field with `""` default for backward compatibility
2. **C# parsing** (`ServerlistService.cs`, `AppConfigService.cs`) — both `ParseServerEntry` methods updated to read/write `password` from JSON
3. **TypeScript `ServerEntry` interface** (`useServerlist.ts`) — add `password: string`
4. **Form state** (`ServerList.tsx`) — add `password: ''` to form initial state, edit population, and all reset paths
5. **Form UI** (`ServerList.tsx`) — add an optional password input *before* the Username field with:
   - Placeholder: "Server Password (optional)"
   - Custom visibility toggle (eye icon) that appears on focus
   - Toggle is keyboard-accessible with `aria-pressed`, no visible focus highlight
   - Password resets to masked on blur, cancel, save, edit, and Escape
6. **CSS** (`ServerList.css`) — password wrapper, toggle button styling, `::-ms-reveal` suppression, `:focus-visible` outline removal on toggle
7. **Connect flow** (`App.tsx`) — pass `server.password || ''` in `handleServerConnect` instead of hardcoded `''`

### Touch points

| File | Change |
|------|--------|
| `src/Brmble.Client/Services/Serverlist/IServerlistService.cs` | Add `Password` to `ServerEntry` record |
| `src/Brmble.Client/Services/Serverlist/ServerlistService.cs` | Update `ParseServerEntry` to handle password |
| `src/Brmble.Client/Services/AppConfig/AppConfigService.cs` | Update duplicate `ParseServerEntry` to handle password |
| `src/Brmble.Web/src/hooks/useServerlist.ts` | Add `password: string` to `ServerEntry` interface |
| `src/Brmble.Web/src/components/ServerList/ServerList.tsx` | Add password to form state, add password input with visibility toggle |
| `src/Brmble.Web/src/components/ServerList/ServerList.css` | Password wrapper, toggle button, native reveal suppression |
| `src/Brmble.Web/src/App.tsx` | Pass `server.password` in `handleServerConnect` |

### What doesn't change

- No changes to MumbleAdapter (already handles the `password` parameter)
- No changes to ConnectModal (already has a password field)
