# Brmblegotchi Remote Viewing - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to view other users' Brmblegotchi pets via right-click context menu, with real-time status sync when pet actions occur.

**Architecture:** Extend the existing WebSocket infrastructure. Pet state is server-authoritative (stored in SQLite). Two sync mechanisms:
1. **Action-based**: Instant broadcast when owner feeds/plays/cleans
2. **Decay sync**: Every 10 minutes, server sends current stats + decay rates; client animates bars smoothly

**Sync Protocol:**
| Event | Trigger | Data Sent |
|-------|---------|-----------|
| Pet action | User clicks feed/play/clean | Full state update → viewer sees bar jump |
| Decay sync | Every 10 minutes | Stats + decay rates → client animates bars down |

**Bandwidth**: ~100 bytes per watched pet every 10 minutes = negligible

**Tech Stack:** ASP.NET Core (server), SQLite with Dapper (persistence), WebView2 bridge (C# ↔ JS), React (frontend)

---

## Phase 1: Server-Side Backend

### Task 1: Database Schema for Pet State

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs:18-56`

**Step 1: Add pet_state table migration**

```csharp
// Add after existing migrations (after line 55)
// Migrate: add pet_state table
var hasPetState = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('pet_state')");
if (hasPetState == 0)
    conn.Execute("""
        CREATE TABLE IF NOT EXISTS pet_state (
            user_id          INTEGER NOT NULL PRIMARY KEY,
            hunger           REAL NOT NULL DEFAULT 80,
            happiness        REAL NOT NULL DEFAULT 75,
            cleanliness      REAL NOT NULL DEFAULT 85,
            last_action_time INTEGER NOT NULL DEFAULT 0,
            updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """);
```

**Step 2: Commit**
```bash
git add src/Brmble.Server/Data/Database.cs
git commit -m "feat(server): add pet_state table for Brmblegotchi persistence"
```

---

### Task 2: Pet State Repository

**Files:**
- Create: `src/Brmble.Server/Pet/PetStateRepository.cs`
- Create: `src/Brmble.Server/Pet/IPetStateRepository.cs`

**Decay Constants** (matching frontend):
```csharp
public static class PetDecayRates
{
    public const double HungerPerSecond = 0.0069;
    public const double HappinessPerSecond = 0.0139;
    public const double CleanlinessPerSecond = 0.0278;
}
```

**Step 1: Write the interface**

```csharp
namespace Brmble.Server.Pet;

public interface IPetStateRepository
{
    Task<PetState?> GetByUserIdAsync(long userId);
    Task UpsertAsync(long userId, PetState state);
    Task RecordActionAsync(long userId, string action);
}

public record PetState(
    double Hunger,
    double Happiness,
    double Cleanliness,
    long LastActionTime
);

public record PetStateWithDecay(
    double Hunger,
    double Happiness,
    double Cleanliness,
    double HungerDecayRate,
    double HappinessDecayRate,
    double CleanlinessDecayRate,
    long LastActionTime
);
```

**Step 2: Write the implementation**

```csharp
using Dapper;

namespace Brmble.Server.Pet;

public class PetStateRepository : IPetStateRepository
{
    private readonly Database _db;

    public PetStateRepository(Database db)
    {
        _db = db;
    }

    public async Task<PetState?> GetByUserIdAsync(long userId)
    {
        using var conn = _db.CreateConnection();
        var row = await conn.QueryFirstOrDefaultAsync<PetStateRow>(
            "SELECT hunger, happiness, cleanliness, last_action_time FROM pet_state WHERE user_id = @UserId",
            new { UserId = userId });
        
        return row is null ? null : new PetState(row.Hunger, row.Happiness, row.Cleanliness, row.LastActionTime);
    }

    public async Task UpsertAsync(long userId, PetState state)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync("""
            INSERT INTO pet_state (user_id, hunger, happiness, cleanliness, last_action_time, updated_at)
            VALUES (@UserId, @Hunger, @Happiness, @Cleanliness, @LastActionTime, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                hunger = @Hunger,
                happiness = @Happiness,
                cleanliness = @Cleanliness,
                last_action_time = @LastActionTime,
                updated_at = CURRENT_TIMESTAMP
            """, new { UserId = userId, state.Hunger, state.Happiness, state.Cleanliness, state.LastActionTime });
    }

    public async Task RecordActionAsync(long userId, string action)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE pet_state SET last_action_time = @Time, updated_at = CURRENT_TIMESTAMP WHERE user_id = @UserId",
            new { UserId = userId, Time = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
    }

    private record PetStateRow(double Hunger, double Happiness, double Cleanliness, long LastActionTime);
}
```

**Step 3: Commit**
```bash
git add src/Brmble.Server/Pet/IPetStateRepository.cs src/Brmble.Server/Pet/PetStateRepository.cs
git commit -m "feat(server): add PetStateRepository for pet persistence"
```

---

### Task 3: Pet WebSocket Message Handler + Decay Sync Service

**Files:**
- Modify: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs:43-64`
- Create: `src/Brmble.Server/Pet/PetWebSocketHandler.cs`
- Create: `src/Brmble.Server/Pet/PetDecaySyncService.cs` (background service)

