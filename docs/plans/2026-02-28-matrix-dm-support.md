# Matrix DM Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable direct messages between Brmble users via Matrix 1:1 rooms, with localStorage fallback for classic Mumble users.

**Architecture:** Dual-path DM routing: if the recipient has a `matrixUserId`, send via Matrix 1:1 room; otherwise fall back to Mumble private messages + localStorage (existing path). The server provides a `userMappings` (displayName -> matrixUserId) in the `/auth/token` response so the client can enrich user payloads with Matrix user IDs. The frontend discovers existing DM rooms via Matrix `m.direct` account data and creates new ones on demand.

**Tech Stack:** C# / ASP.NET Core (server + client bridge), TypeScript / React (frontend), matrix-js-sdk, SQLite (Dapper), vitest (frontend tests), MSTest (server tests)

---

## Task 1: Add `GetAllAsync()` to UserRepository

Add a method to retrieve all registered users so the auth endpoint can include user mappings.

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs:72` (add method after UpdateMatrixToken)
- Test: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

**Step 1: Write the failing test**

In `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`, add:

```csharp
[TestMethod]
public async Task GetAllAsync_ReturnsAllInsertedUsers()
{
    await _repo!.Insert("hash1", "Alice");
    await _repo!.Insert("hash2", "Bob");

    var users = await _repo.GetAllAsync();

    Assert.AreEqual(2, users.Count);
    Assert.IsTrue(users.Any(u => u.DisplayName == "Alice"));
    Assert.IsTrue(users.Any(u => u.DisplayName == "Bob"));
}

