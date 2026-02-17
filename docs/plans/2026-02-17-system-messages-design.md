# System Messages in Server Root Chat

## Summary

Display server system messages (welcome text, user joins/leaves, kicks/bans, connecting status) in the server root chat panel. Uses a single `voice.system` bridge event from C# to JS. System messages render as "Server" sender bubbles with a distinct visual style.

## Requirements

- Show "Connecting to server X" when initiating connection
- Show Mumble server welcome message (HTML rendered as-is)
- Show all user connects/disconnects server-wide (not channel-specific)
- Show kick/ban detail when self is removed (actor name + reason)
- Show other users' disconnects as simple "{name} disconnected" messages
- Do NOT show messages sent to voice channels or private messages
- All system messages route to `server-root` store only

## Bridge Protocol

New event: `voice.system`

```json
{
  "type": "voice.system",
  "data": {
    "message": "Welcome to My Server! <b>Rules:</b> Be nice.",
    "systemType": "welcome | userJoined | userLeft | kicked | banned | connecting",
    "html": true
  }
}
```

### System Types and Sources

| systemType   | C# Source                     | Message Format                                    | html  |
|-------------|-------------------------------|---------------------------------------------------|-------|
| connecting  | Connect()                     | "Connecting to {host}:{port}..."                  | false |
| welcome     | ServerSync()                  | serverSync.WelcomeText (raw)                      | true  |
| welcome     | ServerConfig() (new override) | serverConfig.WelcomeText if changed               | true  |
| userJoined  | UserState() (new user only)   | "{username} connected to the server"              | false |
| userLeft    | UserRemove() (non-kick)       | "{username} disconnected from the server"         | false |
| kicked      | UserRemove() (kick, self)     | "You were kicked by {actor}: {reason}"            | false |
| banned      | UserRemove() (ban, self)      | "You were banned by {actor}: {reason}"            | false |

## Frontend Data Model

Extend `ChatMessage` interface:

```typescript
export interface ChatMessage {
  id: string;
  channelId: string;
  sender: string;       // "Server" for system messages
  content: string;       // may be HTML for welcome
  timestamp: Date;
  type?: 'system';       // undefined = normal user message
  html?: boolean;        // if true, render as HTML
}
```

Extend `addMessage()` and `addMessageToStore()` to accept optional `type` and `html` parameters.

## Frontend Rendering

Reuse existing `MessageBubble` component with a system variant:

- **Sender:** "Server"
- **Avatar:** "S" with muted accent color
- **CSS:** `.message-bubble--system` modifier — slightly different background tint
- **HTML content:** `dangerouslySetInnerHTML` when `html` flag is true
- **isOwnMessage:** Always false

## C# Changes

### New helper method
`SendSystemMessage(string message, string systemType, bool html = false)` — sends `voice.system` bridge event.

### Connect()
Emit `connecting` system message before starting Mumble connection.

### ServerSync() override
After sending `voice.connected`, emit `welcome` if `WelcomeText` is non-empty.

### New ServerConfig() override
Emit `welcome` if `WelcomeText` is non-empty and differs from last known.

### UserState() override
Detect genuinely new users (not state updates) and emit `userJoined`. Check user existence in `UserDictionary` before calling `base.UserState()`.

### UserRemove() override
Look up user name before `base.UserRemove()`. Then:
- Self + Ban → `banned` with actor + reason
- Self + no Ban → `kicked` with actor + reason
- Other user → `userLeft`

## JS Handler (App.tsx)

New `onVoiceSystem` handler registered on `voice.system`:
- Always routes to `server-root` store
- Uses `addMessageRef` if currently viewing server-root, `addMessageToStore` otherwise
- Passes `type: 'system'` and `html` flag through to the store

## Scope Exclusions

- No private message display
- No channel-specific text message display (voice channel chats remain local-only)
- No permission denied or channel remove events (can add later)
