# Serverlist Feature Design

## Overview

Add a serverlist feature that allows users to save, manage, and connect to multiple Mumble servers. Each entry stores a friendly label, server address, port, and username. Data is persisted locally in the C# client for consistency with certificate storage.

## Data Model

```json
// %AppData%/Brmble/servers.json
{
  "servers": [
    {
      "id": "uuid",
      "label": "My Mumble Server",
      "host": "mumble.example.com",
      "port": 64738,
      "username": "Player1"
    }
  ]
}
```

## Architecture

### C# Layer
- **ServerlistService.cs** - Located in `Services/Serverlist/`
  - Loads/saves to `%AppData%/Brmble/servers.json`
  - CRUD operations: list, add, update, remove
  - Implements `IService` interface for bridge integration

### Bridge Protocol
| Message | Direction | Purpose |
|---------|-----------|---------|
| `servers.list` | C# → JS | Get all servers |
| `servers.add` | JS → C# | Add new server |
| `servers.update` | JS → C# | Edit existing server |
| `servers.remove` | JS → C# | Delete server |

### Frontend (React)
- ServerList component for displaying saved servers
- ServerEditDialog for adding/editing entries
- Integration with existing connection flow

### Integration Points
- Connect button uses selected server's host/port/username
- MumbleAdapter already accepts these parameters - no changes needed

## File Changes

### New Files
- `src/Brmble.Client/Services/Serverlist/ServerlistService.cs`
- `src/Brmble.Client/Services/Serverlist/IServerlistService.cs`

### Modified Files
- `src/Brmble.Client/Program.cs` - Register ServerlistService
- `src/Brmble.Client/Bridge/NativeBridge.cs` - Add message handlers
- React components (TBD based on existing UI patterns)

## Security Considerations

- Usernames are stored in plain JSON (not sensitive)
- Certificate remains separate in `%AppData%/Brmble/identity.pfx`
- No passwords stored (Mumble uses certificate auth)
