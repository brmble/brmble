# mTLS Auth + Matrix SDK Frontend Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `POST /auth/token` to use mTLS (client certificate in TLS handshake instead of request body), then wire up `matrix-js-sdk` in the React frontend so channel chat is driven by Matrix rather than localStorage.

**Architecture:** C# `MumbleAdapter.FetchAndSendCredentials` gets a small refactor — a new `internal static FetchCredentials` helper (testable without WebView2) does the HTTP work using `HttpClientHandler` with the client cert attached. The frontend gains a `useMatrixClient` hook that owns the Matrix SDK lifecycle; `App.tsx` wires credentials → hook → ChatPanel. Sends are dual-posted (Mumble bridge + Matrix SDK). Incoming channel messages come from the Matrix sync loop only; `voice.message` channel handling is removed.

**Tech Stack:** C# / MSTest, React 19 / TypeScript / Vite, vitest, @testing-library/react, matrix-js-sdk

---

### Task 1: Refactor `FetchAndSendCredentials` for mTLS

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Create: `tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs`

**Background:** The current method sends `{ certHash }` in the request body. The server now reads the cert hash from the TLS handshake via `MtlsCertificateHashExtractor`. We extract the HTTP logic into an `internal static FetchCredentials` method so it can be tested without needing a full `MumbleAdapter` instance (which requires WebView2).

**Step 1: Create test file with a `FakeHttpMessageHandler` and a test for the success path**

Create `tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs`:

```csharp
using System.Net;
using System.Text;
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

internal sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly HttpResponseMessage _response;
    private readonly Action<HttpRequestMessage>? _onSend;

    public FakeHttpMessageHandler(HttpResponseMessage response, Action<HttpRequestMessage>? onSend = null)
    {
        _response = response;
        _onSend = onSend;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        _onSend?.Invoke(request);
        return Task.FromResult(_response);
    }
}

[TestClass]
public class MumbleAdapterCredentialsTests
{
    private static readonly string ValidJson = """
        {"matrix":{"homeserverUrl":"https://matrix.example.com","accessToken":"tok_abc","userId":"@1:example.com","roomMap":{"42":"!room:example.com"}},"livekit":null}
        """;

    [TestMethod]
    public async Task FetchCredentials_Success_ReturnsCredentialsElement()
    {
        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(ValidJson, Encoding.UTF8, "application/json")
        });
        using var http = new HttpClient(handler);

        var result = await MumbleAdapter.FetchCredentials("https://api.example.com", http);

        Assert.IsNotNull(result);
        Assert.IsTrue(result.Value.TryGetProperty("matrix", out _));
    }

    [TestMethod]
    public async Task FetchCredentials_Unauthorized_ReturnsNull()
    {
        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.Unauthorized));
        using var http = new HttpClient(handler);

        var result = await MumbleAdapter.FetchCredentials("https://api.example.com", http);

        Assert.IsNull(result);
    }

    [TestMethod]
    public async Task FetchCredentials_SendsPostToAuthToken()
    {
        HttpRequestMessage? captured = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(ValidJson, Encoding.UTF8, "application/json")
            },
            req => captured = req);
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.example.com") };

        await MumbleAdapter.FetchCredentials("https://api.example.com", http);

        Assert.IsNotNull(captured);
        Assert.AreEqual(HttpMethod.Post, captured!.Method);
        Assert.IsNull(captured.Content); // empty body — identity comes from TLS handshake
    }
}
```

**Step 2: Run tests to confirm they fail**

```
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "MumbleAdapterCredentialsTests"
```

Expected: compile error — `MumbleAdapter.FetchCredentials` does not exist yet.

**Step 3: Add `FetchCredentials` internal static method and update `FetchAndSendCredentials` in `MumbleAdapter`**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, replace the existing `FetchAndSendCredentials` method (around line 561) with:

```csharp
/// <summary>
/// Pure HTTP helper: POSTs to /auth/token and returns the parsed response body.
/// Body is empty — identity comes from the TLS client certificate attached to <paramref name="httpClient"/>.
/// Returns null on any non-success status.
/// </summary>
internal static async Task<System.Text.Json.JsonElement?> FetchCredentials(string apiUrl, HttpClient httpClient)
{
    var response = await httpClient.PostAsync($"{apiUrl}/auth/token", content: null);
    if (!response.IsSuccessStatusCode)
        return null;

    var json = await response.Content.ReadAsStringAsync();
    using var doc = System.Text.Json.JsonDocument.Parse(json);
    return doc.RootElement.Clone();
}

private async Task FetchAndSendCredentials(string apiUrl)
{
    var cert = _certService?.ActiveCertificate;
    if (cert is null)
    {
        _bridge?.Send("voice.error", new { message = "No client certificate — cannot fetch Matrix credentials." });
        _bridge?.NotifyUiThread();
        return;
    }

    try
    {
        var handler = new HttpClientHandler();
        handler.ClientCertificates.Add(cert);
        handler.ServerCertificateCustomValidationCallback =
            HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;

        using var http = new HttpClient(handler);
        var credentials = await FetchCredentials(apiUrl, http);
        if (credentials is null)
        {
            Debug.WriteLine($"[Brmble] Auth token request to {apiUrl} returned non-success");
            return;
        }

        _bridge?.Send("server.credentials", credentials.Value);
        _bridge?.NotifyUiThread();
        _apiUrl = apiUrl;
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[Brmble] Failed to fetch credentials from {apiUrl}: {ex.Message}");
    }
}
```

**Step 4: Run tests to confirm they pass**

```
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "MumbleAdapterCredentialsTests"
```

Expected: 3 tests pass.

**Step 5: Run full test suite to check for regressions**

```
dotnet test
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git add tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs
git commit -m "fix: present Mumble client cert via mTLS for /auth/token (#111)"
```

---

### Task 2: Install test framework and matrix-js-sdk

**Files:**
- Modify: `src/Brmble.Web/package.json`
- Modify: `src/Brmble.Web/vite.config.ts`
- Create: `src/Brmble.Web/src/test-setup.ts`

**Background:** The project has no frontend test runner yet. We add vitest (Vite-native, zero config) and `@testing-library/react` for hook tests. We also install `matrix-js-sdk`.

**Step 1: Install packages**

```bash
(cd src/Brmble.Web && npm install matrix-js-sdk)
(cd src/Brmble.Web && npm install -D vitest jsdom @testing-library/react @testing-library/user-event @vitest/coverage-v8)
```

**Step 2: Update `vite.config.ts` to add test config**

Replace the contents of `src/Brmble.Web/vite.config.ts`:

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

**Step 3: Create test setup file**

Create `src/Brmble.Web/src/test-setup.ts`:

```typescript
import '@testing-library/react';
```

**Step 4: Add test script to `package.json`**

In `src/Brmble.Web/package.json`, add to the `scripts` section:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 5: Verify vitest works**

```bash
(cd src/Brmble.Web && npm test)
```

Expected: "No test files found" — that's fine, it confirms vitest is configured.

**Step 6: Verify the app still builds**

```bash
(cd src/Brmble.Web && npm run build)
```

Expected: build succeeds.

**Step 7: Commit**

```bash
git add src/Brmble.Web/package.json src/Brmble.Web/package-lock.json src/Brmble.Web/vite.config.ts src/Brmble.Web/src/test-setup.ts
git commit -m "feat: add vitest and matrix-js-sdk"
```

---

### Task 3: Create `useMatrixClient` hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Create: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

**Background:** This hook owns the entire Matrix SDK lifecycle. It is the only place in the app that imports from `matrix-js-sdk`.

**Step 1: Write the failing tests**