[TestMethod]
public async Task GetAllAsync_EmptyDatabase_ReturnsEmptyList()
{
    var users = await _repo!.GetAllAsync();
    Assert.AreEqual(0, users.Count);
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GetAllAsync"`
Expected: FAIL — `GetAllAsync` method does not exist

**Step 3: Implement `GetAllAsync`**

In `src/Brmble.Server/Auth/UserRepository.cs`, add after `UpdateMatrixToken`:

```csharp
public async Task<List<User>> GetAllAsync()
{
    using var conn = _db.CreateConnection();
    var users = await conn.QueryAsync<User>(
        """
        SELECT id AS Id, cert_hash AS CertHash, display_name AS DisplayName, matrix_user_id AS MatrixUserId, matrix_access_token AS MatrixAccessToken
        FROM users
        """);
    return users.ToList();
}
```

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GetAllAsync"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "feat: add GetAllAsync to UserRepository for user mappings"
```

---

## Task 2: Include `userMappings` in `/auth/token` response

Extend the auth endpoint to return `userMappings` (displayName -> matrixUserId) so clients can associate Mumble users with Matrix IDs.

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs:11-103` (inject UserRepository, add userMappings to response)
- Test: `tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs`

**Step 1: Write the failing test**

In `tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs`, add:

```csharp
[TestMethod]
public async Task PostAuthToken_WithClientCert_IncludesUserMappings()
{
    var response = await _client.PostAsync("/auth/token", null);
    response.EnsureSuccessStatusCode();

    var json = await response.Content.ReadAsStringAsync();
    Assert.IsTrue(json.Contains("userMappings"), "Response should contain userMappings field");
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "IncludesUserMappings"`
Expected: FAIL — `userMappings` not present in response

**Step 3: Implement the change**

In `src/Brmble.Server/Auth/AuthEndpoints.cs`, add `UserRepository` to the endpoint parameters and build the mappings. The endpoint already injects `AuthService authService` — add `UserRepository userRepository` as a parameter:

```csharp
app.MapPost("/auth/token", async (
    HttpContext httpContext,
    ICertificateHashExtractor certHashExtractor,
    AuthService authService,
    IMatrixAppService matrixAppService,
    ChannelRepository channelRepository,
    UserRepository userRepository,  // <-- ADD THIS
    IOptions<MatrixSettings> matrixSettings,
    ILogger<AuthService> logger) =>
{
```

After the `roomMap` construction (line 70), add:

```csharp
var allUsers = await userRepository.GetAllAsync();
var userMappings = allUsers.ToDictionary(u => u.DisplayName, u => u.MatrixUserId);
```

Then include `userMappings` in the response object (inside the existing `Results.Ok`):

```csharp
return Results.Ok(new
{
    matrix = new
    {
        homeserverUrl = publicHomeserverUrl,
        accessToken = result.MatrixAccessToken,
        userId = result.MatrixUserId,
        roomMap
    },
    userMappings,  // <-- ADD THIS (top-level, not inside matrix)
    livekit = (object?)null
});
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthToken"`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/AuthEndpoints.cs tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs
git commit -m "feat: include userMappings in /auth/token response"
```

---

## Task 3: Parse `userMappings` in MumbleAdapter and include `matrixUserId` in user payloads

The client receives `userMappings` from the auth response and uses it to enrich `voice.connected` and `voice.userJoined` payloads.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
  - Add `_userMappings` field (~line 30)
  - Parse from credentials in `FetchAndSendCredentials` (~line 865)
  - Include in `ServerSync` user payloads (~line 1144)
  - Include in `UserState` payloads (~line 1254)

**Step 1: Add `_userMappings` field**

Near the other private fields (around line 30), add:

```csharp
private Dictionary<string, string> _userMappings = new();
```

**Step 2: Parse `userMappings` from credentials response**

In `FetchAndSendCredentials` (line 865), after `var credentials = await FetchCredentialsViaBcTls(...)`, parse the user mappings before sending credentials to the bridge:

```csharp
var credentials = await FetchCredentialsViaBcTls(cert, tokenUri, _reconnectUsername);
if (credentials is null)
    return;

// Parse user mappings (displayName -> matrixUserId) from the auth response
if (credentials.Value.TryGetProperty("userMappings", out var mappingsElement))
{
    _userMappings = new Dictionary<string, string>();
    foreach (var prop in mappingsElement.EnumerateObject())
    {
        var matrixId = prop.Value.GetString();
        if (matrixId is not null)
            _userMappings[prop.Name] = matrixId;
    }
}
```

**Step 3: Include `matrixUserId` in `voice.connected` payload**

In `ServerSync` (line 1144), update the user projection:

```csharp
var users = Users.Select(u => new
{
    session = u.Id,
    name = u.Name,
    channelId = u.Channel?.Id ?? 0,
    muted = u.Muted || u.SelfMuted || u.Deaf || u.SelfDeaf,
    deafened = u.Deaf || u.SelfDeaf,
    self = u == LocalUser,
    matrixUserId = _userMappings.GetValueOrDefault(u.Name)
}).ToList();
```

**Step 4: Include `matrixUserId` in `voice.userJoined` payload**

In `UserState` (line 1254), update the bridge send:

```csharp
var userName = user?.Name ?? userState.Name;
_bridge?.Send("voice.userJoined", new
{
    session = userState.Session,
    name = userName,
    channelId = user?.Channel?.Id ?? userState.ChannelId,
    muted = user != null ? (user.Muted || user.SelfMuted || user.Deaf || user.SelfDeaf) : (userState.Mute || userState.SelfMute || userState.Deaf || userState.SelfDeaf),
    deafened = user != null ? (user.Deaf || user.SelfDeaf) : (userState.Deaf || userState.SelfDeaf),
    self = isSelf,
    matrixUserId = userName is not null ? _userMappings.GetValueOrDefault(userName) : null
});
```

**Step 5: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: include matrixUserId in voice.connected and voice.userJoined payloads"
```

---

## Task 4: Add `matrixUserId` to frontend User type and store it from bridge events

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts` (~line 15, User interface)
- Modify: `src/Brmble.Web/src/App.tsx` (voice.connected and voice.userJoined handlers)

**Step 1: Add `matrixUserId` to User type**

In `src/Brmble.Web/src/types/index.ts`, add to the User interface:

```typescript
export interface User {
  id?: string;
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  speaking?: boolean;
  comment?: string;
  prioritySpeaker?: boolean;
  matrixUserId?: string;  // <-- ADD THIS
}
```

**Step 2: Update `voice.userJoined` type cast in App.tsx**

In `App.tsx`, find the `onVoiceUserJoined` handler (around line 370). Update the type cast to include `matrixUserId`:

```typescript
const d = data as {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  matrixUserId?: string;  // <-- ADD THIS
} | undefined;
```

The existing `setUsers` logic already spreads `d` into the user object, so `matrixUserId` will be stored automatically.

**Step 3: Update `voice.connected` handler**

Find the `voice.connected` handler that parses the initial user list. Ensure the user type includes `matrixUserId`. The existing code already maps the users array from the payload — `matrixUserId` will flow through as long as the type is correct.

**Step 4: Build to verify**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: store matrixUserId on frontend User type from bridge events"
```

---

## Task 5: Extend `useMatrixClient` to handle DM rooms

This is the core Matrix DM integration. The hook needs to discover existing DM rooms via `m.direct`, create new DM rooms, send/receive DM messages, and expose DM state.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`

**Step 1: Add DM state and types**

At the top of the hook (after the existing `messages` state), add DM-specific state:

```typescript
// DM room tracking: matrixUserId -> roomId
const [dmRoomMap, setDmRoomMap] = useState<Map<string, string>>(new Map());
// Reverse lookup: roomId -> matrixUserId
const [roomIdToDMUserId, setRoomIdToDMUserId] = useState<Map<string, string>>(new Map());
// DM messages: matrixUserId -> ChatMessage[]
const [dmMessages, setDmMessages] = useState<Map<string, ChatMessage[]>>(new Map());
```

**Step 2: Discover existing DM rooms from `m.direct`**

In the `useEffect` that sets up the client (where `client.startClient()` is called), add a listener for when the initial sync completes:

```typescript
client.once(ClientEvent.Sync, (state: string) => {
  if (state === 'PREPARED') {
    const directEvent = client.getAccountData('m.direct');
    if (directEvent) {
      const directContent = directEvent.getContent() as Record<string, string[]>;
      const newDmRoomMap = new Map<string, string>();
      const newRoomIdToDMUserId = new Map<string, string>();
      for (const [userId, roomIds] of Object.entries(directContent)) {
        if (roomIds.length > 0) {
          newDmRoomMap.set(userId, roomIds[0]);
          newRoomIdToDMUserId.set(roomIds[0], userId);
        }
      }
      setDmRoomMap(newDmRoomMap);
      setRoomIdToDMUserId(newRoomIdToDMUserId);
    }
  }
});
```

**Step 3: Handle DM messages in `onTimeline`**

In the existing `onTimeline` handler, after the channel message check, add DM handling:

```typescript
const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
  if (event.getType() !== EventType.RoomMessage) return;

  // Existing channel message handling
  const channelId = roomIdToChannelId.get(room?.roomId ?? '');
  if (channelId) {
    // ... existing channel message code (unchanged) ...
    return;
  }

  // DM message handling
  const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
  if (!dmUserId) return;

  const sender = room?.getMember(event.getSender() ?? '')?.name ?? event.getSender() ?? 'Unknown';
  const content = event.getContent();
  const msg: ChatMessage = {
    id: event.getId() ?? crypto.randomUUID(),
    sender,
    content: content.body ?? '',
    timestamp: new Date(event.getTs()),
    isSystem: false,
  };

  setDmMessages(prev => {
    const existing = prev.get(dmUserId) ?? [];
    if (existing.some(m => m.id === msg.id)) return prev;
    const updated = new Map(prev);
    updated.set(dmUserId, [...existing, msg]);
    return updated;
  });
};
```

Note: Add a `roomIdToDMUserIdRef` (useRef) that mirrors `roomIdToDMUserId` state, similar to how channel refs work.

**Step 4: Add `sendDMMessage` function**

```typescript
const sendDMMessage = useCallback(async (targetMatrixUserId: string, text: string) => {
  const client = clientRef.current;
  if (!client || !credentials) return;

  let roomId = dmRoomMapRef.current.get(targetMatrixUserId);

  // Create DM room if it doesn't exist
  if (!roomId) {
    const createResult = await client.createRoom({
      is_direct: true,
      invite: [targetMatrixUserId],
      preset: 'trusted_private_chat' as any,
    });
    roomId = createResult.room_id;

    // Update m.direct account data
    const directEvent = client.getAccountData('m.direct');
    const directContent = (directEvent?.getContent() ?? {}) as Record<string, string[]>;
    directContent[targetMatrixUserId] = [roomId, ...(directContent[targetMatrixUserId] ?? [])];
    await client.setAccountData('m.direct', directContent);

    // Update local state
    setDmRoomMap(prev => new Map(prev).set(targetMatrixUserId, roomId!));
    setRoomIdToDMUserId(prev => new Map(prev).set(roomId!, targetMatrixUserId));
  }

  await client.sendMessage(roomId, { msgtype: MsgType.Text, body: text });
}, [credentials]);
```

**Step 5: Add `fetchDMHistory` function**

```typescript
const fetchDMHistory = useCallback(async (targetMatrixUserId: string) => {
  const client = clientRef.current;
  if (!client) return;

  const roomId = dmRoomMapRef.current.get(targetMatrixUserId);
  if (!roomId) return;

  const room = client.getRoom(roomId);
  if (!room) return;

  const result = await client.scrollback(room, 50);
  if (!result) return;

  const timeline = room.getLiveTimeline().getEvents();
  const messages: ChatMessage[] = timeline
    .filter(e => e.getType() === EventType.RoomMessage)
    .map(e => ({
      id: e.getId() ?? crypto.randomUUID(),
      sender: room.getMember(e.getSender() ?? '')?.name ?? e.getSender() ?? 'Unknown',
      content: e.getContent().body ?? '',
      timestamp: new Date(e.getTs()),
      isSystem: false,
    }));

  setDmMessages(prev => {
    const updated = new Map(prev);
    updated.set(targetMatrixUserId, messages);
    return updated;
  });
}, []);
```

**Step 6: Update return value**

Add the new DM properties to the hook's return:

```typescript
return { messages, sendMessage, fetchHistory, dmMessages, dmRoomMap, sendDMMessage, fetchDMHistory };
```

**Step 7: Build to verify**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors

**Step 8: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts
git commit -m "feat: extend useMatrixClient with DM room discovery, creation, and messaging"
```