**Step 1: Create PetWebSocketHandler**

```csharp
using System.Text;
using System.Text.Json;
using Brmble.Server.Events;

namespace Brmble.Server.Pet;

public class PetWebSocketHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly IBrmbleEventBus _eventBus;
    private readonly ISessionMappingService _sessionMapping;
    private readonly IPetStateRepository _petState;
    private readonly ConcurrentDictionary<WebSocket, long> _watchingPets = new();

    public PetWebSocketHandler(
        IBrmbleEventBus eventBus,
        ISessionMappingService sessionMapping,
        IPetStateRepository petState)
    {
        _eventBus = eventBus;
        _sessionMapping = sessionMapping;
        _petState = petState;
    }

    public async Task HandleMessageAsync(WebSocket ws, long userId, JsonElement data)
    {
        var type = data.GetProperty("type").GetString();

        switch (type)
        {
            case "getPetState":
                await HandleGetPetStateAsync(ws, userId, data);
                break;
            case "feed":
            case "play":
            case "clean":
                await HandlePetActionAsync(userId, type);
                break;
            case "watchPet":
                await HandleWatchPetAsync(ws, userId, data);
                break;
            case "unwatchPet":
                _watchingPets.TryRemove(ws, out _);
                break;
        }
    }

    private async Task HandleGetPetStateAsync(WebSocket ws, long userId, JsonElement data)
    {
        var targetUserId = data.GetProperty("userId").GetInt64();
        var state = await _petState.GetByUserIdAsync(targetUserId);
        
        // Include decay rates in response
        var stateWithDecay = new PetStateWithDecay(
            state.Hunger,
            state.Happiness,
            state.Cleanliness,
            PetDecayRates.HungerPerSecond,
            PetDecayRates.HappinessPerSecond,
            PetDecayRates.CleanlinessPerSecond,
            state.LastActionTime
        );
        
        var response = new { type = "petState", userId = targetUserId, state = stateWithDecay };
        var json = JsonSerializer.Serialize(response, JsonOptions);
        await ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(json)), WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private async Task HandlePetActionAsync(long userId, string action)
    {
        var state = await _petState.GetByUserIdAsync(userId);
        if (state is null) return;

        var delta = action switch
        {
            "feed" => (hunger: 25.0, happiness: 0.0, cleanliness: 0.0),
            "play" => (hunger: 0.0, happiness: 20.0, cleanliness: 0.0),
            "clean" => (hunger: 0.0, happiness: 0.0, cleanliness: 30.0),
            _ => (0.0, 0.0, 0.0)
        };

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var newState = state with
        {
            Hunger = Math.Min(100, state.Hunger + delta.hunger),
            Happiness = Math.Min(100, state.Happiness + delta.happiness),
            Cleanliness = Math.Min(100, state.Cleanliness + delta.cleanliness),
            LastActionTime = now
        };

        await _petState.UpsertAsync(userId, newState);

        // Broadcast to channel members who are watching
        if (_sessionMapping.TryGetSessionByUserId(userId, out var sessionId))
        {
            var stateWithDecay = new PetStateWithDecay(
                newState.Hunger, newState.Happiness, newState.Cleanliness,
                PetDecayRates.HungerPerSecond, PetDecayRates.HappinessPerSecond, PetDecayRates.CleanlinessPerSecond,
                newState.LastActionTime
            );
            var broadcast = new { type = "petStateUpdate", userId, state = stateWithDecay };
            await _eventBus.BroadcastToChannelAsync(sessionId, broadcast);
        }
    }

    private Task HandleWatchPetAsync(WebSocket ws, long userId, JsonElement data)
    {
        var targetUserId = data.GetProperty("userId").GetInt64();
        _watchingPets[ws] = targetUserId;
        return Task.CompletedTask;
    }
}
```