Create `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMatrixClient } from './useMatrixClient';
import type { MatrixCredentials } from './useMatrixClient';

// --- mock matrix-js-sdk ---
const mockClient = {
  startClient: vi.fn(),
  stopClient: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getRoom: vi.fn(),
  scrollback: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue({}),
};

vi.mock('matrix-js-sdk', () => ({
  createClient: vi.fn(() => mockClient),
  RoomEvent: { Timeline: 'Room.timeline' },
  EventType: { RoomMessage: 'm.room.message' },
}));

const creds: MatrixCredentials = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'tok_abc',
  userId: '@1:example.com',
  roomMap: { '42': '!room:example.com' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMatrixClient', () => {
  it('calls startClient when credentials are provided', () => {
    renderHook(() => useMatrixClient(creds));
    expect(mockClient.startClient).toHaveBeenCalledWith({ initialSyncLimit: 20 });
  });

  it('does not call startClient when credentials are null', () => {
    renderHook(() => useMatrixClient(null));
    expect(mockClient.startClient).not.toHaveBeenCalled();
  });

  it('calls stopClient on unmount', () => {
    const { unmount } = renderHook(() => useMatrixClient(creds));
    unmount();
    expect(mockClient.stopClient).toHaveBeenCalled();
  });

  it('calls stopClient and clears messages when credentials become null', () => {
    const { result, rerender } = renderHook(
      ({ c }: { c: MatrixCredentials | null }) => useMatrixClient(c),
      { initialProps: { c: creds } }
    );
    act(() => rerender({ c: null }));
    expect(mockClient.stopClient).toHaveBeenCalled();
    expect(result.current.messages.size).toBe(0);
  });

  it('registers RoomEvent.Timeline listener', () => {
    renderHook(() => useMatrixClient(creds));
    expect(mockClient.on).toHaveBeenCalledWith('Room.timeline', expect.any(Function));
  });

  it('sendMessage posts to correct Matrix room', async () => {
    const { result } = renderHook(() => useMatrixClient(creds));
    await act(() => result.current.sendMessage('42', 'hello'));
    expect(mockClient.sendMessage).toHaveBeenCalledWith('!room:example.com', {
      msgtype: 'm.text',
      body: 'hello',
    });
  });

  it('sendMessage does nothing when channelId has no room mapping', async () => {
    const { result } = renderHook(() => useMatrixClient(creds));
    await act(() => result.current.sendMessage('999', 'hello'));
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
  });

  it('fetchHistory calls scrollback on the room', async () => {
    const mockRoom = { roomId: '!room:example.com' };
    mockClient.getRoom.mockReturnValue(mockRoom);
    const { result } = renderHook(() => useMatrixClient(creds));
    await act(() => result.current.fetchHistory('42'));
    expect(mockClient.scrollback).toHaveBeenCalledWith(mockRoom, 50);
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
(cd src/Brmble.Web && npm test)
```

Expected: all 8 tests fail — `useMatrixClient` does not exist yet.

**Step 3: Implement the hook**

Create `src/Brmble.Web/src/hooks/useMatrixClient.ts`:

```typescript
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient, RoomEvent, EventType } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { ChatMessage } from '../types';

export interface MatrixCredentials {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  roomMap: Record<string, string>; // mumbleChannelId → matrixRoomId
}

export function useMatrixClient(credentials: MatrixCredentials | null) {
  const clientRef = useRef<MatrixClient | null>(null);
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  // Reverse lookup: matrixRoomId → mumbleChannelId
  const roomIdToChannelId = useMemo(() => {
    if (!credentials) return new Map<string, string>();
    return new Map(
      Object.entries(credentials.roomMap).map(([channelId, roomId]) => [roomId, channelId])
    );
  }, [credentials]);

  useEffect(() => {
    if (!credentials) {
      clientRef.current?.stopClient();
      clientRef.current = null;
      setMessages(new Map());
      return;
    }

    const client = createClient({
      baseUrl: credentials.homeserverUrl,
      accessToken: credentials.accessToken,
      userId: credentials.userId,
    });

    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      if (event.getType() !== EventType.RoomMessage) return;
      const channelId = roomIdToChannelId.get(room?.roomId ?? '');
      if (!channelId) return;

      const content = event.getContent() as { body?: string };
      const message: ChatMessage = {
        id: event.getId() ?? crypto.randomUUID(),
        channelId,
        sender: event.getSender() ?? 'Unknown',
        content: content.body ?? '',
        timestamp: new Date(event.getTs()),
      };

      setMessages(prev => {
        const next = new Map(prev);
        next.set(channelId, [...(next.get(channelId) ?? []), message]);
        return next;
      });
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.startClient({ initialSyncLimit: 20 });
    clientRef.current = client;

    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
      client.stopClient();
      clientRef.current = null;
    };
  }, [credentials, roomIdToChannelId]);

  const sendMessage = useCallback(async (channelId: string, text: string) => {
    if (!credentials || !clientRef.current) return;
    const roomId = credentials.roomMap[channelId];
    if (!roomId) return;
    await clientRef.current.sendMessage(roomId, { msgtype: 'm.text', body: text });
  }, [credentials]);

  const fetchHistory = useCallback(async (channelId: string) => {
    if (!credentials || !clientRef.current) return;
    const roomId = credentials.roomMap[channelId];
    if (!roomId) return;
    const room = clientRef.current.getRoom(roomId);
    if (!room) return;
    await clientRef.current.scrollback(room, 50);
  }, [credentials]);

  return { messages, sendMessage, fetchHistory };
}
```

**Step 4: Run tests to confirm they pass**

```bash
(cd src/Brmble.Web && npm test)
```

