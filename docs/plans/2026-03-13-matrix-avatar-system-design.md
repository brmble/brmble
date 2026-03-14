# Matrix Avatar System Design

## Overview

Add full avatar support to Brmble using Matrix as the single source of truth for avatar storage. Users can upload avatars through the Brmble UI or have their Mumble textures automatically bridged to Matrix. All components display real avatar images with a graceful fallback chain.

## Architecture: Matrix as Single Source of Truth

All avatar images are stored in Matrix via `mxc://` URIs. The SQLite `users` table tracks only the avatar source (for priority logic), not the image data itself. Matrix provides media storage, thumbnailing, and HTTP-accessible URLs.

## Data Flows

### Flow A: Brmble Upload

1. User selects image in browser -> client-side square crop
2. Bridge message: `avatar.upload { imageData (base64), contentType }`
3. Server: `UploadMedia(bytes)` -> gets `mxc://` URI
4. Server: `SetAvatarUrl(userId, mxcUri)` -> stores on Matrix profile
5. Server: sets `avatar_source = "brmble"` in SQLite
6. Bridge message: `avatar.updated { userId, avatarUrl (http) }` -> frontend updates

### Flow B: Mumble Texture

1. Server receives `UserState` with `Texture` bytes (or `TextureHash` triggering a `RequestBlob`)
2. Server checks SQLite: if `avatar_source = "brmble"`, skip (Brmble upload wins)
3. Otherwise: `UploadMedia(texture, contentType)` -> `SetAvatarUrl(userId, mxcUri)`
4. Sets `avatar_source = "mumble"` in SQLite
5. Bridge message: `avatar.updated { userId, avatarUrl (http) }`

### Flow C: Display

1. Frontend fetches Matrix profile via `client.getProfileInfo(userId)`
2. Converts `mxc://` to HTTP via `client.mxcUrlToHttp()`
3. Stores resolved URL as `user.avatarUrl`
4. Components render `<img>` or fall through the fallback chain

## Avatar Fallback Chain

| Priority | Source | Condition |
|----------|--------|-----------|
| 1 | Brmble upload | `avatar_source = "brmble"` |
| 2 | Mumble texture | `avatar_source = "mumble"` |
| 3 | Platform logo | No avatar set: `mumble-seeklogo.svg` for Mumble-only users (no `matrixUserId`), `brmble-logo.svg` for Brmble users |
| 4 | Letter initial / silhouette | Ultimate fallback if logo asset fails to load |

## Backend Changes

### MatrixAppService.cs

New method on `IMatrixAppService`:

```csharp
Task SetAvatarUrl(string localpart, string avatarUrl);
```

`PUT /_matrix/client/v3/profile/{userId}/avatar_url` with body `{ "avatar_url": "mxc://..." }`, following the same pattern as `SetDisplayName()`.

### Database.cs

New column on `users` table:

```
avatar_source TEXT  -- "brmble", "mumble", or NULL
```

### MatrixEventHandler.cs

Handle `UserState.Texture` on Mumble user state updates:

- If `Texture` bytes present and `avatar_source != "brmble"`: upload to Matrix, set avatar, mark `avatar_source = "mumble"`
- If only `TextureHash` present and hash differs from cached: send `RequestBlob` for `session_texture`, handle full texture on response
- If texture cleared and `avatar_source = "mumble"`: clear Matrix `avatar_url`, set `avatar_source = NULL`

In-memory `Dictionary<int, byte[]>` of `session -> textureHash` to avoid redundant re-uploads.

### Bridge Messages

| Message | Direction | Payload |
|---------|-----------|---------|
| `avatar.upload` | JS -> C# | `{ imageData: string (base64), contentType: string }` |
| `avatar.updated` | C# -> JS | `{ userId: string, avatarUrl: string (http) }` |
| `avatar.remove` | JS -> C# | `{}` |
| `avatar.removed` | C# -> JS | `{ userId: string }` |
| `avatar.error` | C# -> JS | `{ message: string }` |

## Frontend Changes

### User Type (types/index.ts)

```typescript
avatarUrl?: string;  // HTTP URL resolved from Matrix mxc://
```

### Avatar Fetching (useMatrixClient.ts)

- On initial sync / room join: `client.getProfileInfo(userId)` for each member
- Convert `avatar_url` via `client.mxcUrlToHttp()`
- Listen for `avatar.updated` bridge messages for real-time updates

### Shared Avatar Component

Single `<Avatar>` component replacing all current avatar markup:

```
Props:
  user: User          -- for avatarUrl, matrixUserId, name
  size: number        -- 20, 28, 40, 56 depending on context
  speaking?: boolean  -- glow animation (UserPanel only)

Render:
  avatarUrl exists    -> <img> with circular clip
  no matrixUserId     -> mumble-seeklogo.svg
  else                -> brmble-logo.svg
  on img error        -> letter initial or SVG silhouette
```

Styled with `--bg-avatar-start`, `--bg-avatar-end`, `--radius-full`.

### Components Updated

| Component | Size | Notes |
|-----------|------|-------|
| MessageBubble | 40px | Replace letter-initial div |
| ChatPanel header | 28px | Replace DM letter-initial |
| DMContactList | 28px | Replace letter-initial |
| UserPanel | 20px | Replace SVG silhouette, pass `speaking` prop |
| UserInfoDialog | 56px | Replace SVG person icon |
| ChannelTree | 20px | New avatar slot (currently has none) |
| Sidebar | 20px | New avatar slot (currently has none) |

### Upload UI

**Settings modal**: New "Profile" tab with avatar preview (80px), upload button, client-side square crop (e.g. `react-easy-crop`), remove button. On confirm: crop, base64 encode, send `avatar.upload`.

**UserPanel quick access**: Clicking avatar in bottom bar opens the same crop/upload flow.

## Error Handling

### Upload Errors
- File too large: client-side validation, reject >5MB
- Invalid format: accept `image/png`, `image/jpeg`, `image/webp`, `image/gif` only
- Matrix upload/profile update fails: respond with `avatar.error`, avatar unchanged

### Display Errors
- `mxcUrlToHttp()` returns null: fall through to platform logo
- `<img onerror>`: fall through to platform logo, then letter initial
- Matrix unreachable: all users show platform logos (cosmetic, not critical)

### Race Conditions
- Simultaneous Brmble upload and Mumble texture: `avatar_source` column is the tiebreaker
- Multiple rapid uploads: last one wins, no queuing needed

### Cleanup
- User removes avatar: clear Matrix `avatar_url`, set `avatar_source = NULL`, next Mumble texture sync can populate if available

## Assets

- `src/Brmble.Web/src/assets/brmble-logo.svg` (exists)
- `src/Brmble.Web/src/assets/mumble-seeklogo.svg` (exists)