**Step 2: Create PetDecaySyncService (Background Service)**

```csharp
using Brmble.Server.Events;

namespace Brmble.Server.Pet;

public class PetDecaySyncService : BackgroundService
{
    private readonly IBrmbleEventBus _eventBus;
    private readonly ISessionMappingService _sessionMapping;
    private readonly IPetStateRepository _petState;
    private readonly ILogger<PetDecaySyncService> _logger;
    private static readonly TimeSpan SyncInterval = TimeSpan.FromMinutes(10);

    public PetDecaySyncService(
        IBrmbleEventBus eventBus,
        ISessionMappingService sessionMapping,
        IPetStateRepository petState,
        ILogger<PetDecaySyncService> logger)
    {
        _eventBus = eventBus;
        _sessionMapping = sessionMapping;
        _petState = petState;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(SyncInterval, stoppingToken);
                await BroadcastDecaySyncAsync();
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during pet decay sync");
            }
        }
    }

    private async Task BroadcastDecaySyncAsync()
    {
        var sessions = _sessionMapping.GetSnapshot();
        foreach (var (sessionId, mapping) in sessions)
        {
            var state = await _petState.GetByUserIdAsync(mapping.UserId);
            if (state is null) continue;

            var stateWithDecay = new PetStateWithDecay(
                state.Hunger, state.Happiness, state.Cleanliness,
                PetDecayRates.HungerPerSecond, PetDecayRates.HappinessPerSecond, PetDecayRates.CleanlinessPerSecond,
                state.LastActionTime
            );

            // Broadcast to all users in this user's channel
            var broadcast = new { type = "petDecaySync", userId = mapping.UserId, state = stateWithDecay };
            await _eventBus.BroadcastToChannelAsync(sessionId, broadcast);
        }
    }
}
```

**Step 3: Modify BrmbleWebSocketHandler to process pet messages**

Add to the read loop (after line 58):
```csharp
var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
using var doc = JsonDocument.Parse(json);
var petHandler = context.RequestServices.GetRequiredService<PetWebSocketHandler>();
await petHandler.HandleMessageAsync(ws, user.Id, doc.RootElement);
```

**Step 4: Register in DI (Program.cs)**
```csharp
builder.Services.AddSingleton<PetWebSocketHandler>();
builder.Services.AddHostedService<PetDecaySyncService>();
```

**Step 5: Commit**
```bash
git add src/Brmble.Server/Pet/PetWebSocketHandler.cs src/Brmble.Server/Pet/PetDecaySyncService.cs src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs src/Brmble.Server/Program.cs
git commit -m "feat(server): add PetWebSocketHandler and DecaySyncService for pet sync"
```

---

## Phase 2: Client-Side Bridge

### Task 4: C# Pet Service

