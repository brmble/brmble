# Matrix Avatar System Implementation Plan

**Goal:** Add full avatar support using Matrix as the single source of truth -- Brmble upload UI, Mumble texture bridging, and display across all 7 components with a graceful fallback chain.

**Architecture:** All avatar images stored in Matrix via `mxc://` URIs. SQLite tracks `avatar_source` for priority logic only. Frontend fetches avatars from Matrix profiles and listens for bridge updates. A shared `<Avatar>` component handles the fallback chain (real image -> platform logo -> letter initial).

**Tech Stack:** C# / ASP.NET Core (server), React + TypeScript (frontend), matrix-js-sdk, SQLite/Dapper, react-easy-crop, MSTest + Moq (tests)

**Design doc:** `docs/plans/2026-03-13-matrix-avatar-system-design.md`

---

### Task 1: Add `avatar_source` Column to Database

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs:39-43`
- Test: `tests/Brmble.Server.Tests/Matrix/MatrixEventHandlerTests.cs` (existing DB helper verifies schema)

**Step 1: Add migration in Database.Initialize()**

In `src/Brmble.Server/Data/Database.cs`, after the existing `matrix_access_token` migration (line 39-43), add:

```csharp
// Migrate: add avatar_source column
var hasAvatarSource = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='avatar_source'");
if (hasAvatarSource == 0)
    conn.Execute("ALTER TABLE users ADD COLUMN avatar_source TEXT");
```

**Step 2: Run build to verify it compiles**

Run: `dotnet build src/Brmble.Server`
Expected: Build succeeded

**Step 3: Run existing tests to verify no regressions**

Run: `dotnet test tests/Brmble.Server.Tests`
Expected: All tests pass

**Step 4: Commit**

```
git add src/Brmble.Server/Data/Database.cs
git commit -m "feat: add avatar_source column migration to users table"
```

---

### Task 2: Add `SetAvatarUrl` to MatrixAppService

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixAppService.cs:8-19` (interface) and after line 179 (implementation)
- Test: `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`

**Step 1: Write the failing test**

Add to `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`:

```csharp
[TestMethod]
public async Task SetAvatarUrl_SendsPutToAvatarUrlEndpoint()
{
    SetupHttpResponse(HttpStatusCode.OK);

    await _svc.SetAvatarUrl("1", "mxc://server/abc123");

    var req = _capturedRequests.Single();
    Assert.AreEqual(HttpMethod.Put, req.Method);
    StringAssert.Contains(req.RequestUri!.AbsolutePath,
        "/_matrix/client/v3/profile/%40" /* @1:localhost encoded */);
    StringAssert.Contains(req.RequestUri!.AbsolutePath, "avatar_url");
    var body = await req.Content!.ReadAsStringAsync();
    StringAssert.Contains(body, "mxc://server/abc123");
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests --filter SetAvatarUrl_SendsPutToAvatarUrlEndpoint`
Expected: FAIL -- `SetAvatarUrl` does not exist

**Step 3: Add interface method**

In `src/Brmble.Server/Matrix/MatrixAppService.cs`, add to the `IMatrixAppService` interface (after line 16):

```csharp
Task SetAvatarUrl(string localpart, string avatarUrl);
```

**Step 4: Add implementation**

In `src/Brmble.Server/Matrix/MatrixAppService.cs`, add after `SetDisplayName` (after line 180):

```csharp
public async Task SetAvatarUrl(string localpart, string avatarUrl)
{
    var userId = $"@{localpart}:{_serverDomain}";
    var url = $"{_homeserverUrl}/_matrix/client/v3/profile/{Uri.EscapeDataString(userId)}/avatar_url";
    var body = JsonSerializer.Serialize(new { avatar_url = avatarUrl });
    await SendRequest(HttpMethod.Put, url, body, actAs: userId);
}
```