Expected: all 8 tests pass.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat: add useMatrixClient hook for Matrix SDK lifecycle (#104)"
```

---

### Task 4: Wire `server.credentials` and Matrix messages into `App.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Background:** `App.tsx` needs to:
1. Listen for `server.credentials` from the bridge → store as `matrixCredentials` state
2. Clear credentials on `voice.disconnected`
3. Call `useMatrixClient(matrixCredentials)` and use its `messages`, `sendMessage`, `fetchHistory`
4. Pass Matrix messages to the channel `ChatPanel` when available (fallback to `useChatStore`)
5. Dual-post channel sends (Mumble bridge + Matrix SDK)
6. Remove channel message handling from the `voice.message` handler (keep only DM handling)
7. Call `fetchHistory` when the active channel changes

**Step 1: Add the `MatrixCredentials` import and state to `App.tsx`**

At the top of `App.tsx`, add the import:

```typescript
import { useMatrixClient } from './hooks/useMatrixClient';
import type { MatrixCredentials } from './hooks/useMatrixClient';
```

Inside `function App()`, add the state (after the existing `useState` declarations):

```typescript
const [matrixCredentials, setMatrixCredentials] = useState<MatrixCredentials | null>(null);
const matrixClient = useMatrixClient(matrixCredentials);
```

**Step 2: Register `server.credentials` bridge handler in the main `useEffect`**

Inside the large bridge registration `useEffect` (around line 226), add alongside the other handler registrations:

```typescript
const onServerCredentials = (data: unknown) => {
  const d = data as MatrixCredentials | undefined;
  if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
    setMatrixCredentials(d);
  }
};
```

Register and deregister it:
```typescript
bridge.on('server.credentials', onServerCredentials);
// ... in the return cleanup:
bridge.off('server.credentials', onServerCredentials);
```

Also update `onVoiceDisconnected` to clear credentials:

```typescript
const onVoiceDisconnected = () => {
  // ... existing lines ...
  setMatrixCredentials(null);  // add this line
};
```

**Step 3: Remove channel message handling from `voice.message` handler**

Find `onVoiceMessage` (around line 273). It currently handles both channel messages and DMs. Remove the channel message section (everything after the private message early return). The handler should only handle DMs:

```typescript
const onVoiceMessage = ((data: unknown) => {
  const d = data as {
    message: string;
    senderSession?: number;
    channelIds?: number[];
    sessions?: number[];
  } | undefined;
  if (!d?.message) return;

  const selfUser = usersRef.current.find(u => u.self);
  if (selfUser && d.senderSession === selfUser.session) return;
  if (d.senderSession === undefined) return;

  const senderUser = usersRef.current.find(u => u.session === d.senderSession);
  const senderName = senderUser?.name || 'Unknown';

  // Only handle private/DM messages — channel messages come through Matrix SDK
  const isPrivateMessage = d.sessions && d.sessions.length > 0 &&
    (!d.channelIds || d.channelIds.length === 0);
  if (!isPrivateMessage) return;

  const senderSession = String(d.senderSession);
  const dmStoreKey = `dm-${senderSession}`;

  const isViewingThisDM = appModeRef.current === 'dm' &&
    selectedDMUserIdRef.current === senderSession;

  if (isViewingThisDM) {
    addDMMessageRef.current(senderName, d.message);
  } else {
    addMessageToStore(dmStoreKey, senderName, d.message);
  }

  const updated = upsertDMContact(senderSession, senderName, d.message, !isViewingThisDM);
  setDmContacts(mapStoredContacts(updated));
});
```

**Step 4: Update `handleSendMessage` to dual-post**

Find `handleSendMessage` (around line 613). Update it to dual-post when Matrix is available, and skip adding a local echo for channel messages (the Matrix sync loop will echo it back):

```typescript
const handleSendMessage = (content: string) => {
  if (!username || !content) return;

  const isMatrixChannel = currentChannelId &&
    currentChannelId !== 'server-root' &&
    matrixCredentials?.roomMap[currentChannelId] !== undefined;

  // Only add local echo when Matrix is not available for this channel
  if (!isMatrixChannel) {
    addMessage(username, content);
  }

  if (currentChannelId === 'server-root') {
    bridge.send('voice.sendMessage', { message: content, channelId: 0 });
  } else if (currentChannelId) {
    bridge.send('voice.sendMessage', { message: content, channelId: Number(currentChannelId) });
    if (isMatrixChannel) {
      matrixClient.sendMessage(currentChannelId, content).catch(console.error);
    }
  }

  setUnreadCount(0);
  updateBadge(0, hasPendingInvite);
};
```

**Step 5: Fetch history when channel changes**

Add a `useEffect` that calls `fetchHistory` when `currentChannelId` changes and Matrix is available:

```typescript
useEffect(() => {
  if (currentChannelId && currentChannelId !== 'server-root' && matrixCredentials) {
    matrixClient.fetchHistory(currentChannelId).catch(console.error);
  }
}, [currentChannelId, matrixCredentials]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Step 6: Use Matrix messages in the channel `ChatPanel`**

Find the first `ChatPanel` usage (the channel chat, around line 743). Update its `messages` prop to use Matrix messages when available, falling back to `useChatStore`:

```typescript
const activeChannelId = currentChannelId && currentChannelId !== 'server-root'
  ? currentChannelId
  : undefined;
const matrixMessages = activeChannelId
  ? matrixClient.messages.get(activeChannelId)
  : undefined;

// In the JSX:
<ChatPanel
  channelId={currentChannelId || undefined}
  channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
  messages={matrixMessages ?? messages}
  currentUsername={username}
  onSendMessage={handleSendMessage}
/>
```

**Step 7: Verify the app builds**

```bash
(cd src/Brmble.Web && npm run build)
```

Expected: build succeeds with no TypeScript errors.

**Step 8: Run all tests**

```bash
dotnet test
(cd src/Brmble.Web && npm test)
```

Expected: all tests pass.

**Step 9: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire Matrix SDK into App.tsx — credentials, dual-post, channel messages (#104)"
```

---

## Verification

After all tasks are complete:

1. Build the full solution: `dotnet build`
2. Run all tests: `dotnet test && (cd src/Brmble.Web && npm test)`
3. Manual smoke test (if Brmble server is available):
   - Connect to a Brmble server → check devtools network tab for `POST /auth/token` (should have no request body)
   - Send a channel message → verify it appears via Matrix sync (not just local echo)
   - Disconnect and reconnect → Matrix client reinitialises cleanly