---

## Task 6: Update DM routing in App.tsx

Wire up the dual-path DM routing: Matrix for users with `matrixUserId`, Mumble+localStorage for others.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Destructure new DM exports from `useMatrixClient`**

Update the existing `useMatrixClient` destructure (around line 92):

```typescript
const matrixClient = useMatrixClient(matrixCredentials);
// becomes:
const { messages: matrixChannelMessages, sendMessage: sendMatrixMessage, fetchHistory,
        dmMessages: matrixDmMessages, dmRoomMap, sendDMMessage: sendMatrixDM, fetchDMHistory } = useMatrixClient(matrixCredentials) ?? {};
```

Note: Adjust based on how useMatrixClient currently returns — it may return an object or the hook result directly. Match the existing pattern.

**Step 2: Update `handleSendDMMessage` for dual-path routing**

Replace the existing `handleSendDMMessage` (around line 725):

```typescript
const handleSendDMMessage = (content: string) => {
  if (!username || !content || !selectedDMUserId) return;

  // Find the selected user to check for matrixUserId
  const targetUser = users.find(u => String(u.session) === selectedDMUserId);
  const targetMatrixId = targetUser?.matrixUserId;

  if (targetMatrixId && sendMatrixDM) {
    // Matrix path: send via Matrix DM room
    sendMatrixDM(targetMatrixId, content);
  } else {
    // Mumble fallback: send via bridge
    addDMMessage(username, content);
    bridge.send('voice.sendPrivateMessage', {
      message: content,
      targetSession: Number(selectedDMUserId),
    });
  }

  const updated = upsertDMContact(selectedDMUserId, selectedDMUserName, content);
  setDmContacts(mapStoredContacts(updated));
};
```

