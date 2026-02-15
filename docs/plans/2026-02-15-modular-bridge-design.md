# Modular Native Bridge Design

## Overview

Refactor the C# ↔ JavaScript bridge to support multiple backend services (voice, chat, screen share) in a modular way.

## Goals

1. **Service namespacing** - Messages prefixed by service name (`voice.`, `matrix.`, `livekit.`)
2. **Event-based naming** - Clean event names (`userJoined` vs `mumbleUser`)
3. **Service abstraction** - Easy to add new services without modifying core bridge
4. **Thin transport** - Keep current pattern, just reorganize

## Architecture

```
Brmble.Client/
├── Bridge/
│   ├── NativeBridge.cs        # C# ↔ JS transport (refactored from WebViewBridge)
│   └── IService.cs            # Interface all services implement
├── Services/
│   └── Voice/
│       ├── VoiceService.cs    # Abstract voice service
│       └── MumbleAdapter.cs  # MumbleSharp implementation
└── Program.cs                 # Wires bridge + services
```

## Message Protocol

### Voice Service Messages

**Frontend → Backend:**
- `voice.connect` - Connect to voice server
- `voice.disconnect` - Disconnect
- `voice.joinChannel` - Join a channel
- `voice.leaveChannel` - Leave current channel
- `voice.sendMessage` - Send text message

**Backend → Frontend:**
- `voice.connected` - Successfully connected
- `voice.disconnected` - Disconnected
- `voice.userJoined` - User joined
- `voice.userLeft` - User left
- `voice.channelJoined` - Joined channel
- `voice.message` - Received message
- `voice.error` - Error occurred

### Data Structures

```typescript
// voice.connect
{ host: string, port: number, username: string, password?: string }

// voice.userJoined  
{ session: number, name: string, channelId: number, self?: boolean }

// voice.channelJoined
{ id: number, name: string }
```

## Implementation Notes

1. Keep bridge thin - just transport, no business logic
2. Services handle protocol specifics (MumbleSharp, Matrix SDK, etc.)
3. Events emitted by services, bridge forwards to JS
4. UI thread marshaling already implemented (keep it)

## Testing

1. Verify voice connect/disconnect works
2. Verify channel list displays
3. Verify user list displays
4. Verify join channel works

## Future Extensions

Adding Matrix chat:
- Add `matrix.connect`, `matrix.sendMessage`, etc.
- New `MatrixAdapter` implementing `IService`

## Status

- Design approved: 2026-02-15
- Implementation: Pending