**Files:**
- Create: `src/Brmble.Client/Services/Pet/PetService.cs`
- Create: `src/Brmble.Client/Services/Pet/IPetService.cs`
- Modify: `src/Brmble.Client/Program.cs` (register service)

**Step 1: Write interface and implementation**

```csharp
namespace Brmble.Client.Services.Pet;

public interface IPetService
{
    event Action<long, PetStateWithDecay>? OnPetStateUpdate;
    event Action<long, PetStateWithDecay>? OnPetDecaySync;
    Task<PetStateWithDecay?> GetPetStateAsync(long userId);
    Task WatchPetAsync(long userId);
    void UnwatchPet();
}

public record PetStateWithDecay(
    double Hunger,
    double Happiness,
    double Cleanliness,
    double HungerDecayRate,
    double HappinessDecayRate,
    double CleanlinessDecayRate,
    long LastActionTime
);
```

```csharp
using System.Text.Json;

namespace Brmble.Client.Services.Pet;

public class PetService : IPetService
{
    private readonly NativeBridge _bridge;
    public event Action<long, PetStateWithDecay>? OnPetStateUpdate;
    public event Action<long, PetStateWithDecay>? OnPetDecaySync;

    public PetService(NativeBridge bridge)
    {
        _bridge = bridge;
        _bridge.RegisterHandler("petStateUpdate", HandlePetStateUpdate);
        _bridge.RegisterHandler("petState", HandlePetState);
        _bridge.RegisterHandler("petDecaySync", HandlePetDecaySync);
    }

    private Task HandlePetStateUpdate(JsonElement data)
    {
        var (userId, state) = ParseState(data);
        OnPetStateUpdate?.Invoke(userId, state);
        return Task.CompletedTask;
    }

    private Task HandlePetState(JsonElement data) => HandlePetStateUpdate(data);

    private Task HandlePetDecaySync(JsonElement data)
    {
        var (userId, state) = ParseState(data);
        OnPetDecaySync?.Invoke(userId, state);
        return Task.CompletedTask;
    }

    private (long UserId, PetStateWithDecay State) ParseState(JsonElement data)
    {
        var userId = data.GetProperty("userId").GetInt64();
        var state = data.GetProperty("state");
        var petState = new PetStateWithDecay(
            state.GetProperty("hunger").GetDouble(),
            state.GetProperty("happiness").GetDouble(),
            state.GetProperty("cleanliness").GetDouble(),
            state.GetProperty("hungerDecayRate").GetDouble(),
            state.GetProperty("happinessDecayRate").GetDouble(),
            state.GetProperty("cleanlinessDecayRate").GetDouble(),
            state.GetProperty("lastActionTime").GetInt64()
        );
        return (userId, petState);
    }

    public Task<PetStateWithDecay?> GetPetStateAsync(long userId)
    {
        _bridge.Send("pet.getPetState", new { userId });
        return Task.FromResult<PetStateWithDecay?>(null); // Response comes async via event
    }

    public void WatchPet(long userId) => _bridge.Send("pet.watchPet", new { userId });
    public void UnwatchPet() => _bridge.Send("pet.unwatchPet");
}
```

**Step 2: Register in Program.cs**
```csharp
// After NativeBridge initialization
var petService = new PetService(nativeBridge);
services.AddSingleton<IPetService>(petService);
```

**Step 3: Commit**
```bash
git add src/Brmble.Client/Services/Pet/
git commit -m "feat(client): add PetService for bridge communication"
```

---

## Phase 3: Frontend

### Task 5: Pet State Store Hook

**Files:**
- Create: `src/Brmble.Web/src/hooks/usePetStore.ts`
- Modify: `src/Brmble.Web/src/bridge.ts` (add pet handlers)

**Step 1: Create usePetStore hook with local decay calculation**

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import bridge from '../bridge';

interface PetStateWithDecay {
  hunger: number;
  happiness: number;
  cleanliness: number;
  hungerDecayRate: number;
  happinessDecayRate: number;
  cleanlinessDecayRate: number;
  lastActionTime: number;
}