**Step 3: Update DM message display to use Matrix messages when available**

Where DM messages are rendered (passed to ChatPanel), check if the DM partner has a Matrix user ID and use `matrixDmMessages` instead of localStorage messages:

```typescript
// When computing messages to display for the selected DM:
const selectedUser = users.find(u => String(u.session) === selectedDMUserId);
const matrixId = selectedUser?.matrixUserId;
const activeDmMessages = matrixId && matrixDmMessages?.get(matrixId)
  ? matrixDmMessages.get(matrixId)!
  : dmMessages;
```

Pass `activeDmMessages` to the ChatPanel instead of `dmMessages`.

**Step 4: Fetch Matrix DM history when selecting a DM contact**

In the DM selection handler (where `setSelectedDMUserId` is called), add Matrix history fetch:

```typescript
const handleSelectDMContact = (userId: string, userName: string) => {
  setSelectedDMUserId(userId);
  setSelectedDMUserName(userName);
  markDMContactRead(userId);
  setDmContacts(prev => prev.map(c => c.userId === userId ? { ...c, unread: 0 } : c));

  // Fetch Matrix DM history if available
  const targetUser = users.find(u => String(u.session) === userId);
  if (targetUser?.matrixUserId && fetchDMHistory) {
    fetchDMHistory(targetUser.matrixUserId);
  }
};
```