**Step 5: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests --filter SetAvatarUrl_SendsPutToAvatarUrlEndpoint`
Expected: PASS

**Step 6: Commit**

```
git add src/Brmble.Server/Matrix/MatrixAppService.cs tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs
git commit -m "feat: add SetAvatarUrl to IMatrixAppService"
```

---

### Task 3: Add `avatar_source` Methods to UserRepository

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Test: create `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

**Step 1: Write failing tests**

Create `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`:

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryTests
{
    private Database _db = null!;
    private SqliteConnection _keepAlive = null!;
    private UserRepository _repo = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
        _repo = new UserRepository(_db, settings);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive.Dispose();

    [TestMethod]
    public async Task GetAvatarSource_ReturnsNull_WhenNotSet()
    {
        var user = await _repo.Insert("cert1", "Alice");
        var source = await _repo.GetAvatarSource(user.Id);
        Assert.IsNull(source);
    }

    [TestMethod]
    public async Task SetAvatarSource_StoresAndRetrieves()
    {
        var user = await _repo.Insert("cert2", "Bob");
        await _repo.SetAvatarSource(user.Id, "brmble");
        var source = await _repo.GetAvatarSource(user.Id);
        Assert.AreEqual("brmble", source);
    }

    [TestMethod]
    public async Task SetAvatarSource_NullClearsValue()
    {
        var user = await _repo.Insert("cert3", "Carol");
        await _repo.SetAvatarSource(user.Id, "mumble");
        await _repo.SetAvatarSource(user.Id, null);
        var source = await _repo.GetAvatarSource(user.Id);
        Assert.IsNull(source);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests --filter UserRepositoryTests`
Expected: FAIL -- methods don't exist

**Step 3: Add methods to UserRepository**

In `src/Brmble.Server/Auth/UserRepository.cs`, add after `GetAllAsync()` (after line 83):

```csharp
public async Task<string?> GetAvatarSource(long userId)
{
    using var conn = _db.CreateConnection();
    return await conn.QuerySingleOrDefaultAsync<string?>(
        "SELECT avatar_source FROM users WHERE id = @Id",
        new { Id = userId });
}

public async Task SetAvatarSource(long userId, string? source)
{
    using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
        "UPDATE users SET avatar_source = @Source WHERE id = @Id",
        new { Source = source, Id = userId });
}
```

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests --filter UserRepositoryTests`
Expected: PASS

**Step 5: Run all tests**

Run: `dotnet test tests/Brmble.Server.Tests`
Expected: All pass

**Step 6: Commit**

```
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "feat: add avatar_source get/set methods to UserRepository"
```

---

### Task 4: Add Mumble Texture Fetching to MatrixEventHandler

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixEventHandler.cs`
- Modify: `src/Brmble.Server/Mumble/IMumbleEventHandler.cs` (add `OnUserTextureAvailable`)
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
- Test: `tests/Brmble.Server.Tests/Matrix/MatrixEventHandlerTests.cs`

**Context:** The Mumble Ice `User` struct does not carry texture data inline. Textures must be fetched via `server.getTexture(userid)` on the Ice `Server` proxy. The `userConnected` callback provides the `User` state including `userid` (-1 for unregistered users). For registered users, we can fetch the texture via the server proxy.

**Step 1: Add `OnUserTextureAvailable` to IMumbleEventHandler**

In `src/Brmble.Server/Mumble/IMumbleEventHandler.cs`, add after line 9:

```csharp
Task OnUserTextureAvailable(MumbleUser user, byte[] textureData);
```

**Step 2: Add texture fetching to MumbleServerCallback.DispatchUserConnected**

In `src/Brmble.Server/Mumble/MumbleServerCallback.cs`, after the existing `DispatchUserConnected` method (after line 122), the method needs to also attempt to fetch the user's texture. Modify `DispatchUserConnected`:

After `await Task.WhenAll(_handlers.Select(h => h.OnUserConnected(enriched)));` (line 121), add:

```csharp
// Attempt to fetch Mumble user texture (avatar) for registered users
if (_serverProxy is not null && user.SessionId > 0)
{
    try
    {
        // Get the user state to check if they're registered (userid >= 0)
        var state = await _serverProxy.getStateAsync(user.SessionId);
        if (state.userid >= 0)
        {
            var texture = await _serverProxy.getTextureAsync(state.userid);
            if (texture is { Length: > 0 })
            {
                await Task.WhenAll(_handlers.Select(h => h.OnUserTextureAvailable(enriched, texture)));
            }
        }
    }
    catch (Exception ex)
    {
        _logger.LogDebug(ex, "Could not fetch texture for user {User} session {Session}", user.Name, user.SessionId);
    }
}
```

**Step 3: Implement `OnUserTextureAvailable` in MatrixEventHandler**

In `src/Brmble.Server/Matrix/MatrixEventHandler.cs`, add the needed dependencies and the handler.

Update the constructor to accept `UserRepository` and `IMatrixAppService`:

```csharp
public class MatrixEventHandler : IMumbleEventHandler
{
    private readonly MatrixService _matrixService;
    private readonly IActiveBrmbleSessions _activeSessions;
    private readonly IMatrixAppService _appService;
    private readonly UserRepository _userRepository;
    private readonly ILogger<MatrixEventHandler> _logger;

    public MatrixEventHandler(
        MatrixService matrixService,
        IActiveBrmbleSessions activeSessions,
        IMatrixAppService appService,
        UserRepository userRepository,
        ILogger<MatrixEventHandler> logger)
    {
        _matrixService = matrixService;
        _activeSessions = activeSessions;
        _appService = appService;
        _userRepository = userRepository;
        _logger = logger;
    }
```

Add the handler method:

```csharp
public async Task OnUserTextureAvailable(MumbleUser user, byte[] textureData)
{
    if (string.IsNullOrEmpty(user.CertHash)) return;

    var dbUser = await _userRepository.GetByCertHash(user.CertHash);
    if (dbUser is null) return;

    var avatarSource = await _userRepository.GetAvatarSource(dbUser.Id);
    if (avatarSource == "brmble")
    {
        _logger.LogDebug("Skipping Mumble texture for {User}: Brmble avatar takes priority", user.Name);
        return;
    }

    // Detect content type from magic bytes
    var contentType = DetectImageContentType(textureData);
    if (contentType is null)
    {
        _logger.LogWarning("Mumble texture for {User} has unrecognized format, skipping", user.Name);
        return;
    }

    try
    {
        var localpart = dbUser.MatrixUserId.Split(':')[0].TrimStart('@');
        var mxcUrl = await _appService.UploadMedia(textureData, contentType, "avatar.png");
        await _appService.SetAvatarUrl(localpart, mxcUrl);
        await _userRepository.SetAvatarSource(dbUser.Id, "mumble");
        _logger.LogInformation("Set Mumble texture as avatar for {User}", user.Name);
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Failed to upload Mumble texture for {User}", user.Name);
    }
}

private static string? DetectImageContentType(byte[] data)
{
    if (data.Length < 4) return null;
    if (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) return "image/png";
    if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return "image/jpeg";
    if (data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46) return "image/gif";
    if (data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46) return "image/webp";
    return null;
}
```

**Step 4: Add `using` statements to MatrixEventHandler.cs**

Add at the top:

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Matrix;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging;
```

**Step 5: Register the new dependencies in MatrixExtensions.cs**

Check `src/Brmble.Server/Matrix/MatrixExtensions.cs` -- the `MatrixEventHandler` is already registered. Verify `UserRepository` is also registered (it should be via `AuthExtensions`). No changes needed if already wired.

**Step 6: Write tests for OnUserTextureAvailable**

Add to `tests/Brmble.Server.Tests/Matrix/MatrixEventHandlerTests.cs`:

```csharp
[TestMethod]
public async Task OnUserTextureAvailable_UploadsAndSetsAvatar_WhenNoExistingBrmbleAvatar()
{
    var appService = new Mock<IMatrixAppService>();
    appService.Setup(a => a.UploadMedia(It.IsAny<byte[]>(), "image/png", "avatar.png"))
        .ReturnsAsync("mxc://server/texture123");
    appService.Setup(a => a.SetAvatarUrl(It.IsAny<string>(), It.IsAny<string>()))
        .Returns(Task.CompletedTask);

    var (db, keepAlive) = CreateDb();
    using var _ = keepAlive;
    var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
    var userRepo = new UserRepository(db, settings);
    var user = await userRepo.Insert("abc", "Alice");

    var channelRepo = new ChannelRepository(db);
    var sessions = new Mock<IActiveBrmbleSessions>();
    var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
    _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

    // PNG magic bytes
    var texture = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
    await _handler.OnUserTextureAvailable(new MumbleUser("Alice", "abc", 1), texture);

    appService.Verify(a => a.UploadMedia(texture, "image/png", "avatar.png"), Times.Once);
    appService.Verify(a => a.SetAvatarUrl(It.IsAny<string>(), "mxc://server/texture123"), Times.Once);
    Assert.AreEqual("mumble", await userRepo.GetAvatarSource(user.Id));
}

[TestMethod]
public async Task OnUserTextureAvailable_SkipsWhenBrmbleAvatarExists()
{
    var appService = new Mock<IMatrixAppService>();

    var (db, keepAlive) = CreateDb();
    using var _ = keepAlive;
    var settings = Options.Create(new MatrixSettings { ServerDomain = "localhost" });
    var userRepo = new UserRepository(db, settings);
    var user = await userRepo.Insert("def", "Bob");
    await userRepo.SetAvatarSource(user.Id, "brmble");

    var channelRepo = new ChannelRepository(db);
    var sessions = new Mock<IActiveBrmbleSessions>();
    var svc = new MatrixService(channelRepo, appService.Object, sessions.Object, NullLogger<MatrixService>.Instance);
    _handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);

    var texture = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
    await _handler.OnUserTextureAvailable(new MumbleUser("Bob", "def", 2), texture);

    appService.Verify(a => a.UploadMedia(It.IsAny<byte[]>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
}
```

**Step 7: Update existing tests that construct MatrixEventHandler**

The existing tests in `MatrixEventHandlerTests.cs` construct `MatrixEventHandler` with only 2 args. They need updating to pass the new dependencies. For each existing test, update the constructor call:

```csharp
_handler = new MatrixEventHandler(svc, sessions.Object, appService.Object, userRepo, NullLogger<MatrixEventHandler>.Instance);
```

Where `appService` and `userRepo` can be mocks/real instances as already available in each test. The `userRepo` needs the `CreateDb` helper result. Add `using Microsoft.Extensions.Options;` and `using Brmble.Server.Auth;` imports to the test file.

**Step 8: Run all tests**

Run: `dotnet test tests/Brmble.Server.Tests`
Expected: All pass

**Step 9: Commit**

```
git add src/Brmble.Server/Mumble/IMumbleEventHandler.cs src/Brmble.Server/Mumble/MumbleServerCallback.cs src/Brmble.Server/Matrix/MatrixEventHandler.cs tests/Brmble.Server.Tests/Matrix/MatrixEventHandlerTests.cs
git commit -m "feat: bridge Mumble textures to Matrix avatars on user connect"
```

---

### Task 5: Add `avatarUrl` to Frontend User Type

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:15-27`

**Step 1: Add the field**

In `src/Brmble.Web/src/types/index.ts`, add to the `User` interface (after `comment?: string;` on line 25):

```typescript
avatarUrl?: string;
```

**Step 2: Run frontend build to verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: add avatarUrl field to User type"
```

---

### Task 6: Create Shared Avatar Component

**Files:**
- Create: `src/Brmble.Web/src/components/Avatar/Avatar.tsx`
- Create: `src/Brmble.Web/src/components/Avatar/Avatar.css`

**Step 1: Create Avatar.css**

Create `src/Brmble.Web/src/components/Avatar/Avatar.css`:

```css
.avatar {
  border-radius: var(--radius-full);
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-avatar-start), var(--bg-avatar-end));
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-letter {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-weight: 600;
  text-transform: uppercase;
  line-height: 1;
  user-select: none;
}

.avatar-platform-logo {
  width: 60%;
  height: 60%;
  object-fit: contain;
  opacity: 0.7;
}

.avatar.speaking {
  box-shadow: 0 0 0 2px var(--accent-primary),
              0 0 8px var(--accent-primary);
  transition: box-shadow var(--transition-fast);
}
```

**Step 2: Create Avatar.tsx**

Create `src/Brmble.Web/src/components/Avatar/Avatar.tsx`:

```tsx
import { useState, useCallback } from 'react';
import type { User } from '../../types';
import brmbleLogo from '../../assets/brmble-logo.svg';
import mumbleLogo from '../../assets/mumble-seeklogo.svg';
import './Avatar.css';

interface AvatarProps {
  user: Pick<User, 'name' | 'matrixUserId' | 'avatarUrl'>;
  size: number;
  speaking?: boolean;
  className?: string;
}

type FallbackState = 'image' | 'platform-logo' | 'letter';

export default function Avatar({ user, size, speaking, className }: AvatarProps) {
  const hasAvatar = !!user.avatarUrl;
  const [fallback, setFallback] = useState<FallbackState>(hasAvatar ? 'image' : 'platform-logo');

  // Reset fallback when avatarUrl changes
  const prevUrl = useState(user.avatarUrl)[0];
  if (user.avatarUrl !== prevUrl && user.avatarUrl) {
    setFallback('image');
  }

  const onImageError = useCallback(() => {
    setFallback((prev) => {
      if (prev === 'image') return 'platform-logo';
      return 'letter';
    });
  }, []);

  const letter = user.name?.charAt(0).toUpperCase() || '?';
  const isMumbleOnly = !user.matrixUserId;
  const platformLogo = isMumbleOnly ? mumbleLogo : brmbleLogo;
  const fontSize = Math.max(Math.round(size * 0.45), 10);

  const classes = ['avatar', speaking ? 'speaking' : '', className || '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {fallback === 'image' && user.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.name} onError={onImageError} />
      ) : fallback === 'platform-logo' ? (
        <img
          className="avatar-platform-logo"
          src={platformLogo}
          alt=""
          aria-hidden="true"
          onError={onImageError}
        />
      ) : (
        <span className="avatar-letter" style={{ fontSize }}>
          {letter}
        </span>
      )}
    </div>
  );
}
```

**Note:** The `prevUrl` tracking above is a simplified approach. A more robust version would use `useEffect` to reset fallback state when `avatarUrl` changes. The implementing engineer should use whichever pattern fits React 19 best -- the key behavior is: when `avatarUrl` goes from falsy to truthy, reset fallback to `'image'`.

**Step 3: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```
git add src/Brmble.Web/src/components/Avatar/
git commit -m "feat: add shared Avatar component with fallback chain"
```

---

### Task 7: Replace Avatar Markup in MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx:100-121`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css` (avatar styles)

**Step 1: Import Avatar and replace markup**

In `MessageBubble.tsx`, import the Avatar component and replace the avatar div (lines 119-121):

```tsx
// Replace:
<div className="message-avatar">
  <span className="avatar-letter">{getAvatarLetter(sender)}</span>
</div>

// With:
<Avatar user={{ name: sender, matrixUserId: matrixUserId, avatarUrl: avatarUrl }} size={40} />
```

The component will need `avatarUrl` and `matrixUserId` props passed through from the parent. Check how `sender` is passed -- it may come from `ChatMessage`. Add `avatarUrl?: string` and `matrixUserId?: string` to the props or derive from the message data.

**Step 2: Remove `getAvatarLetter` function if no longer used**

If `getAvatarLetter` (line 100-102) is only used for the avatar, remove it.

**Step 3: Clean up CSS**

In `MessageBubble.css`, the `.message-avatar` and `.avatar-letter` styles (lines 13-36) can be simplified or removed. The Avatar component brings its own styles. Keep `.message-avatar` only if it's used for layout positioning (margin/padding around the avatar slot). Rename to `.message-avatar-slot` if needed for clarity.

**Step 4: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.css
git commit -m "feat: replace MessageBubble letter avatar with Avatar component"
```

---

### Task 8: Replace Avatar Markup in ChatPanel DM Header

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:344-346`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css` (`.dm-chat-avatar` styles)

**Step 1: Replace DM header avatar**

In `ChatPanel.tsx`, replace lines 344-346:

```tsx
// Replace:
<div className="dm-chat-avatar">
  <span>{channelName?.charAt(0).toUpperCase()}</span>
</div>

// With:
<Avatar user={{ name: channelName || '', matrixUserId: recipientMatrixUserId, avatarUrl: recipientAvatarUrl }} size={28} />
```

The DM recipient's `matrixUserId` and `avatarUrl` need to be available. These should come from the DM conversation data or the users list.

**Step 2: Clean up CSS**

Remove or simplify `.dm-chat-avatar` styles in `ChatPanel.css` (lines 350-362).

**Step 3: Build and commit**

```
git commit -m "feat: replace ChatPanel DM header avatar with Avatar component"
```

---

### Task 9: Replace Avatar Markup in DMContactList

**Files:**
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx:85-87`
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.css`

**Step 1: Replace contact avatar**

In `DMContactList.tsx`, replace lines 85-87:

```tsx
// Replace:
<div className="dm-contact-avatar">
  <span>{contact.userName.charAt(0).toUpperCase()}</span>
</div>

// With:
<Avatar user={{ name: contact.userName, matrixUserId: contact.matrixUserId, avatarUrl: contact.avatarUrl }} size={28} />
```

The `DMConversation` type in `types/index.ts` may need `avatarUrl?: string` and `matrixUserId?: string` added.

**Step 2: Clean up CSS and commit**

```
git commit -m "feat: replace DMContactList avatar with Avatar component"
```

---

### Task 10: Replace Avatar Markup in UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx:215-220`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: Replace SVG silhouette with Avatar component**

In `UserPanel.tsx`, replace lines 215-220 (the SVG icon block):

```tsx
// Replace the existing user-avatar div containing the SVG with:
<Avatar
  user={{ name: currentUser.name, matrixUserId: currentUser.matrixUserId, avatarUrl: currentUser.avatarUrl }}
  size={20}
  speaking={currentUser.speaking}
/>
```

**Step 2: Move speaking glow styles**

The `.user-avatar.speaking` styles in `UserPanel.css` (glow animation) are now handled by the Avatar component's `.avatar.speaking` class. Remove the duplicate CSS.

**Step 3: Add click handler for quick avatar upload**

Wrap the Avatar in a clickable element that opens the avatar upload flow (this will be connected in the Upload UI task later). For now, just add a `role="button"` wrapper:

```tsx
<div className="user-avatar-trigger" onClick={openAvatarUpload} role="button" tabIndex={0}>
  <Avatar user={...} size={20} speaking={currentUser.speaking} />
</div>
```

**Step 4: Build and commit**

```
git commit -m "feat: replace UserPanel SVG avatar with Avatar component"
```

---

### Task 11: Replace Avatar Markup in UserInfoDialog

**Files:**
- Modify: `src/Brmble.Web/src/components/UserInfoDialog/UserInfoDialog.tsx:148-153`
- Modify: `src/Brmble.Web/src/components/UserInfoDialog/UserInfoDialog.css`

**Step 1: Replace SVG person icon**

In `UserInfoDialog.tsx`, replace lines 148-153:

```tsx
// Replace the SVG icon with:
<Avatar user={{ name: user.name, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }} size={56} />
```

**Step 2: Clean up CSS and commit**

```
git commit -m "feat: replace UserInfoDialog SVG avatar with Avatar component"
```

---

### Task 12: Add Avatar to ChannelTree User Rows

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx:233-288` (user row rendering)
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`

**Step 1: Add Avatar to user rows**

In `ChannelTree.tsx`, in the user row JSX (around line 246-280), add the Avatar component before the status icons:

```tsx
// Add before the status icons in each user row:
<Avatar user={{ name: user.name, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }} size={20} />
```

**Step 2: Add CSS for avatar spacing**

In `ChannelTree.css`, add spacing for the avatar within user rows:

```css
.user-row .avatar {
  margin-right: var(--space-2xs);
}
```

**Step 3: Build and commit**

```
git commit -m "feat: add Avatar to ChannelTree user rows"
```

---

### Task 13: Add Avatar to Sidebar Root User Rows

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:188-242`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`

**Step 1: Add Avatar to root user rows**

Same pattern as ChannelTree -- add `<Avatar>` before the status icons.

**Step 2: Add CSS and commit**

```
git commit -m "feat: add Avatar to Sidebar root user rows"
```

---

### Task 14: Fetch Avatars from Matrix in useMatrixClient

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`

**Step 1: Add avatar fetching utility**

Add a helper function that fetches a user's avatar URL from their Matrix profile:

```typescript
const fetchAvatarUrl = useCallback(async (userId: string): Promise<string | null> => {
  if (!clientRef.current) return null;
  try {
    const profile = await clientRef.current.getProfileInfo(userId);
    if (profile.avatar_url) {
      return clientRef.current.mxcUrlToHttp(profile.avatar_url, 128, 128, 'crop') || null;
    }
  } catch (e) {
    console.debug('Failed to fetch avatar for', userId, e);
  }
  return null;
}, []);
```

**Step 2: Expose fetchAvatarUrl from the hook**

Add `fetchAvatarUrl` to the return object so components/parents can use it to populate `user.avatarUrl`.

**Step 3: Build and commit**

```
git commit -m "feat: add avatar URL fetching from Matrix profiles"
```

---

### Task 15: Install react-easy-crop and Create Upload/Crop Component

**Files:**
- Install: `react-easy-crop` npm package
- Create: `src/Brmble.Web/src/components/AvatarUpload/AvatarUpload.tsx`
- Create: `src/Brmble.Web/src/components/AvatarUpload/AvatarUpload.css`

**Step 1: Install dependency**

Run: `cd src/Brmble.Web && npm install react-easy-crop`

**Step 2: Create AvatarUpload component**

Create `src/Brmble.Web/src/components/AvatarUpload/AvatarUpload.tsx`:

The component should:
- Accept `onUpload(base64: string, contentType: string)` and `onCancel()` callbacks
- Show a file picker for `image/png, image/jpeg, image/webp, image/gif`
- Validate file size (<5MB)
- Display `<Cropper>` from react-easy-crop with `aspect={1}` and `cropShape="round"`
- On confirm, use canvas to crop the image to a square, encode as base64, call `onUpload`
- Style with theme tokens per UI_GUIDE.md

**Step 3: Create AvatarUpload.css**

Style the crop area, buttons, and modal overlay using theme tokens.

**Step 4: Build and commit**

```
git commit -m "feat: add AvatarUpload component with square crop"
```

---

### Task 16: Add Profile Tab to Settings Modal

**Files:**
- Modify: Settings modal component (find the existing settings tabs)
- Create or modify the Profile tab to include avatar management

**Step 1: Locate the settings modal**

Search for the existing settings tabs (AudioSettingsTab, InterfaceSettingsTab, etc.) to understand the tab pattern.

**Step 2: Create ProfileSettingsTab**

- Show current avatar via `<Avatar>` at 80px
- "Upload" button opens the `<AvatarUpload>` component
- "Remove" button (visible when avatar is set) sends `avatar.remove` bridge message
- Status text showing avatar source ("Uploaded", "From Mumble", "Default")

**Step 3: Register the tab in the settings modal**

Add "Profile" as a tab option in the settings modal.

**Step 4: Build and commit**

```
git commit -m "feat: add Profile settings tab with avatar upload"
```

---

### Task 17: Wire Up Bridge Messages for Avatar Upload/Remove

**Files:**
- Modify: Frontend bridge message handling (wherever `voice.connect`, etc. are handled)
- Modify: `src/Brmble.Client/` if bridge is used (check architecture -- the bridge is in the Client project for desktop mode)

**Context:** Check whether avatar upload goes through the C# bridge (desktop client via WebView2) or directly to the Matrix server (web client). Based on the architecture, the bridge is only used in the desktop Brmble.Client. For the web client running against Brmble.Server, the upload would go through a REST endpoint or directly to Matrix.

**Step 1: Determine the upload path**

- If desktop (WebView2): bridge message `avatar.upload` -> C# handler -> `UploadMedia` + `SetAvatarUrl`
- If web: either add an API endpoint on Brmble.Server, or use `matrix-js-sdk` client directly (`client.uploadContent()` + `client.setAvatarUrl()`)

The web path using `matrix-js-sdk` directly is simpler and doesn't require backend changes. The desktop path needs a bridge handler.

**Step 2: Implement for both paths**

For the web path, the `AvatarUpload` component can call:
```typescript
const mxcUrl = await client.uploadContent(blob);
await client.setAvatarUrl(mxcUrl.content_uri);
```

For the desktop path, send `avatar.upload` bridge message and handle in a new `AvatarService` in `src/Brmble.Client/Services/Avatar/`.

**Step 3: Listen for `avatar.updated` bridge messages**

In the frontend, listen for `avatar.updated` to update the user's `avatarUrl` in state.

**Step 4: Build and commit**

```
git commit -m "feat: wire up avatar upload and bridge messages"
```

---

### Task 18: Add UserPanel Avatar Click Handler

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`

**Step 1: Add click handler**

When the user clicks their avatar in the UserPanel, open the AvatarUpload component (as a modal/popover).

**Step 2: Build and commit**

```
git commit -m "feat: add avatar upload shortcut from UserPanel click"
```

---

### Task 19: Visual Verification and Theme Testing

**Step 1: Test with Classic theme**

Run the dev server and verify all 7 components display avatars correctly:
- Users with avatars show the image
- Mumble-only users without avatars show the Mumble logo
- Brmble users without avatars show the Brmble logo
- Letter initials appear as final fallback

**Step 2: Test with Retro Terminal theme**

Retro Terminal has near-zero border-radius. Verify the avatar circles still look intentional (they use `--radius-full` which is `50%` in all themes).

**Step 3: Test upload flow**

- Upload an avatar via Settings > Profile
- Verify it appears in all components
- Remove the avatar
- Verify fallback chain kicks in

**Step 4: Run full build**

Run: `cd src/Brmble.Web && npm run build`
Run: `dotnet build`
Run: `dotnet test`

Expected: All pass

**Step 5: Commit any fixes**

```
git commit -m "fix: visual polish for avatar display across themes"
```

---

### Task 20: Final Build and Test

**Step 1: Run all backend tests**

Run: `dotnet test`
Expected: All pass

**Step 2: Run frontend build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds with no errors

**Step 3: Verify no regressions**

Ensure existing functionality (chat, voice, DMs, channel tree) still works as expected.
