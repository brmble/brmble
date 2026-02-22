# Design: mTLS Auth + Matrix SDK Frontend Integration

**Issues:** #111 (mTLS client cert), #104 (Matrix SDK frontend)
**Date:** 2026-02-22

---

## Overview

Two issues form one end-to-end flow:

1. **#111** — Fix `FetchAndSendCredentials` in `MumbleAdapter` to present the Mumble client certificate via mTLS instead of sending the cert hash in the request body.
2. **#104** — Integrate `matrix-js-sdk` in the frontend: receive `server.credentials`, initialise a `MatrixClient` with a full sync loop, use Matrix as the source of truth for channel chat, dual-post sends to both Mumble and Matrix.

The server-side (`/auth/token`) already extracts the cert hash from the TLS handshake and is unchanged.

---

## Section 1 — C# mTLS fix (#111)

**File:** `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

Replace the `certHash`-in-body approach in `FetchAndSendCredentials` with mTLS:

- Attach `CertificateService.ActiveCertificate` (`X509Certificate2`) to an `HttpClientHandler`
- Send an empty POST body — identity comes from the TLS handshake
- Use `DangerousAcceptAnyServerCertificateValidator` unconditionally (Brmble server is always operator-controlled)

```csharp
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
        var response = await http.PostAsync($"{apiUrl}/auth/token", content: null);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var credentials = doc.RootElement.Clone();

        _bridge?.Send("server.credentials", credentials);
        _bridge?.NotifyUiThread();

        _apiUrl = apiUrl;
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[Brmble] Failed to fetch credentials from {apiUrl}: {ex.Message}");
    }
}
```

**Error handling:**
- No certificate → `voice.error` + return
- HTTP 401 → silent debug log (cert not yet provisioned, will succeed on next connect)
- Network error / non-2xx → silent debug log (app continues as voice-only Mumble client)

---

## Section 2 — `useMatrixClient` hook (#104)

**New file:** `src/Brmble.Web/src/hooks/useMatrixClient.ts`

Owns the full Matrix SDK lifecycle. `App.tsx` calls this hook; no other component touches the SDK directly.

### Interface

```typescript
interface MatrixCredentials {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  roomMap: Record<string, string>; // mumbleChannelId → matrixRoomId
}

function useMatrixClient(credentials: MatrixCredentials | null): {
  messages: Map<string, ChatMessage[]>;
  sendMessage: (channelId: string, text: string) => Promise<void>;
  fetchHistory: (channelId: string) => Promise<void>;
}
```

### Lifecycle

1. `credentials` received → create `MatrixClient`, call `startClient({ initialSyncLimit: 20 })`
2. Listen to `RoomEvent.Timeline` → map event to channel via reverse `roomMap` lookup → append to `messages`
3. `credentials` cleared (disconnect) → `stopClient()`, dispose client, clear messages

### App.tsx changes

- Register `server.credentials` bridge handler → set `matrixCredentials` state
- Call `useMatrixClient(matrixCredentials)`
- Pass `{ sendMessage, fetchHistory, messages }` to `ChatPanel` for the active channel
- Clear `matrixCredentials` on `voice.disconnected`

### ChatPanel changes

- When Matrix messages are available for the active channel, show them (replaces `useChatStore` channel messages)
- **On send** → dual-post:
  1. `bridge.send('voice.sendMessage', { message, channelId })` — reaches non-Brmble Mumble clients
  2. `sendMessage(channelId, text)` — posts to Matrix room
- **On channel click** → call `fetchHistory(channelId)`

### voice.message handler

- Channel message handling **removed** — the server-side Mumble→Matrix bridge already relays all channel messages (including from non-Brmble clients) into Matrix rooms. The frontend receives everything through the Matrix SDK sync loop.
- DM handling (`sessions`-based messages) **kept** — until Matrix DMs are implemented (#112)
- `voice.system` **unchanged**

### useChatStore

- Channel chat: no longer used (replaced by Matrix SDK messages)
- DM chat: unchanged (localStorage, until #112)

---

## Section 3 — Error handling

| Scenario | Behaviour |
|---|---|
| `startClient()` throws | Log, client stays null, `voice.message` DM handler remains active |
| `sendMessage()` fails | Log; Mumble send already went through, message not lost |
| `fetchHistory()` fails | Log, show empty history |
| Disconnect | `stopClient()`, clear credentials + messages state |
| Reconnect | New `server.credentials` → reinitialise client fresh |
| Plain Mumble server (no Brmble) | `server.credentials` never arrives → `matrixCredentials` null → zero Matrix code runs, no regression |

---

## Section 4 — Testing

### C# (#111)

- `MumbleAdapterCredentialsTests`: verify `FetchAndSendCredentials` attaches `ActiveCertificate` to the handler and sends an empty body, using a mock `HttpMessageHandler`

### Frontend (#104)

- `useMatrixClient`: test `startClient()` called on credentials, `stopClient()` on null, message state updated on `RoomEvent.Timeline`
- `ChatPanel`: test dual-post — both `bridge.send('voice.sendMessage')` and `sendMessage()` invoked on submit

---

## Out of scope

- Matrix DMs → tracked in #112 (requires Matrix user IDs in `voice.connected` user list)