**Step 5: Build and verify**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: dual-path DM routing — Matrix for Brmble users, Mumble for classic users"
```

---

## Task 7: Handle incoming Matrix DM messages in App.tsx

Update the DM contact list when Matrix DM messages arrive (currently only Mumble messages update contacts).

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add effect to watch `matrixDmMessages` changes**

Add a `useEffect` that watches `matrixDmMessages` and updates the DM contact list:

```typescript
useEffect(() => {
  if (!matrixDmMessages) return;

  for (const [matrixUserId, messages] of matrixDmMessages.entries()) {
    if (messages.length === 0) continue;
    const lastMsg = messages[messages.length - 1];

    // Find the Mumble user matching this Matrix user ID
    const matchedUser = users.find(u => u.matrixUserId === matrixUserId);
    if (!matchedUser) continue;

    const sessionKey = String(matchedUser.session);
    const isViewing = appMode === 'dm' && selectedDMUserId === sessionKey;

    upsertDMContact(sessionKey, matchedUser.name, lastMsg.content, !isViewing);
    setDmContacts(mapStoredContacts(loadDMContacts()));
  }
}, [matrixDmMessages, users, appMode, selectedDMUserId]);
```

**Step 2: Build and verify**

Run: `(cd src/Brmble.Web && npx tsc --noEmit)`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: update DM contacts from incoming Matrix DM messages"
```

---

## Task 8: Manual Integration Testing

Test the full flow end-to-end.

**Step 1: Build everything**

```bash
dotnet build
(cd src/Brmble.Web && npm run build)
```

**Step 2: Run server tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```
Expected: ALL PASS

**Step 3: Run frontend type check**

```bash
(cd src/Brmble.Web && npx tsc --noEmit)
```
Expected: No errors

**Step 4: Manual test checklist**

1. Start Docker environment: `wsl docker compose -f docker-local/docker-compose.yml up -d --build brmble`
2. Start Vite dev server: `(cd src/Brmble.Web && npm run dev)`
3. Start client: `dotnet run --project src/Brmble.Client`
4. Connect to a server with another Brmble user
5. Verify `voice.connected` payload includes `matrixUserId` for Brmble users
6. Open DM with a Brmble user — verify message goes through Matrix (check browser console for Matrix SDK activity)
7. Open DM with a classic Mumble user — verify fallback to Mumble private messages
8. Verify DM contact list shows contacts from both paths
9. Reconnect and verify Matrix DM history loads from server (not localStorage)

**Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address integration test findings"
```