interface RemotePetState extends PetStateWithDecay {
  userId: number;
  userName: string;
  lastSyncTime: number;
}

const remotePets = new Map<number, RemotePetState>();

export function useRemotePetStore() {
  const [watchedPets, setWatchedPets] = useState<Map<number, RemotePetState>>(new Map());
  const animationFrameRef = useRef<number>();

  // Handle immediate state updates (action-based)
  useEffect(() => {
    const handler = (data: { userId: number; state: PetStateWithDecay; userName?: string }) => {
      const existing = remotePets.get(data.userId);
      const updated: RemotePetState = {
        ...data.state,
        userId: data.userId,
        userName: data.userName ?? existing?.userName ?? 'Unknown',
        lastSyncTime: Date.now()
      };
      remotePets.set(data.userId, updated);
      setWatchedPets(new Map(remotePets));
    };

    bridge.on('petStateUpdate', handler);
    return () => bridge.off('petStateUpdate', handler);
  }, []);

  // Handle periodic decay sync (every 10 min)
  useEffect(() => {
    const handler = (data: { userId: number; state: PetStateWithDecay }) => {
      const existing = remotePets.get(data.userId);
      if (!existing) return; // Only sync if we're already watching

      // Server state is authoritative - reset to server values
      const updated: RemotePetState = {
        ...data.state,
        userId: data.userId,
        userName: existing.userName,
        lastSyncTime: Date.now()
      };
      remotePets.set(data.userId, updated);
      setWatchedPets(new Map(remotePets));
    };

    bridge.on('petDecaySync', handler);
    return () => bridge.off('petDecaySync', handler);
  }, []);

  // Local decay animation (runs at ~60fps for smooth bars)
  useEffect(() => {
    const animate = () => {
      const now = Date.now();
      let needsUpdate = false;

      for (const [userId, pet] of remotePets) {
        const elapsedSeconds = (now - pet.lastSyncTime) / 1000;
        const decayedHunger = Math.max(0, pet.hunger - pet.hungerDecayRate * elapsedSeconds);
        const decayedHappiness = Math.max(0, pet.happiness - pet.happinessDecayRate * elapsedSeconds);
        const decayedCleanliness = Math.max(0, pet.cleanliness - pet.cleanlinessDecayRate * elapsedSeconds);

        if (Math.abs(decayedHunger - pet.hunger) > 0.01 ||
            Math.abs(decayedHappiness - pet.happiness) > 0.01 ||
            Math.abs(decayedCleanliness - pet.cleanliness) > 0.01) {
          remotePets.set(userId, { ...pet, hunger: decayedHunger, happiness: decayedHappiness, cleanliness: decayedCleanliness });
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        setWatchedPets(new Map(remotePets));
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const watchPet = useCallback((userId: number) => {
    bridge.send('pet.watchPet', { userId });
    bridge.send('pet.getPetState', { userId });
  }, []);

  const unwatchPet = useCallback((userId: number) => {
    bridge.send('pet.unwatchPet', { userId });
    remotePets.delete(userId);
    setWatchedPets(new Map(remotePets));
  }, []);

  return { watchedPets, watchPet, unwatchPet };
}
```

**Step 2: Commit**
```bash
git add src/Brmble.Web/src/hooks/usePetStore.ts
git commit -m "feat(web): add useRemotePetStore hook with local decay"
```

---

### Task 6: Pet Viewer Modal

**Files:**
- Create: `src/Brmble.Web/src/components/PetViewer/PetViewerModal.tsx`
- Create: `src/Brmble.Web/src/components/PetViewer/PetViewerModal.css`
- Modify: `src/Brmble.Web/src/components/Chat/UserContextMenu.tsx` (add "View Pet" option)

**Step 1: Create PetViewerModal component**

```tsx
import { useRemotePetStore } from '../../hooks/usePetStore';
import './PetViewerModal.css';

interface PetViewerModalProps {
  userId: number;
  userName: string;
  onClose: () => void;
}

export function PetViewerModal({ userId, userName, onClose }: PetViewerModalProps) {
  const { watchedPets, watchPet, unwatchPet } = useRemotePetStore();

  useEffect(() => {
    watchPet(userId);
    return () => unwatchPet(userId);
  }, [userId, watchPet, unwatchPet]);

  const pet = watchedPets.get(userId);

  return (
    <div className="pet-viewer-overlay" onClick={onClose}>
      <div className="pet-viewer-modal" onClick={e => e.stopPropagation()}>
        <div className="pet-viewer-header">
          <h2>{userName}'s Brmblegotchi</h2>
          <button className="pet-viewer-close" onClick={onClose}>×</button>
        </div>
        
        {pet ? (
          <div className="pet-viewer-content">
            <div className={`pet-display ${getMood(pet.hunger, pet.happiness, pet.cleanliness)}`}>
              <div className="pet-sprite" />
            </div>
            
            <div className="pet-stats">
              <StatBar label="Hunger" value={pet.hunger} type="hunger" />
              <StatBar label="Happiness" value={pet.happiness} type="happiness" />
              <StatBar label="Cleanliness" value={pet.cleanliness} type="cleanliness" />
            </div>

            <div className="pet-sync-info">
              <span className="sync-indicator" /> Live • Updates every 10 min
            </div>
          </div>
        ) : (
          <div className="pet-viewer-loading">
            <div className="loading-spinner" />
            <span>Connecting to pet...</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatBarProps {
  label: string;
  value: number;
  type: 'hunger' | 'happiness' | 'cleanliness';
}

function StatBar({ label, value, type }: StatBarProps) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <div className="stat-bar-container">
        <div className={`stat-bar stat-bar-${type}`}>
          <div 
            className="stat-fill" 
            style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          />
        </div>
      </div>
      <span className="stat-value">{Math.round(value)}%</span>
    </div>
  );
}

function getMood(hunger: number, happiness: number, cleanliness: number): string {
  const avg = (hunger + happiness + cleanliness) / 3;
  if (avg >= 70) return 'happy';
  if (avg >= 40) return 'content';
  return 'sad';
}
```

**Step 2: Create PetViewerModal.css**

```css
.pet-viewer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.pet-viewer-modal {
  background: var(--surface-primary);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  min-width: 320px;
  max-width: 400px;
  box-shadow: var(--shadow-xl);
}

.pet-viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}

.pet-viewer-header h2 {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  color: var(--text-primary);
}

.pet-viewer-close {
  background: none;
  border: none;
  font-size: var(--text-2xl);
  color: var(--text-muted);
  cursor: pointer;
  padding: var(--space-1);
}

.pet-viewer-close:hover {
  color: var(--text-primary);
}

.pet-display {
  width: 120px;
  height: 120px;
  margin: 0 auto var(--space-4);
  position: relative;
}

.pet-sprite {
  width: 100%;
  height: 100%;
  background: var(--accent-primary);
  border-radius: 50%;
}

.pet-display.happy .pet-sprite { background: var(--accent-primary); }
.pet-display.content .pet-sprite { background: var(--accent-secondary); }
.pet-display.sad .pet-sprite { background: var(--accent-decorative); }

.pet-stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.stat-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.stat-label {
  width: 80px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.stat-bar-container {
  flex: 1;
}

.stat-bar {
  height: 8px;
  background: var(--surface-secondary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.stat-fill {
  height: 100%;
  transition: width 0.1s ease-out;
}

.stat-bar-hunger .stat-fill { background: var(--accent-primary); }
.stat-bar-happiness .stat-fill { background: var(--accent-secondary); }
.stat-bar-cleanliness .stat-fill { background: var(--accent-decorative); }

.stat-value {
  width: 40px;
  text-align: right;
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.pet-sync-info {
  margin-top: var(--space-4);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.sync-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--success);
  border-radius: 50%;
  margin-right: var(--space-1);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.pet-viewer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6);
  color: var(--text-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--surface-secondary);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

**Step 3: Add "View Pet" to UserContextMenu**

In `UserContextMenu.tsx`, add option:
```tsx
<button onClick={() => onViewPet(userId, userName)}>
  View Pet
</button>
```

**Step 4: Commit**
```bash
git add src/Brmble.Web/src/components/PetViewer/
git commit -m "feat(web): add PetViewerModal for viewing remote pets"
```

---

## Phase 4: Testing

### Task 7: Server Tests

**Files:**
- Create: `tests/Brmble.Server.Tests/Pet/PetStateRepositoryTests.cs`

**Step 1: Write tests**

```csharp
using Brmble.Server.Data;
using Brmble.Server.Pet;
using Xunit;

namespace Brmble.Server.Tests.Pet;

public class PetStateRepositoryTests : IDisposable
{
    private readonly Database _db;
    private readonly PetStateRepository _repo;

    public PetStateRepositoryTests()
    {
        _db = new Database("DataSource=:memory:");
        _db.Initialize();
        _repo = new PetStateRepository(_db);
    }

    [Fact]
    public async Task GetByUserId_ReturnsNull_WhenNoState()
    {
        var result = await _repo.GetByUserIdAsync(999);
        Assert.Null(result);
    }

    [Fact]
    public async Task UpsertAndGet_ReturnsCorrectState()
    {
        var state = new PetState(50, 60, 70, 1000);
        await _repo.UpsertAsync(1, state);
        
        var result = await _repo.GetByUserIdAsync(1);
        
        Assert.NotNull(result);
        Assert.Equal(50, result.Hunger);
        Assert.Equal(60, result.Happiness);
        Assert.Equal(70, result.Cleanliness);
    }

    [Fact]
    public async Task Upsert_OverwritesExisting()
    {
        await _repo.UpsertAsync(1, new PetState(50, 50, 50, 0));
        await _repo.UpsertAsync(1, new PetState(80, 80, 80, 5000));
        
        var result = await _repo.GetByUserIdAsync(1);
        
        Assert.Equal(80, result!.Hunger);
        Assert.Equal(5000, result.LastActionTime);
    }

    public void Dispose() { }
}
```

**Step 2: Run tests**
```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Pet"
```

**Step 3: Commit**
```bash
git add tests/Brmble.Server.Tests/Pet/
git commit -m "test(server): add PetStateRepository tests"
```

---

## Summary

| Phase | Tasks | Files Modified/Created |
|-------|-------|----------------------|
| Server | 3 | Database.cs, Pet/*, BrmbleWebSocketHandler.cs, Program.cs |
| Client | 1 | Services/Pet/*, Program.cs |
| Frontend | 2 | usePetStore.ts, PetViewer/*, UserContextMenu.tsx |
| Testing | 1 | PetStateRepositoryTests.cs |

### Sync Protocol Summary

| Event | Trigger | Data | Bandwidth |
|-------|---------|------|-----------|
| Pet action | User clicks feed/play/clean | Full state with decay rates | ~150 bytes, instant |
| Decay sync | Every 10 minutes | Current state + decay rates | ~150 bytes per pet |
| Bar animation | Client-side | Calculated at ~60fps | Zero |

### Key Design Decisions

1. **Client-side decay animation**: Bars drain smoothly on the viewer's client using `requestAnimationFrame`, not by receiving updates
2. **Periodic sync**: Every 10 minutes the server sends authoritative state to correct any drift
3. **Decay rates included**: Each state update includes the decay rates so clients know how fast to animate

### Data Flow

```
Owner does action
       ↓
Server updates DB + broadcasts
       ↓
Viewer receives → Bar jumps up instantly
       ↓
Bars slowly drain locally (smooth animation)
       ↓
Every 10 min: Server sends sync → Bars correct if drifted
```

**Execution Options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks
2. **Parallel Session** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
