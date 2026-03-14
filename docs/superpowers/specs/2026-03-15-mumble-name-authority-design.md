# Mumble as Name Authority for Brmble

## Problem

Mumble and Brmble maintain independent username systems. A user can register "arie" in Mumble (permanently bound to their cert), but a different cert could create a Brmble account with the same display name. There is no uniqueness enforcement on `display_name` in Brmble's database, and no cross-system name reservation.

## Design Principle

**Mumble's certificate-based registration is the single source of truth for usernames.** Brmble never maintains an independent name registry — it always derives display names from Mumble's registration database via ICE.

## First Connection Flow

When a user connects to a server for the first time via the Brmble client:

1. User enters host, port, username, and password in the existing ServerList / ConnectModal UI.
2. Client connects to Mumble with that username and cert.
3. Brmble server checks the user's registration status during `POST /auth/token`:
   - The user is already connected to Mumble at this point, so the server can check `state.userid` via the session — a value `>= 0` means the user is registered in Mumble.
   - For registered users, call `getRegistration(userid)` to retrieve the `UserInfoMap` including their registered `UserName`.
   - **Already registered in Mumble** → Ignore the username they typed. Use the registered `UserName`. Create Brmble account with it.
   - **Not registered, name available** → Call `registerUserAsync(UserInfoMap)` with `UserName` and `UserHash` (cert hash) to claim the name and bind it to the cert. Then create Brmble account.
   - **Not registered, name taken** → Reject with an error. Tell the user to pick a different name.
4. On subsequent connections, the username field in ServerList is disabled — the name is locked.

### ICE Registration Details

`registerUserAsync` takes a `UserInfoMap` (keyed by `UserInfo` enum). Required fields:
- `UserName` — the display name to register
- `UserHash` — the certificate hash, binding the registration to the cert

The call returns the new user ID on success, or throws `InvalidUserException` on failure (e.g. name already taken).

### Timing Gap

There is a window between Mumble connection (step 2) and Brmble auth (step 3) where the user appears in voice with their unverified typed name. This is acceptable — Mumble's default behavior already allows unregistered users to connect with any name. The Brmble auth step validates and registers the name shortly after connection. The unverified window is brief and consistent with how Mumble already works for unregistered users.

## Mumble-Only Users & Name Reservation

- **Registered Mumble-only users** (no Brmble client): Can connect and use voice normally. Their registered name is protected — no Brmble user can claim it. They don't get a Brmble identity (no Matrix account, no chat) until they install the Brmble client. When they eventually connect via Brmble with the same cert, the server sees their existing Mumble registration and creates their Brmble account automatically.
- **Unregistered Mumble-only users**: Can connect freely with any name (Mumble's default behavior). Their name is not protected — a Brmble user could register that same name. Consistent with how Mumble already works.

## Client UI Changes

- **Username field** in ServerList works as-is for first connection.
- After successful registration, the username is saved with the server entry and the field becomes **disabled/read-only**.
- On name conflict, show an error message (e.g. "Name already taken") and keep the field editable.
- No new registration dialog or name prompt.
- No name change UI — names are permanent.
- ProfileSettingsTab shows the display name as read-only.
- ConnectModal (direct connection dialog) follows the same pattern — username field disabled if the user has a registered name for that server.

## Server-Side Changes

### AuthEndpoints / AuthService

On `POST /auth/token`, before creating a new Brmble user:

1. Look up the user's Mumble session via `SessionMappingService` to get their session ID.
2. Call `getState(sessionId)` via ICE — check `state.userid`. If `>= 0`, the user is registered.
3. If registered → call `getRegistration(state.userid)` to get their registered `UserName`. Use that as `display_name`, skip any name from the request body.
4. If not registered → call `registerUserAsync(UserInfoMap { UserName, UserHash })` to claim the name. Handle `InvalidUserException` as a name conflict (don't rely on a prior `getRegisteredUsers` check — avoids TOCTOU race).
5. If name conflict → return an error response the client can display.

### HandleUserState

`HandleUserState` in `AuthService` currently syncs `display_name` from Mumble to Brmble DB. This method is **kept** as the cache-sync mechanism — it ensures the Brmble DB stays in sync with Mumble's authoritative name. `UpdateDisplayName` on `UserRepository` remains available for this internal sync purpose but is not exposed as a user-facing operation.

### IMumbleRegistrationService

New interface wrapping the ICE server proxy's registration methods:

- `Task<int> RegisterUserAsync(string name, string certHash)` — wraps `registerUserAsync(UserInfoMap)`
- `Task<string?> GetRegisteredNameAsync(int userId)` — wraps `getRegistration(userid)`
- `Task<bool> IsUserRegisteredAsync(int sessionId)` — wraps `getState(sessionId)` and checks `userid >= 0`

Lives in `src/Brmble.Server/Mumble/` alongside existing ICE infrastructure. Gets the server proxy reference via DI, same as `MumbleServerCallback`.

No new ICE callbacks needed — this is all outbound calls from Brmble to Mumble.

### Database

No new tables. The existing `users` table keeps `display_name` but it is always set from Mumble's registration. The column is effectively a cache of Mumble's authoritative data.

## Username Validation

Before attempting `registerUserAsync`, validate the username on the Brmble side:
- Non-empty, reasonable length (Mumble typically allows 1-128 characters)
- No invalid characters (Mumble rejects names with certain characters)
- Return a clear error message to the client for invalid names, rather than letting an opaque ICE exception propagate.

## Error Handling & Edge Cases

- **Name conflict**: Catch `InvalidUserException` from `registerUserAsync`. Client gets an error response, shows "Name already taken", username field stays editable.
- **Mumble ICE unavailable**: Fail the connection — don't silently create an account with an unverified name.
- **Cert mismatch**: If a user connects with a cert registered under "arie" but sends `mumbleUsername: "bob"` — ignore "bob", use "arie" from the registration. Mumble registration is authoritative.
- **Race condition**: Two users try the same name simultaneously — handled by catching `InvalidUserException` from the `registerUserAsync` call directly, not by a prior availability check (avoids TOCTOU).
- **Invalid username**: Client-side validation rejects bad names before the ICE call. If an invalid name still reaches ICE, map the exception to a user-friendly error.

## Existing User Migration

For users who have Brmble accounts from before this change:

- **On next connection**, the auth flow checks their cert against Mumble's registry:
  - **Cert is registered in Mumble** → Update `display_name` in Brmble DB to match the Mumble registration. Done.
  - **Cert is NOT registered, current `display_name` is available** → Auto-register the name in Mumble via `registerUserAsync`. Binds their existing name to their cert.
  - **Cert is NOT registered, current `display_name` is taken by another cert** → The user is in conflict. Set their `display_name` to a fallback (e.g. `user_{id}`) and prompt them to pick a new name on next connection (username field stays editable).
