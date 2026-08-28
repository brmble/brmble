# Arena Knockoff Slice 3a — Playable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two people in the same voice channel can play a complete best-of-3 Arena Knockoff match in game mode, on a server-authoritative 60 Hz deterministic simulation streamed over a dedicated browser WebSocket, with client prediction and reconciliation.

**Architecture:** Arena registers one `IDuelGameDefinition` with `RunnerKey = "continuous"` and one continuous `IDuelMatchRunner` (`ContinuousGameCoordinator`). Project 1's existing `GameDefinitionCatalog` and `DuelMatchRunnerRouter` perform every canonicalization, start, lookup and forfeit routing with no modification. The server owns a single-process fixed-point simulation and emits replaceable 20 Hz snapshots only over a browser-owned WebSocket at `/games/realtime`; the mTLS native bridge issues short-lived tickets and never proxies a frame. On the client, participating sets `MainPanelMode = 'game'`, `MainPanel` hides (never unmounts) the split layer, and `GameSurface` hosts `ArenaBoard`.

**Tech Stack:** .NET 10, ASP.NET Core WebSockets, C# checked fixed-point integer simulation, `System.Threading.Channels`, MSTest/Moq, raw Win32/WebView2 mTLS bridge, React 19, TypeScript 5.9, Canvas 2D, Vitest/Testing Library, CSS custom-property tokens.

**Spec:** `docs/superpowers/specs/2026-08-27-arena-knockoff-revision-design.md` (authoritative; supersedes the July documents wherever they disagree).

**Supporting documents (read, do not re-derive):**
- `docs/superpowers/specs/2026-07-25-arena-knockoff-design.md` — the game design. Still valid except where §3 of the revision spec replaces the client surface.
- `docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md` — the July plan. Its simulation, ruleset constants, golden vectors, 15-stage tick ordering, shrink formulas and protocol are lifted verbatim into this plan's **Stable Continuous Contracts And Constants** and **Realtime Protocol Version 1** sections below. Read those sections here, not there.
- `docs/UI_GUIDE.md` — sections "Main Panel Region Pattern" (`:234`), "Minigame Panel Pattern" (`:313`), "Game Spectator Pattern" (`:658`), "Conversation Region Pattern" (`:288`).

---

## Scope

**In 3a:** July Tasks 1–8 (simulation and continuous runtime), 9–10 (ticket store and realtime WebSocket, **participant role only**), 12–15 (client protocol/connection, prediction and reconciliation, Canvas renderer, input capture and native PTT isolation), plus two ordered compiler-safety tasks and one new panel-integration task that replaces July Task 17 entirely.

**Out of 3a:**
- All spectating — July Task 11, the `SpectatorService` stub bodies, the spectator role in ticket issuance and on the realtime endpoint, and the `SpectatorActivity` Arena branch. That is **slice 3b**.
- Audio, saved Arena volume and session mute — July Task 16. Telemetry and load/balance gates — July Tasks 18 and 19. That is **slice 3c**.

Slices 3b and 3c get their own plans. Do not write them, and do not implement them here.

## Global Constraints

Every task's requirements implicitly include this section.

- **Do not touch `src/Brmble.Server/Games/Spectators/` at all in 3a.** `SpectatorService.RegisterContinuousMatchAsync` (`:173`) and `AuthorizeAsync` (`:176-178`) stay stubs. Participant attach is authorized via `ContinuousGameCoordinator.TryGetActiveMatch(stableUserId, out var active)` plus `active.MatchId` and `active.RunnerKey == "continuous"`. The July plan's repeated instruction to check "the returned descriptor's `Configuration.RunnerKey`" is **unimplementable** — `AuthorizeAsync` returns `SpectatorAuthorizationResult(bool, SpectatorRole, SpectatorSubscribeReason)` and returns no descriptor — and revision spec §2.2 replaces it.
- **Do not invent new abstractions alongside project 1's.** No `DuelMatchRouter`, no second catalog, no parallel definition or runtime-kind hierarchy, no changes to `GameSessionManager`, no changes to `GameDefinitionCatalog.cs` or `DuelMatchRunnerRouter.cs`.
- **Runner ownership and forfeit use stable `DuelPlayer.UserId`, never transient session IDs.** Realtime socket and input payloads use the currently bound Mumble session ID.
- **No continuous snapshot may enter `SpectatorService` or the normal event bus.** `IGameEventPublisher` is never invoked with Arena world state. Reliable lifecycle events (`game.started`, `game.ended`, `game.queueSnapshot`) continue on `/ws` unchanged.
- **`IGameEngine` is not touched.** Its interaction models stay `AlternatingTurns` and `SimultaneousCommit`. `ArenaGameDefinition` implements `IDuelGameDefinition` directly and never `IGameEngine`, so `IGameEngine.SpectatorView` (`IGameEngine.cs:68`) cannot reach it.
- **Determinism.** Every signed integer division truncates toward zero in both C# and TypeScript. Multiply in signed 64-bit before dividing and checked-cast to `int`. No floating point anywhere in simulation or prediction. No RNG in `ArenaSimulation` — randomness is test-data generation only. Iterate collections in explicit stable order (ascending session ID, ascending projectile ID); never rely on dictionary enumeration order.
- **Never hardcode colours, font sizes, font families, spacing, border radius, shadows or transition values in UI code.** Use existing CSS custom-property tokens; add a token rather than a literal. See `docs/UI_GUIDE.md` and `src/Brmble.Web/src/themes/_template.css`.
- **Do not create a toast system.** Brmble uses top-right `<Notification>` with `useNotificationQueue`.
- **Shell:** Windows PowerShell 5.1. Use `;` and `if ($?) { }`. Never `&&`.
- **Branch discipline:** never commit to `main`. This work continues on a branch off `main`. Ask before pushing or opening a PR.
- Protocol version is `1`. Ruleset version is `1`. Game type is `arena-knockoff`. Format is `bo3`. Runner key is `continuous`. These five strings/ints appear identically in C# and TypeScript and are never parameterised in 3a.

## Coordination

PR #645 (`fix/client-transport-defects`) is open and modifies `src/Brmble.Client/Bridge/NativeBridge.cs` and `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`. **Task 17 is the only task in this slice that modifies `MumbleAdapter.cs`, and it is deliberately last.** Before starting Task 17, check whether #645 has merged; if it has, rebase this branch onto `main` first. Do not coordinate the two edits in flight.

---

## File Structure

### Created — server

| File | Responsibility |
|---|---|
| `src/Brmble.Server/Games/Continuous/ContinuousContracts.cs` | Transport-neutral continuous definition, simulation, input, snapshot and completion contracts. |
| `src/Brmble.Server/Games/Continuous/FixedPoint.cs` | Checked fixed-point vector, integer square root, Q15 normalization, deterministic FNV-1a hashing. |
| `src/Brmble.Server/Games/Continuous/FixedStepScheduler.cs` | Monotonic rational 60 Hz deadlines, maximum-five catch-up, overload resynchronization. |
| `src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs` | Per-socket capacity-one replaceable snapshot queue plus bounded capacity-16 reliable control channel. |
| `src/Brmble.Server/Games/Continuous/RealtimeTicketStore.cs` | Cryptographically random, SHA-256-only, one-time 15-second capability issue/consume. |
| `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs` | `IDuelMatchRunner` with `RunnerKey = "continuous"`. Match registry, attach gate, input validation, scheduler ownership, snapshot fan-out, reconnect grace, completion. |
| `src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs` | `/games/realtime` WebSocket upgrade, ticket consumption, protocol parsing, role enforcement, send/receive loops, close cleanup. |
| `src/Brmble.Server/Games/Arena/ArenaRulesetV1.cs` | Every version-1 numeric gameplay and timing constant, plus the exact linear helpers. |
| `src/Brmble.Server/Games/Arena/ArenaModels.cs` | Fixed-point Arena state, phases, players, projectiles, round/match outcomes, public snapshot views, persisted telemetry summary. |
| `src/Brmble.Server/Games/Arena/ArenaSimulation.cs` | The deterministic 15-stage tick: phases, movement, collision, charge/fire/cooldown/recoil, projectiles, dash, shrink, KO, BO3, double-KO anti-loop. |
| `src/Brmble.Server/Games/Arena/ArenaGameDefinition.cs` | `arena-knockoff` / `bo3` / ruleset 1 configuration and simulation factory. |

### Modified — server

- `src/Brmble.Server/Games/GamesExtensions.cs` — register `ArenaGameDefinition`, `ContinuousGameCoordinator` and `RealtimeTicketStore` alongside project 1's existing registrations.
- `src/Brmble.Server/Games/GameEndpoints.cs` — add `POST /games/realtime-ticket` only.
- `src/Brmble.Server/Program.cs` — map `/games/realtime` between `app.Map("/ws", …)` (`:141`) and `app.MapReverseProxy()` (`:145`).
- `src/Brmble.Server/appsettings.json` — `Games:RealtimePublicWebSocketUrl`, `Games:RealtimeAllowedOrigins`.

### Created — web

| File | Responsibility |
|---|---|
| `src/Brmble.Web/src/components/Games/gameTypes.ts` | The closed `GameType` union and its runtime guard. The single place a new game type is declared on the client. |
| `src/Brmble.Web/src/components/Games/UnsupportedGameBoard.tsx` | Visible, non-Deathroll fallback for a game type this build cannot render. |
| `src/Brmble.Web/src/components/Games/Arena/arenaProtocol.ts` | Protocol-v1 discriminated message unions and runtime guards. |
| `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts` | Fixed-step prediction math mirroring `FixedPoint.cs`/`ArenaRulesetV1.cs`, plus world/screen transforms, interpolation and reconciliation helpers. |
| `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts` | Ticket acquisition, direct WebSocket lifecycle, attach acknowledgement, reconnect, heartbeat, input sequencing. |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts` | Local prediction and replay, mandatory snap rules, correction smoothing, remote/projectile/arena interpolation. |
| `src/Brmble.Web/src/components/Games/Arena/useArenaInput.ts` | Click-to-capture WASD/mouse/charge/fire/dash state, 30 Hz aim, 250 ms heartbeat, neutral release on every lifecycle path. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts` | Canvas 2D uniform-scale letterboxed renderer with avatar fallback and reduced-motion options. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx` | The participant board. Shared card shell, DOM HUD header, canvas, `.sr-only` live region. |
| `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.module.css` | Token-only fill-the-surface board layout. |

### Modified — web

- `src/Brmble.Web/src/components/Games/useGameState.ts` — `SUPPORTED_GAMES` replaced by `gameTypes.ts`; unknown type declines **visibly**.
- `src/Brmble.Web/src/App.tsx` — exhaustive board picker; `onChallenge`; Arena board mount; Arena lifecycle reset.
- `src/Brmble.Web/src/components/Games/SpectatorActivity.tsx` — exhaustive spectator board picker.
- `src/Brmble.Web/src/components/Games/challengeMenu.tsx` — one `onChallenge(gameType, options)`; Arena entry.
- `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`, `components/Sidebar/ChannelTree.tsx` — one `onChallenge` prop.
- `src/Brmble.Web/src/utils/games.ts` — `GAME_META` gains `arena-knockoff`.
- `src/Brmble.Web/src/components/Icon/Icon.tsx` — one `game-arena` icon under the GAMES category.
- `src/Brmble.Web/src/api/games.ts` — `requestRealtimeTicket`.
- `src/Brmble.Web/src/components/Games/GameSurface.tsx`, `GameSurface.css` — an opt-in `fill` variant.
- `docs/UI_GUIDE.md` — one amendment to the Minigame Panel Pattern (the fill variant + the Arena HUD split), written in the same task as the UI change.

### Modified — native client

- `src/Brmble.Client/Services/Games/GameService.cs` — correlated `realtime-ticket` mTLS request.
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — reference-counted `game.inputCapture` hotkey suspension over the existing `InputRouter.Suspend()` / `Resume()` path.

### Tests

Server: `tests/Brmble.Server.Tests/Games/Continuous/{ContinuousContractTests,FixedPointTests,FixedStepSchedulerTests,RealtimeSnapshotMailboxTests,ContinuousInputTests,ContinuousGameCoordinatorTests,RealtimeTicketStoreTests,RealtimeGameEndpointTests}.cs` and `tests/Brmble.Server.Tests/Games/Arena/{ArenaPhaseAndMovementTests,ArenaCombatTests,ArenaMatchTests,ArenaDeterminismTests}.cs`.

Native: `tests/Brmble.Client.Tests/Services/GameServiceTests.cs` (modify), `tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs` (modify), `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs` (modify).

Web: `src/Brmble.Web/src/components/Games/gameTypes.test.ts`, `useGameState.test.tsx` (modify), `challengeMenu.test.tsx` (modify), `SpectatorActivity.test.tsx` (modify), `Arena/{arenaMath,arenaProtocol}.test.ts`, `Arena/{useArenaConnection,useArenaState,useArenaInput,ArenaBoard}.test.tsx`, `Arena/ArenaRenderer.test.ts`, `src/App.arenaPanel.test.tsx`.

---

## Stable Continuous Contracts And Constants

Lifted verbatim from the July plan. Use these exact signatures. `InputSequence`, `ServerTick` and snapshot `Sequence` are three distinct counters; project-1 queue `Revision` is unrelated to all three.

```csharp
public enum RealtimeRole { Participant, Spectator }
public enum ContinuousMatchPhase { AwaitingParticipants, Loading, Positioning, Live, Ended }
public enum ContinuousRejectReason { StaleSequence, SequenceGap, InvalidRange, RateLimited, WrongMatch, WrongRole, PhaseDenied, Cooldown, DashSpent }

public sealed record ContinuousInput(
    long Sequence, long PredictedTick, short MoveX, short MoveY,
    short AimX, short AimY, bool Charging, bool FireReleased, bool Dash);
public sealed record ProcessedInput(long SessionId, long Sequence, long PredictedTick, long ReceivedTimestamp);
public sealed record ContinuousStepResult(bool Completed, ContinuousCompletion? Completion);
public sealed record ContinuousCompletion(
    string Outcome, string? AbandonReason, IReadOnlyList<CompletedParticipant> Participants,
    object MatchSummary, IReadOnlyDictionary<long, object> ParticipantStats);

public interface IContinuousSimulation
{
    long Tick { get; }
    ContinuousMatchPhase Phase { get; }
    void SetInput(long sessionId, ContinuousInput input);
    void SetNeutralInput(long sessionId);
    ContinuousStepResult Step();
    object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs);
    object SpectatorSnapshot();
    ulong DeterministicHash();
}

public interface IContinuousGameDefinition
{
    string GameType { get; }
    int RulesetVersion { get; }
    IContinuousSimulation Create(DuelReservation reservation);
    object PredictionConstants { get; }
}
```

`IContinuousSimulation.SpectatorSnapshot()` is declared in 3a because it is part of the frozen contract, and is implemented in 3a because `ArenaSimulation` cannot compile without it. **Nothing in 3a calls it** — no realtime socket is ever opened with `RealtimeRole.Spectator`. Slice 3b wires it up.

`ArenaGameDefinition` implements project 1's exact `IDuelGameDefinition` and this project's `IContinuousGameDefinition` in one class:

```csharp
public sealed class ArenaGameDefinition : IDuelGameDefinition, IContinuousGameDefinition
{
    public string GameType => "arena-knockoff";
    public string RunnerKey => "continuous";
    public int RulesetVersion => 1;
    public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options)
    {
        if (options is { Count: > 0 }) throw new InvalidGameConfigurationException("Arena options are not supported.");
        return new Dictionary<string, object?>();
    }
    public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) => "bo3";
    public IContinuousSimulation Create(DuelReservation reservation) => new ArenaSimulation(reservation);
    public object PredictionConstants => ArenaRulesetV1.PredictionConstants;
}
```

`ContinuousGameCoordinator` implements project 1's runner contract exactly:

```csharp
public sealed class ContinuousGameCoordinator : IDuelMatchRunner
{
    public string RunnerKey => "continuous";
    public event Func<MatchCompletion, Task>? MatchCompleted;
    public Task<GameStartResult> StartAsync(DuelReservation reservation);
    public bool TryGetActiveMatch(long stableUserId, out ActiveMatchReference match);
    public Task ForfeitAsync(long matchId, long stableUserId, string reason);
}
```

Internally each live continuous match retains both maps from its immutable reservation: stable user ID → current participant session ID, and session ID → stable user ID. Runner ownership and forfeit use stable IDs; realtime socket and input payloads use the currently bound session ID. Reconnect may replace the session value only after ticket authorization proves the same stable user. `DuelMatchRunnerRouter` remains project 1's sole `IDuelMatchRunnerRouter`; this project does not recreate or modify it.

`ArenaRulesetV1` contains no transport values and exactly these initial values:

```csharp
public static class ArenaRulesetV1
{
    public const int Version = 1;
    public const int UnitsPerWorldUnit = 1_000;
    public const int TickRate = 60;
    public const int SnapshotRate = 20;
    public const int SnapshotEveryTicks = 3;
    public const int MaxCatchUpTicks = 5;
    public const int LoadingTicks = 60;
    public const int PositioningTicks = 180;
    public const int InitialArenaRadius = 9_000;
    public const int CombatArenaRadius = 3_500;
    public const int SpawnOffset = 3_500;
    public const int PlayerRadius = 600;
    public const int BaseMovePerTick = 90;
    public const int ChargedMovePerTick = 45;
    public const int MomentumRetentionPermille = 920;
    public const int ChargeTicks = 90;
    public const int ForcedFireTicks = 30;
    public const int ShotCooldownTicks = 24;
    public const int ProjectileRadius = 180;
    public const int ProjectilePerTick = 240;
    public const int ProjectileBaseKnockback = 130;
    public const int ProjectileBonusKnockback = 220;
    public const int RecoilBase = 45;
    public const int RecoilBonus = 105;
    public const int DashTicks = 6;
    public const int DashPerTick = 240;
    public const int OpeningHoldTicks = 600;
    public const int NormalShrinkTicks = 1_800;
    public const int CollapseTicks = 1_200;
    public const int MaxConsecutiveDoubleKos = 3;
    public const int TargetRoundWins = 2;
    public const int AimQuantizationMax = 32_767;
}
```

Every signed integer division truncates toward zero in both C# and TypeScript; multiply in signed 64-bit before division and checked-cast to `int`. `NormalizeQ15(x,y)` returns zero for zero, otherwise `length = floor(sqrt(x*x + y*y))`; vectors with `length <= 32767` are unchanged, and longer vectors become `(x*32767/length, y*32767/length)`. Charge permille is `min(1000, chargeTicks*1000/90)`. `MovePerTick(q) = 90 - 45*q/1000`, `Knockback(q) = 130 + 220*q/1000` and `Recoil(q) = 45 + 105*q/1000` after clamping `q` to 0–1000.

**The 15-stage tick ordering.** One authoritative tick uses this exact order, and no task may reorder it:

1. Decrement positive cooldown and an already-running forced-fire counter.
2. Normalize and install held movement and aim. When Live, charging, and cooldown zero, increment charge by one to a maximum of 90 and, **only on the 89→90 transition**, set forced-fire to 30. Stop charging outside Live or during cooldown.
3. Process dash edges in ascending session ID and set six dash ticks.
4. Process fire-release or forced-fire-zero in ascending session ID: spawn the projectile, add the recoil impulse to velocity, clear charge and forced fire, set cooldown 24.
5. Add movement displacement directly to position using charge-adjusted speed.
6. Add dash displacement when `DashTicks > 0`, then decrement dash ticks.
7. Integrate velocity as `position += velocity`.
8. Damp each velocity component as `velocity = velocity * 920 / 1000`.
9. Resolve the one player-body overlap.
10. Advance projectiles in ascending projectile ID and resolve opponent hits, adding the knockback impulse to the opponent's velocity for the next tick.
11. Remove hit and out-of-arena projectiles.
12. Update live shrink tick and radius.
13. Evaluate both player centers against the updated radius.
14. Classify, finish or reset the round.
15. Increment the server tick and capture a snapshot when it is divisible by three.

A release edge at charge zero fires immediately. The first forced shot occurs on the 30th tick after reaching maximum charge. Impulses change velocity only; movement and dash change position only. Collision separation changes position only and leaves velocity unchanged.

**Overlap.** Let `dx = high.X - low.X`, `dy = high.Y - low.Y`, `distance = floor(sqrt(dx*dx + dy*dy))`, `penetration = 1200 - distance`. If `distance == 0`, use normal `(32767, 0)`. Otherwise normal is `(dx*32767/distance, dy*32767/distance)`. Move `low` by `-normal*(penetration/2)/32767`; move `high` by `normal*(penetration - penetration/2)/32767`, so the higher session ID receives the odd unit. A projectile hit uses `(projectile.Vx, projectile.Vy)` normalized to Q15 and adds `normal.Scale(Knockback(q))`; recoil subtracts `aim.Scale(Recoil(q))`.

**Shrink.** Uses live tick `t` before stage 12: `radius = 9000` for `0 <= t < 600`; `radius = 9000 - (5500*(t-599)/1800)` for `600 <= t < 2400`; `radius = 3500 - (3500*(t-2399)/1200)` for `2400 <= t < 3600`; `0` for `t >= 3600`. Therefore radii at ticks `599, 600, 2399, 2400, 3599, 3600` are `9000, 8997, 3500, 3498, 0, 0`. Boundary equality is **inside**; only squared distance strictly greater than squared radius is outside.

**Golden vectors.** Both the C# and the TypeScript implementation must pass exactly these, with these expected values and no others:

```text
normalize(32767,32767)=(23170,23170)
normalize(-32767,32767)=(-23170,23170)
move(q=333)=76; knockback(q=333)=203; recoil(q=333)=79
velocity(350,-151) after damping=(322,-138)
coincident sessions 10/20 at (0,0) => (-600,0)/(600,0)
overlap sessions 10 at (0,0), 20 at (1000,0) => (-100,0)/(1100,0)
radius(599,600,2399,2400,3599,3600)=9000,8997,3500,3498,0,0
```

## Realtime Protocol Version 1

Lifted verbatim from the July plan, with the spectator role deferred to slice 3b.

The browser requests `POST /games/realtime-ticket` through `GameService` with `{"matchId":91,"role":"participant"}`. Success is:

```json
{"protocolVersion":1,"ticket":"9T3rFfH8hF6Jf9vC7RMX6PjzHgMXdQ4cT3m_8FjTziQ","url":"wss://chat.example/games/realtime","expiresAt":"2026-07-25T14:30:15.0000000+00:00"}
```

The ticket has 256 random bits, is stored only as SHA-256, expires after 15 seconds, is bound to stable user ID, current Mumble session, match and role, and is atomically removed by `TryConsume`. A failed scope check does not reveal which field differed. Reconnect always requests a new ticket.

Client-to-server messages:

```json
{"type":"attachAck","protocolVersion":1,"matchId":91,"snapshotSequence":1}
{"type":"input","protocolVersion":1,"matchId":91,"sequence":42,"predictedTick":812,"moveX":32767,"moveY":0,"aimX":23170,"aimY":23170,"charging":true,"fireReleased":false,"dash":false}
{"type":"heartbeat","protocolVersion":1,"matchId":91,"sequence":43,"predictedTick":815,"moveX":32767,"moveY":0,"aimX":23170,"aimY":23170,"charging":true}
```

(The July plan's fourth client message, `telemetry`, belongs to July Task 18 and is **not** implemented in 3a. Do not send it, and do not add a server case for it.)

Server-to-client reliable control and replaceable snapshot messages:

```json
{"type":"welcome","protocolVersion":1,"rulesetVersion":1,"matchId":91,"role":"participant","sessionId":10,"snapshotSequence":1,"serverTick":0,"tickRate":60,"snapshotRate":20,"interpolationMs":100,"maxExtrapolationMs":50,"inputHeartbeatMs":250,"neutralAfterMs":750,"reconnectGraceMs":5000,"prediction":{"unitsPerWorldUnit":1000,"playerRadius":600,"baseMovePerTick":90,"chargedMovePerTick":45,"momentumRetentionPermille":920,"chargeTicks":90,"forcedFireTicks":30,"shotCooldownTicks":24,"projectileRadius":180,"projectilePerTick":240,"projectileBaseKnockback":130,"projectileBonusKnockback":220,"recoilBase":45,"recoilBonus":105,"dashTicks":6,"dashPerTick":240},"state":{"phase":"awaitingParticipants"}}
{"type":"snapshot","protocolVersion":1,"matchId":91,"sequence":28,"serverTick":81,"generatedAtUnixMs":1784989801350,"phase":"positioning","phaseEndsAtTick":240,"score":[0,0],"consecutiveDoubleKos":0,"arena":{"radius":9000,"shrinkPhase":"hold"},"players":[{"sessionId":10,"side":0,"x":-3500,"y":0,"vx":0,"vy":0,"aimX":32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":true,"acknowledgedInput":42},{"sessionId":20,"side":1,"x":3500,"y":0,"vx":0,"vy":0,"aimX":-32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":true,"acknowledgedInput":37}],"projectiles":[]}
{"type":"inputRejected","protocolVersion":1,"matchId":91,"sequence":44,"reason":"phaseDenied"}
{"type":"connectionState","protocolVersion":1,"matchId":91,"sessionId":20,"state":"reconnecting","graceEndsAtUnixMs":1784989806000}
{"type":"matchClosed","protocolVersion":1,"matchId":91,"sequence":121,"serverTick":3601,"reason":"completed","finalState":{"phase":"ended","phaseEndsAtTick":null,"score":[2,1],"consecutiveDoubleKos":0,"arena":{"radius":0,"shrinkPhase":"collapse"},"players":[{"sessionId":10,"side":0,"x":-3010,"y":22,"vx":0,"vy":0,"aimX":32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":false,"acknowledgedInput":88},{"sessionId":20,"side":1,"x":3510,"y":14,"vx":0,"vy":0,"aimX":-32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":true,"acknowledgedInput":91}],"projectiles":[]}}
```

Reliable controls use a bounded capacity-16 channel. Coalescible `connectionState` and `inputRejected` entries replace an older entry with the same `(type, sessionId)` or `(type, sequence)` key; noncoalescible `welcome` and `matchClosed` reserve two slots, and a writer that cannot enqueue them closes the socket as overloaded. Snapshots use capacity one with drop-oldest. The send loop sends at most four controls, then the latest snapshot, preventing snapshot starvation. `matchClosed` is the authoritative complete final snapshot; the server awaits its successful send (two-second timeout) before initiating a normal close, and the client renders it before acknowledging the close event.

---

## Task 1: Make Every Game-Type Picker Exhaustive

Three sites currently swallow an unknown game type, two of them silently. This lands **before `arena-knockoff` exists anywhere**, or the compiler protects nothing and Arena reads as a working feature that declines every invite. This is an ordered step, not a discovery.

| Site | Current failure |
|---|---|
| `useGameState.ts:8-10` `SUPPORTED_GAMES = ['deathroll', 'rps']` | Invites for any other type are auto-declined at `:217-222` with no error, no notification and no log. The challenger sees only "declined". |
| `App.tsx:5289` `gameType === 'rps' ? <RpsBoard> : <DeathrollBoard>` | Bare else. A third type renders the Deathroll board. |
| `SpectatorActivity.tsx:57` `isRpsSpectatorView(match.view)` binary branch | Same shape, same fall-through. Fixed now even though Arena has no spectator view until 3b: making both pickers exhaustive at once costs nothing, and leaving one bare else behind reintroduces exactly the failure this step exists to remove. |

**Files:**
- Create: `src/Brmble.Web/src/components/Games/gameTypes.ts`
- Create: `src/Brmble.Web/src/components/Games/gameTypes.test.ts`
- Create: `src/Brmble.Web/src/components/Games/UnsupportedGameBoard.tsx`
- Modify: `src/Brmble.Web/src/components/Games/useGameState.ts:8-10`, `:217-222`
- Modify: `src/Brmble.Web/src/App.tsx:5287-5321`
- Modify: `src/Brmble.Web/src/components/Games/SpectatorActivity.tsx:55-60`
- Modify: `src/Brmble.Web/src/components/Games/useGameState.test.tsx`
- Modify: `src/Brmble.Web/src/components/Games/SpectatorActivity.test.tsx`

**Interfaces:**
- Consumes: `assertNever` from `src/Brmble.Web/src/utils/assertNever.ts` (already exists and is already used by `App.tsx`'s activity-stage switch at `:5262`).
- Produces: `export const GAME_TYPES`, `export type GameType`, `export function isGameType(value: string | null | undefined): value is GameType`, and `export function UnsupportedGameBoard({ gameType, onClose }: { gameType: string; onClose: () => void })`. Task 16 adds `'arena-knockoff'` to `GAME_TYPES` and a `case 'arena-knockoff'` to both switches, and the compiler will demand it.

- [ ] **Step 1: Write the failing tests**

Add to `src/Brmble.Web/src/components/Games/gameTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GAME_TYPES, isGameType } from './gameTypes';

describe('gameTypes', () => {
  it('recognises every shipped game type', () => {
    expect(isGameType('deathroll')).toBe(true);
    expect(isGameType('rps')).toBe(true);
  });

  it('rejects unknown, empty and absent types', () => {
    expect(isGameType('arena-knockoff')).toBe(false);
    expect(isGameType('')).toBe(false);
    expect(isGameType(undefined)).toBe(false);
    expect(isGameType(null)).toBe(false);
  });

  it('exposes the union as a readonly tuple so a new type is one edit', () => {
    expect([...GAME_TYPES]).toEqual(['deathroll', 'rps']);
  });
});
```

Add to `src/Brmble.Web/src/components/Games/useGameState.test.tsx` (follow the existing file's harness and `bridge` mock conventions; do not invent a new one):

```tsx
it('declines an unknown game type loudly instead of silently', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = renderGameState();

  act(() => { bridge.emit('game.invited', { offerId: 5, gameType: 'arena-knockoff', from: 42 }); });

  await waitFor(() => expect(gamesApi.respondOffer).toHaveBeenCalledWith(5, false));
  // The invite must not open a board...
  expect(result.current.incomingInvite).toBeNull();
  // ...and must not vanish without trace.
  expect(result.current.lastError).toBe(
    "This Brmble version can't play 'arena-knockoff'. Update Brmble to accept this challenge.",
  );
  expect(warn).toHaveBeenCalledWith(
    "[games] declined an invite for an unsupported game type 'arena-knockoff'",
  );
  warn.mockRestore();
});
```

Add to `src/Brmble.Web/src/components/Games/SpectatorActivity.test.tsx` (reuse `spectatorTestHarness.ts`):

```tsx
it('renders an explicit unsupported notice rather than the Deathroll board', () => {
  render(
    <SpectatorActivity
      match={spectatorSnapshot({ gameType: 'arena-knockoff' })}
      ended={null}
      queueSnapshot={null}
      resolveName={() => 'Someone'}
      onStopWatching={() => {}}
    />,
  );

  expect(screen.getByTestId('spectator-unsupported-game')).toHaveTextContent(/arena-knockoff/);
  expect(screen.queryByTestId('deathroll-spectator-board')).toBeNull();
});
```

If `DeathrollSpectatorBoard` has no `data-testid`, add `data-testid="deathroll-spectator-board"` to its root element in this task rather than asserting on incidental text.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/components/Games/gameTypes.test.ts src/components/Games/useGameState.test.tsx src/components/Games/SpectatorActivity.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL. `gameTypes.test.ts` fails to resolve `./gameTypes`. The `useGameState` test fails because `lastError` is `null` and `console.warn` was not called. The `SpectatorActivity` test fails because `spectator-unsupported-game` is not in the document and the Deathroll board rendered.

- [ ] **Step 3: Create the closed union**

`src/Brmble.Web/src/components/Games/gameTypes.ts`:

```ts
/**
 * Every game type this client build can render.
 *
 * This is the ONE place a game type is declared on the client. Adding an entry
 * here turns three `default:` branches into compile errors — the participant board
 * picker in App, the spectator board picker in SpectatorActivity, and any future
 * switch that uses `assertNever`. That is deliberate: two of those sites used to
 * fail silently, so a forgotten branch shipped as a feature that quietly did the
 * wrong thing. Do not widen this to `string`.
 */
export const GAME_TYPES = ['deathroll', 'rps'] as const;

export type GameType = (typeof GAME_TYPES)[number];

/** Narrows an untrusted server-supplied string to a type this build can render. */
export function isGameType(value: string | null | undefined): value is GameType {
  return value != null && (GAME_TYPES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Create the visible fallback board**

`src/Brmble.Web/src/components/Games/UnsupportedGameBoard.tsx`. It wears the shared card shell exactly as the other participant boards do (`.glass-panel.animate-slide-up`, `.modal-header`, `h2.heading-title.modal-title`, `.modal-close`) and needs no CSS module of its own:

```tsx
import { Icon } from '../Icon/Icon';

/**
 * Rendered when a match's game type is not in GAME_TYPES. It exists so an
 * unrecognised type is visibly unsupported instead of being rendered as
 * Deathroll, which is what the old bare `else` did.
 */
export function UnsupportedGameBoard({ gameType, onClose }: { gameType: string; onClose: () => void }) {
  return (
    <section className="glass-panel animate-slide-up" data-testid="unsupported-game-board">
      <div className="modal-header">
        <h2 className="heading-title modal-title">Unsupported game</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <p>
        This Brmble version can&apos;t play <strong>{gameType}</strong>. Update Brmble to join this match.
      </p>
    </section>
  );
}
```

Confirm the close-icon name against `src/Brmble.Web/src/components/Icon/Icon.tsx` and reuse whatever the existing boards' `.modal-close` uses; do not add an icon in this task.

- [ ] **Step 5: Make the invite path decline loudly**

In `useGameState.ts`, delete the `SUPPORTED_GAMES` array (`:8-10`) and import `isGameType`. Replace the silent branch at `:217-222`:

```ts
      const gameType = d.gameType ?? 'deathroll';
      if (!isGameType(gameType)) {
        // Decline rather than open the wrong board — but say so. This used to be
        // silent, which made an unrecognised game look to the challenger like a
        // plain refusal and left no trace at all on this side.
        console.warn(`[games] declined an invite for an unsupported game type '${gameType}'`);
        setLastError(
          `This Brmble version can't play '${gameType}'. Update Brmble to accept this challenge.`,
        );
        gamesApi.respondOffer(offerId, false).catch(() => {});
        return;
      }
```

`setLastError` is already surfaced as a top-right `<Notification>` by App (`App.tsx:1130`, `:5785-5792`) via `useNotificationQueue`. Do not add a notification mechanism.

- [ ] **Step 6: Make the participant board picker exhaustive**

In `App.tsx`, replace the ternary at `:5288-5321` with a switch inside a helper declared immediately above `gameSurface`. Keep every existing prop on both boards exactly as it is today; the only change is the branch shape.

```tsx
  const renderParticipantBoard = () => {
    const raw = gameState.activeMatch?.gameType ?? gameState.ended?.gameType;
    if (!isGameType(raw)) {
      return <UnsupportedGameBoard gameType={raw ?? 'unknown'} onClose={confirmForfeit} />;
    }
    switch (raw) {
      case 'rps':
        return (
          <RpsBoard
            key={`rps-${gameState.activeMatch?.matchId ?? gameState.ended?.matchId ?? 'none'}`}
            /* …every existing prop, unchanged… */
          />
        );
      case 'deathroll':
        return (
          <DeathrollBoard
            /* …every existing prop, unchanged… */
          />
        );
      default:
        return assertNever(raw);
    }
  };

  const gameSurface = participatingMatchId !== null ? (
    <GameSurface>{renderParticipantBoard()}</GameSurface>
  ) : showGame ? (
    <NeonDGame onClose={() => setShowGame(false)} />
  ) : null;
```

- [ ] **Step 7: Make the spectator board picker exhaustive**

In `SpectatorActivity.tsx`, replace the `body` expression at `:55-60`. Branch on `match.gameType`, not on the view shape. `isRpsSpectatorView` is kept, but only to narrow `match.view` to the board's prop type inside the branch the game type already chose — if it disagrees, that is a server/client mismatch and must render the notice, not the other board.

```tsx
  const body = match ? renderSpectatorBoard(match, outcome) : <NextUp queueSnapshot={queueSnapshot} resolveName={resolveName} />;
```

```tsx
function renderSpectatorBoard(match: SpectatorSnapshot, outcome: SpectatorMatchOutcome | null) {
  if (!isGameType(match.gameType)) return <UnsupportedSpectatorView gameType={match.gameType} />;
  switch (match.gameType) {
    case 'rps':
      return isRpsSpectatorView(match.view)
        ? <RpsSpectatorBoard key={match.matchId} view={match.view} players={match.players} outcome={outcome} />
        : <UnsupportedSpectatorView gameType={match.gameType} />;
    case 'deathroll':
      return isRpsSpectatorView(match.view)
        ? <UnsupportedSpectatorView gameType={match.gameType} />
        : <DeathrollSpectatorBoard key={match.matchId} view={match.view} players={match.players} outcome={outcome} />;
    default:
      return assertNever(match.gameType);
  }
}

function UnsupportedSpectatorView({ gameType }: { gameType: string }) {
  return (
    <div className={styles.nextUp} data-testid="spectator-unsupported-game">
      <span className={styles.nextUpLabel}>Can&apos;t show this game</span>
      <span className={styles.nextUpMeta}>This Brmble version can&apos;t display {gameType}.</span>
    </div>
  );
}
```

Reuse the existing `styles.nextUp` / `styles.nextUpLabel` / `styles.nextUpMeta` classes rather than adding new CSS, and add no new tokens. `SpectatorActivity` deliberately renders no `.modal-close` (UI_GUIDE `:684`); do not add one here.

- [ ] **Step 8: Run the tests and type-check**

Run: `npm test -- --run src/components/Games/gameTypes.test.ts src/components/Games/useGameState.test.tsx src/components/Games/SpectatorActivity.test.tsx src/components/Games/DeathrollSpectatorBoard.test.tsx src/components/Games/RpsSpectatorBoard.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS. Unknown invite declines with a visible error and a warning; both pickers render the explicit notice for an unknown type; the Deathroll and RPS spectator boards still render for their own types.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Web/src/components/Games/gameTypes.ts src/Brmble.Web/src/components/Games/gameTypes.test.ts src/Brmble.Web/src/components/Games/UnsupportedGameBoard.tsx src/Brmble.Web/src/components/Games/useGameState.ts src/Brmble.Web/src/components/Games/useGameState.test.tsx src/Brmble.Web/src/components/Games/SpectatorActivity.tsx src/Brmble.Web/src/components/Games/SpectatorActivity.test.tsx src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx src/Brmble.Web/src/App.tsx
git commit -m "fix: make every game-type picker exhaustive instead of silently falling back"
```

## Task 2: Collapse The Per-Game Challenge Callback Chain

`challengeMenu.tsx:56-74` is a hardcoded per-game submenu driven by per-game callback props — `onChallengeDeathroll` and `onChallengeRps` — threaded through `Sidebar` (`:44-45`, `:90-91`, `:465-466`, `:501`, `:508`) and `ChannelTree` (`:69-70`, `:113`, `:700`, `:710`). A third game means a third prop through two components and a third clause in two guards. It does not survive a third game, it is code this slice already edits, and the compiler catches every site.

This is a pure refactor: no behaviour changes, and no Arena entry is added yet (Task 16 adds it). It is **not** a licence for unrelated refactoring elsewhere.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/challengeMenu.tsx`
- Modify: `src/Brmble.Web/src/components/Games/challengeMenu.test.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:44-45`, `:90-91`, `:465-466`, `:501`, `:508`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx:69-70`, `:113`, `:700`, `:710`
- Modify: `src/Brmble.Web/src/App.tsx:5396-5397`

**Interfaces:**
- Consumes: `GameType` from Task 1's `gameTypes.ts`; `InviteOptions` from `src/Brmble.Web/src/api/games.ts:36`.
- Produces: `export type ChallengeHandler = (session: number, gameType: GameType, options?: InviteOptions) => void;` and the new `buildChallengeMenuItem(session, onChallenge, busy?)` arity. Task 16 adds the Arena submenu entry to this one file.

- [ ] **Step 1: Write the failing test**

Rewrite the invocation assertions in `src/Brmble.Web/src/components/Games/challengeMenu.test.tsx` against the single handler. Keep every existing busy/disabled case; only the handler shape changes.

```tsx
it('invites with the chosen game type and options through one handler', () => {
  const onChallenge = vi.fn();
  const item = buildChallengeMenuItem(7, onChallenge);

  const deathroll = findChild(item, 'Deathroll');
  deathroll.onClick?.();
  expect(onChallenge).toHaveBeenNthCalledWith(1, 7, 'deathroll', undefined);

  const rps = findChild(item, 'Rock Paper Scissors');
  findChild(rps, 'Best of 5').onClick?.();
  expect(onChallenge).toHaveBeenNthCalledWith(2, 7, 'rps', { bestOf: 5 });
});

it('renders one disabled entry with no children when either side is committed', () => {
  const item = buildChallengeMenuItem(7, vi.fn(), {
    committedSessions: new Set([7]), selfSession: 1, targetName: 'Ada',
  });
  expect(item.disabled).toBe(true);
  expect(item.label).toBe('Ada is in a duel');
  expect(item.children).toBeUndefined();
});
```

`findChild(item, label)` is a small local helper in the test file that asserts the child exists and narrows it to the `{ type: 'item' }` member; write it once at the top of the file rather than repeating the narrowing inline.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/components/Games/challengeMenu.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL — `buildChallengeMenuItem` still takes four positional arguments, so the third argument is read as `onChallengeRps` and `onChallenge` is never called with a game type.

- [ ] **Step 3: Collapse the builder**

In `challengeMenu.tsx`, replace the two callback parameters with one. Keep the doc comment's explanation of eligibility and the busy copy precedence intact.

```tsx
export type ChallengeHandler = (session: number, gameType: GameType, options?: InviteOptions) => void;

export function buildChallengeMenuItem(
  session: number,
  onChallenge: ChallengeHandler,
  busy?: {
    committedSessions?: ReadonlySet<number>;
    selfSession?: number;
    targetName?: string;
  },
): ChallengeMenuItem {
  const rpsBestOf = (n: number): ContextMenuItem => ({
    type: 'item',
    label: `Best of ${n}`,
    onClick: () => onChallenge(session, 'rps', { bestOf: n }),
  });
  // …busy branch unchanged…
  return {
    type: 'item',
    label: 'Challenge to a duel',
    icon: <Icon name="swords" size={14} />,
    children: [
      {
        type: 'item',
        label: 'Deathroll',
        icon: <Icon name="game-deathroll" size={14} />,
        onClick: () => onChallenge(session, 'deathroll'),
      },
      {
        type: 'item',
        label: 'Rock Paper Scissors',
        icon: <Icon name="game-rps" size={14} />,
        children: [rpsBestOf(3), rpsBestOf(5), rpsBestOf(7)],
      },
    ],
  };
}
```

- [ ] **Step 4: Thread the single prop**

In `Sidebar.tsx` and `ChannelTree.tsx`, replace the two optional props with `onChallenge?: ChallengeHandler;`, replace the destructuring, replace the pass-through (`Sidebar.tsx:465-466`), and replace both guards:

```tsx
if (contextMenu.isSelf || !onChallenge) return [];
…
return [buildChallengeMenuItem(parseInt(contextMenu.userId), onChallenge, { /* …busy, unchanged… */ })];
```

In `App.tsx`, replace `:5396-5397` with one prop:

```tsx
onChallenge={(session, gameType, options) => gameState.invite(session, gameType, options)}
```

`gameState.invite` already has signature `(targetSessionId: number, gameType?: string, options?: InviteOptions) => void` (`useGameState.ts:457`); it is unchanged.

- [ ] **Step 5: Run the affected tests, the full web suite and type-check**

Run: `npm test -- --run src/components/Games/challengeMenu.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS — and it is the real gate for this task, because the compiler is what proves every call site moved.

Run: `npm test`

Working directory: `src/Brmble.Web`

Expected: PASS with zero failures. Any Sidebar/ChannelTree test that passed the old props must be updated in this task, not left failing.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/challengeMenu.tsx src/Brmble.Web/src/components/Games/challengeMenu.test.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/App.tsx
git commit -m "refactor: collapse per-game challenge callbacks into one onChallenge"
```

## Task 3: Add Shared Continuous Definitions And A Compilable Coordinator

Lifted from July Task 1. This task exists to create a **compilable** coordinator before any later task modifies it, so Tasks 9 and 10 are valid `Modify` operations rather than several tasks all creating the same file.

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/ContinuousContracts.cs`
- Create: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousContractTests.cs`

**Interfaces:**
- Consumes: project 1's `IDuelGameDefinition`, `DuelConfiguration`, `DuelReservation`, `DuelPlayer`, `ActiveMatchReference`, `GameStartResult`, `MatchCompletion`, `IDuelMatchRunner`, `GameDefinitionCatalog`, `DuelMatchRunnerRouter`, `ICompletedMatchSink`, `IGameEventPublisher` (all in `src/Brmble.Server/Games/`).
- Produces: every type in the **Stable Continuous Contracts And Constants** section above, plus `ContinuousGameCoordinator` with the constructor `(IEnumerable<IContinuousGameDefinition> definitions, TimeProvider time, ICompletedMatchSink sink, IGameEventPublisher publisher, ILogger<ContinuousGameCoordinator> logger)`. Tasks 9 and 10 modify this class and must not change that constructor's existing parameters, only append.

- [ ] **Step 1: Write the failing contract tests**

```csharp
[TestMethod]
public async Task ArenaConfiguration_DispatchesToContinuousRunnerWithoutChangingReservation()
{
    var reservation = TestReservation(gameType: "arena-knockoff", format: "bo3", rulesetVersion: 1,
        runnerKey: "continuous", playerOneSessionId: 10, playerOneUserId: 501,
        playerTwoSessionId: 20, playerTwoUserId: 502);
    var definition = new FakeContinuousDefinition("arena-knockoff", "bo3", 1);
    var continuous = ContinuousHarness.Coordinator(definition);
    IDuelMatchRunnerRouter router = new DuelMatchRunnerRouter([continuous], NullLogger<DuelMatchRunnerRouter>.Instance);
    var result = await router.StartAsync(reservation);
    Assert.IsTrue(result.Success);
    Assert.IsTrue(router.TryGetActiveMatch(501, out var active));
    Assert.AreEqual(result.MatchId, active.MatchId);
    Assert.AreEqual(reservation.ReservationId, active.ReservationId);
    Assert.AreEqual("continuous", active.RunnerKey);
}

[TestMethod]
public void SharedCatalog_NormalizesFakeContinuousDefinition()
{
    var definition = new FakeContinuousDefinition("arena-knockoff", "bo3", 1);
    var actual = new GameDefinitionCatalog([definition]).Create("arena-knockoff", null);
    Assert.AreEqual("arena-knockoff", actual.GameType);
    Assert.AreEqual("bo3", actual.Format);
    Assert.AreEqual(1, actual.RulesetVersion);
    Assert.AreEqual(0, actual.Options.Count);
    Assert.AreEqual("continuous", actual.RunnerKey);
    Assert.ThrowsException<InvalidGameConfigurationException>(() =>
        definition.NormalizeOptions(new Dictionary<string, object?> { ["bestOf"] = 5 }));
}

[TestMethod]
public async Task ExistingRouter_ForfeitAndLookupUseStableUserId()
{
    var h = ContinuousHarness.Started(playerOneSessionId: 10, playerOneUserId: 501);
    Assert.IsTrue(h.Router.TryGetActiveMatch(501, out var active));
    // A transient session id must never own the match.
    Assert.IsFalse(h.Router.TryGetActiveMatch(10, out _));
    await h.Router.ForfeitAsync(active.MatchId, 501, "disconnect");
    Assert.IsFalse(h.Router.TryGetActiveMatch(501, out _));
    Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
}
```

Check `tests/Brmble.Server.Tests/Games/GameTestHelpers.cs` first and reuse its reservation/configuration builders if they fit; add `TestReservation` and `ContinuousHarness` to the new test file only if they do not.

- [ ] **Step 2: Run the contract tests and verify the missing types fail compilation**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousContractTests`

Expected: FAIL with `CS0246` for `IContinuousGameDefinition` and `ContinuousGameCoordinator`. Project 1's `IDuelGameDefinition`, `DuelMatchRunnerRouter`, `DuelConfiguration.RunnerKey` and the stable-user signatures already compile.

- [ ] **Step 3: Add a fake continuous definition using the exact project-1 definition contract**

```csharp
internal sealed class FakeContinuousDefinition : IDuelGameDefinition, IContinuousGameDefinition
{
    public string GameType { get; }
    public string RunnerKey => "continuous";
    public int RulesetVersion { get; }
    private readonly string _format;
    public FakeContinuousDefinition(string gameType, string format, int rulesetVersion) =>
        (GameType, _format, RulesetVersion) = (gameType, format, rulesetVersion);
    public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options)
    {
        if (options is { Count: > 0 }) throw new InvalidGameConfigurationException("Arena options are not supported.");
        return new Dictionary<string, object?>();
    }
    public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) => _format;
    public IContinuousSimulation Create(DuelReservation reservation) => new FakeSimulation();
    public object PredictionConstants => new { };
}
```

Pass this fake **directly** to project 1's existing `GameDefinitionCatalog(IEnumerable<IDuelGameDefinition>)`. The canonical configuration assertion must include `RunnerKey = "continuous"`. Do not modify the catalog, add an adapter, or create another definition/runtime-kind abstraction.

`FakeSimulation` is a minimal `IContinuousSimulation` in the test file: `Tick` increments on `Step()`, `Phase` is `Live`, `Step()` returns `new ContinuousStepResult(false, null)`, the two snapshot methods return `new { }`, and `DeterministicHash()` returns `Tick`.

- [ ] **Step 4: Create the contracts file**

`ContinuousContracts.cs` contains exactly the enums, records and interfaces in the **Stable Continuous Contracts And Constants** section, plus `public sealed record CompletedParticipant(long UserId, string Result, object Stats);` if project 1 does not already declare it — check `src/Brmble.Server/Games/` first and reuse the existing type if it exists rather than shadowing it.

- [ ] **Step 5: Create a minimal coordinator before any later modify task**

Create `ContinuousGameCoordinator : IDuelMatchRunner` with `RunnerKey => "continuous"`, a `ConcurrentDictionary<long, ContinuousMatchState>` keyed by match ID, a monotonic `Interlocked.Increment` match-ID counter, the exact `StartAsync(DuelReservation)`, `TryGetActiveMatch(long stableUserId, out ActiveMatchReference)`, `ForfeitAsync(long matchId, long stableUserId, string reason)` and `MatchCompleted`.

- `StartAsync` rejects a reservation whose `Configuration.RunnerKey != RunnerKey`, resolves the definition by `Configuration.GameType`, calls `definition.Create(reservation)`, and indexes **both** `reservation.PlayerOne.UserId` and `PlayerTwo.UserId` into a `ConcurrentDictionary<long, long>` stable-user → match-ID index. Session IDs are retained only inside the live state, for later realtime input routing.
- `TryGetActiveMatch` looks up the stable-user index and returns `new ActiveMatchReference(matchId, reservationId, channelId, "continuous")`.
- `ForfeitAsync` removes both stable-user index entries and raises an abandoned `MatchCompletion`.
- Scheduler, sockets, attach gate and completion metadata are added by Tasks 8–11. Leave a comment saying so on each placeholder.

- [ ] **Step 6: Prove compatibility with project 1's existing router**

Instantiate project 1's `DuelMatchRunnerRouter([continuous], logger)`. Its existing `StartAsync` selects on `reservation.Configuration.RunnerKey` (`DuelMatchRunnerRouter.cs:26`) and its existing lookup/forfeit methods pass stable user IDs straight through. Do not create `DuelMatchRouter`, do not modify `GameSessionManager`, and do not duplicate the router's ownership maps.

- [ ] **Step 7: Run the focused tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousContractTests`

Expected: PASS. The task compiles without any Arena production type, `RunnerKey = "continuous"` flows through the existing catalog and router, stable user 501 owns the match despite session 10, and no parallel abstraction exists.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Server/Games/Continuous/ContinuousContracts.cs src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousContractTests.cs
git commit -m "refactor: add continuous game runtime boundaries"
```

## Task 4: Implement Checked Fixed-Point Math And Arena Ruleset V1

Lifted from July Task 2. The shared TypeScript math file is created **here**, before Task 14 modifies it, so that task is a valid `Modify`.

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/FixedPoint.cs`
- Create: `src/Brmble.Server/Games/Arena/ArenaRulesetV1.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/FixedPointTests.cs`
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`

**Interfaces:**
- Produces (C#): `FixedVec(int X, int Y)` with `static FixedVec NormalizeQ15(int x, int y)`, `FixedVec Scale(int amount)`, `static int IntegerSqrt(long value)`, `static ulong Fnv1a64(ReadOnlySpan<byte> bytes)`; and `ArenaRulesetV1` with every constant above plus `static int MovePerTick(int q)`, `static int Knockback(int q)`, `static int Recoil(int q)`, `static int ArenaRadius(int liveTick)`, `static int ChargePermille(int chargeTicks)` and `static object PredictionConstants`.
- Produces (TypeScript): `normalizeQ15(x, y): { x: number; y: number }`, `scale(v, amount)`, `movePerTick(q)`, `knockback(q)`, `recoil(q)`, `arenaRadius(liveTick)`, `chargePermille(chargeTicks)`, `damp(v)`. Task 14 appends prediction, reconciliation and transform helpers to this file.

- [ ] **Step 1: Write the failing normalization, curve and shrink tests**

```csharp
[DataTestMethod]
[DataRow(32767, 0, 32767, 0)]
[DataRow(32767, 32767, 23170, 23170)]
[DataRow(-32767, 32767, -23170, 23170)]
[DataRow(0, 0, 0, 0)]
public void NormalizeQ15_IsDeterministic(int x, int y, int expectedX, int expectedY) =>
    Assert.AreEqual(new FixedVec(expectedX, expectedY), FixedVec.NormalizeQ15(x, y));

[TestMethod]
public void ChargeCurves_ClampAtEndpointsAndMatchGoldenVectors()
{
    Assert.AreEqual(90, ArenaRulesetV1.MovePerTick(0));
    Assert.AreEqual(45, ArenaRulesetV1.MovePerTick(1000));
    Assert.AreEqual(45, ArenaRulesetV1.MovePerTick(5000));   // clamped
    Assert.AreEqual(90, ArenaRulesetV1.MovePerTick(-1));     // clamped
    Assert.AreEqual(350, ArenaRulesetV1.Knockback(1000));
    Assert.AreEqual(150, ArenaRulesetV1.Recoil(1000));
    Assert.AreEqual(76, ArenaRulesetV1.MovePerTick(333));
    Assert.AreEqual(203, ArenaRulesetV1.Knockback(333));
    Assert.AreEqual(79, ArenaRulesetV1.Recoil(333));
}

[DataTestMethod]
[DataRow(599, 9000)]
[DataRow(600, 8997)]
[DataRow(2399, 3500)]
[DataRow(2400, 3498)]
[DataRow(3599, 0)]
[DataRow(3600, 0)]
public void ArenaRadius_UsesExactInclusiveBoundaries(int tick, int radius) =>
    Assert.AreEqual(radius, ArenaRulesetV1.ArenaRadius(tick));

[TestMethod]
public void Damping_TruncatesTowardZeroOnBothSigns()
{
    Assert.AreEqual(322, 350 * 920 / 1000);
    Assert.AreEqual(-138, -151 * 920 / 1000);
}

[TestMethod]
public void NormalizeQ15_RejectsOverflowingInput() =>
    Assert.ThrowsException<OverflowException>(() => FixedVec.NormalizeQ15(int.MaxValue, int.MaxValue).Scale(int.MaxValue));

[TestMethod]
public void DeterministicHash_IsStableAcrossRuns()
{
    var a = FixedPointHash.OfFields(1, -2, 3, -4);
    var b = FixedPointHash.OfFields(1, -2, 3, -4);
    Assert.AreEqual(a, b);
    Assert.AreNotEqual(a, FixedPointHash.OfFields(1, -2, 3, -5));
}
```

- [ ] **Step 2: Run the tests and verify the math types are absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests`

Expected: FAIL with `CS0246` for `FixedVec`, `FixedPointHash` and `ArenaRulesetV1`.

- [ ] **Step 3: Implement integer-only vector operations**

```csharp
public readonly record struct FixedVec(int X, int Y)
{
    public static FixedVec NormalizeQ15(int x, int y)
    {
        if (x == 0 && y == 0) return default;
        var length = IntegerSqrt(checked((long)x * x + (long)y * y));
        if (length <= 32_767) return new(x, y);
        return new(checked((int)(x * 32_767L / length)), checked((int)(y * 32_767L / length)));
    }

    public FixedVec Scale(int amount) => new(
        checked((int)(X * (long)amount / 32_767)), checked((int)(Y * (long)amount / 32_767)));
}
```

Use the restoring integer-square-root algorithm over `ulong` — never `Math.Sqrt`, never `double`. All products widen to `long`, all state writes use `checked`, and `FixedPointHash.OfFields` writes each field in declared order as a little-endian `int` into FNV-1a 64 (offset basis `14695981039346656037`, prime `1099511628211`).

- [ ] **Step 4: Add every ruleset constant and exact linear helper**

Copy the `ArenaRulesetV1` block from the constants section verbatim. Add:

```csharp
public static int MovePerTick(int q) => 90 - 45 * Math.Clamp(q, 0, 1000) / 1000;
public static int Knockback(int q) => 130 + 220 * Math.Clamp(q, 0, 1000) / 1000;
public static int Recoil(int q) => 45 + 105 * Math.Clamp(q, 0, 1000) / 1000;
public static int ChargePermille(int chargeTicks) => Math.Min(1000, Math.Clamp(chargeTicks, 0, 90) * 1000 / 90);

public static int ArenaRadius(int liveTick) => liveTick switch
{
    < 600 => 9_000,
    < 2_400 => 9_000 - (5_500 * (liveTick - 599) / 1_800),
    < 3_600 => 3_500 - (3_500 * (liveTick - 2_399) / 1_200),
    _ => 0,
};
```

`PredictionConstants` is an anonymous-free `sealed record ArenaPredictionConstants(...)` whose property names match the `welcome.prediction` JSON object exactly, so protocol serialization has one source.

- [ ] **Step 5: Run the fixed-point tests on x64**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests -a x64`

Expected: PASS for axes, diagonals, zero, sign symmetry, every golden curve and shrink vector, overflow rejection and stable hash bytes.

- [ ] **Step 6: Implement and run the same golden vectors in TypeScript**

`arenaMath.ts` uses `Math.trunc` for every division, `BigInt` for widened products and the integer square root, then a checked conversion back to `number` that throws if the value is outside `Number.MIN_SAFE_INTEGER`…`Number.MAX_SAFE_INTEGER`. Copy the **seven golden-vector lines** from the constants section into table-driven Vitest assertions; do not duplicate them with different expected values.

```ts
import { describe, expect, it } from 'vitest';
import { arenaRadius, knockback, movePerTick, normalizeQ15, recoil, damp } from './arenaMath';

describe('arenaMath golden vectors', () => {
  it.each([
    [32767, 32767, 23170, 23170],
    [-32767, 32767, -23170, 23170],
    [32767, 0, 32767, 0],
    [0, 0, 0, 0],
  ])('normalizeQ15(%i,%i)', (x, y, ex, ey) => expect(normalizeQ15(x, y)).toEqual({ x: ex, y: ey }));

  it('curves at q=333', () => {
    expect(movePerTick(333)).toBe(76);
    expect(knockback(333)).toBe(203);
    expect(recoil(333)).toBe(79);
  });

  it('damps toward zero on both signs', () => expect(damp({ x: 350, y: -151 })).toEqual({ x: 322, y: -138 }));

  it.each([[599, 9000], [600, 8997], [2399, 3500], [2400, 3498], [3599, 0], [3600, 0]])(
    'arenaRadius(%i)', (tick, radius) => expect(arenaRadius(tick)).toBe(radius));
});
```

Run: `npm test -- --run src/components/Games/Arena/arenaMath.test.ts`

Working directory: `src/Brmble.Web`

Expected: PASS with integer outputs identical to the C# ones for normalization, curves, damping and shrink boundaries.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/Continuous/FixedPoint.cs src/Brmble.Server/Games/Arena/ArenaRulesetV1.cs tests/Brmble.Server.Tests/Games/Continuous/FixedPointTests.cs src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts
git commit -m "feat: add deterministic fixed-point arena rules"
```

## Task 5: Implement Arena Phases, Movement, Collision And Shrink

Lifted from July Task 3.

**Files:**
- Create: `src/Brmble.Server/Games/Arena/ArenaModels.cs`
- Create: `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- Create: `src/Brmble.Server/Games/Arena/ArenaGameDefinition.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs`

**Interfaces:**
- Consumes: `FixedVec`, `ArenaRulesetV1`, `IContinuousSimulation`, `ContinuousInput`, `ContinuousMatchPhase`, `ContinuousStepResult`, `DuelReservation`.
- Produces: `ArenaSimulation : IContinuousSimulation` with constructor `(DuelReservation reservation)`; `ArenaGameDefinition` exactly as in the contracts section; `ArenaShrinkPhase`, `ArenaKnockoutCause`, `ArenaProjectile`, `ArenaPlayerState`, `ArenaSnapshotView`. Tasks 6 and 7 modify `ArenaSimulation.cs` and `ArenaModels.cs`.

- [ ] **Step 1: Write the failing exact-tick phase and collision tests**

```csharp
[TestMethod]
public void RoundIntroduction_UsesSixtyLoadingAndOneHundredEightyPositioningTicks()
{
    var sim = ArenaHarness.AttachedAndAcknowledged();
    sim.Step(59); Assert.AreEqual(ContinuousMatchPhase.Loading, sim.Phase);
    sim.Step(1);  Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
    sim.Step(179); Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
    sim.Step(1);  Assert.AreEqual(ContinuousMatchPhase.Live, sim.Phase);
}

[TestMethod]
public void CoincidentPlayers_SeparateOnStableSessionIdAxis()
{
    var sim = ArenaHarness.Live(sessionIds: [20, 10]);
    sim.PlaceBoth(0, 0); sim.Step();
    Assert.AreEqual(-600, sim.Player(10).X);
    Assert.AreEqual(600, sim.Player(20).X);
    Assert.AreEqual(0, sim.Player(10).Y);
    Assert.IsTrue(sim.DistanceSquared() >= 1_440_000L);
}

[TestMethod]
public void Overlap_GivesTheOddUnitToTheHigherSessionId()
{
    var sim = ArenaHarness.Live(sessionIds: [10, 20]);
    sim.Place(10, 0, 0); sim.Place(20, 1000, 0); sim.Step();
    Assert.AreEqual(-100, sim.Player(10).X);
    Assert.AreEqual(1100, sim.Player(20).X);
}

[TestMethod]
public void PositioningAllowsMovementButNoCombatAction()
{
    var sim = ArenaHarness.Positioning();
    sim.Hold(10, moveX: 32767, moveY: 0, charging: true, dash: true);
    sim.Step();
    Assert.AreEqual(0, sim.Player(10).ChargeTicks);
    Assert.AreEqual(0, sim.Player(10).DashTicks);
    Assert.IsTrue(sim.Player(10).DashAvailable);
    Assert.AreEqual(-3500 + 90, sim.Player(10).X);
}

[DataTestMethod]
[DataRow(3500, 0, true)]
[DataRow(3501, 0, false)]
public void BoundaryEqualityIsInside(int x, int y, bool inside)
{
    var sim = ArenaHarness.LiveAtRadius(3500);
    Assert.AreEqual(inside, sim.IsInside(x, y));
}
```

`ArenaHarness` lives in the test file and exposes `Step(int n = 1)`, `Place`, `PlaceBoth`, `Hold`, `Player(sessionId)`, `Phase`, `Score`, `Projectiles`, `DistanceSquared()`, `IsInside(x,y)` and `LiveAtRadius(int)`. `AttachedAndAcknowledged()` drives the simulation from `AwaitingParticipants` by calling whatever `ArenaSimulation` exposes for the attach gate — in this task that is a plain `MarkParticipantReady(long sessionId)` on the simulation; Task 10 wires the coordinator's real socket gate to it.

- [ ] **Step 2: Run the phase tests and verify the simulation types are missing**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaPhaseAndMovementTests`

Expected: FAIL with `CS0246` for `ArenaSimulation`, `ArenaPlayerState` and the harness's referents.

- [ ] **Step 3: Add the complete state records**

```csharp
public enum ArenaShrinkPhase { Hold, Normal, Collapse }
public enum ArenaKnockoutCause { OpponentProjectile, Recoil, DashOrMovement, Collapse }

public sealed record ArenaProjectile(long Id, long OwnerSessionId, int X, int Y, int Vx, int Vy, int ChargePermille);

public sealed class ArenaPlayerState
{
    public required long SessionId { get; init; }
    public required int Side { get; init; }
    public int X; public int Y; public int Vx; public int Vy;
    public int AimX; public int AimY; public int ChargeTicks; public int ForcedFireTicks;
    public int CooldownTicks; public int DashTicks; public bool DashAvailable = true;
    public ContinuousInput Input = new(0, 0, 0, 0, 32767, 0, false, false, false);
}
```

Player order inside the simulation is a `ArenaPlayerState[]` sorted once by ascending `SessionId` at construction and never re-sorted. Side 0 spawns at `(-3500, 0)`, side 1 at `(3500, 0)`; the lower session ID is side 0. Sides are stable for the whole match.

- [ ] **Step 4: Implement the phase gates and deterministic body resolution**

Loading ignores all gameplay input. Positioning applies normalized movement and body collision but ignores charge, fire and dash. Live enables everything. Implement the exact 15-stage tick ordering, truncation, movement/velocity distinction, impulse timing and collision formulas from the constants section; stages 3, 4, 6, 10 and 11 are stubs in this task and are filled in by Task 6, but the **order** is final now and no later task may reorder it.

- [ ] **Step 5: Implement exact arena radius and boundary semantics**

Only Live advances the shrink tick. Use `ArenaRulesetV1.ArenaRadius`. A center with `x*x + y*y > radius*radius` (computed in `long`) is outside; equality is inside. Derive `ArenaShrinkPhase` from the same live tick: `Hold` below 600, `Normal` below 2400, `Collapse` at or above 2400.

- [ ] **Step 6: Run the phase and movement tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaPhaseAndMovementTests`

Expected: PASS for mirrored spawn, phase gates, normalized diagonal movement, charge slowdown, stable collision, no residual overlap, exact shrink ticks and boundary equality.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/Arena/ArenaModels.cs src/Brmble.Server/Games/Arena/ArenaSimulation.cs src/Brmble.Server/Games/Arena/ArenaGameDefinition.cs tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs
git commit -m "feat: simulate arena phases movement and collision"
```

## Task 6: Add Charge, Fire, Cooldown, Recoil, Projectiles And Dash

Lifted from July Task 4.

**Files:**
- Modify: `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaCombatTests.cs`

**Interfaces:**
- Consumes: everything Task 5 produced.
- Produces: filled-in tick stages 3, 4, 6, 10 and 11; `ArenaSimulation.Projectiles` (ordered by ascending projectile ID) available to the harness and to Task 7's snapshot view.

- [ ] **Step 1: Write the failing cadence and forced-fire tests**

```csharp
[TestMethod]
public void MaximumCharge_ForceFiresAfterThirtyTicksAndStartsTwentyFourTickCooldown()
{
    var sim = ArenaHarness.Live();
    sim.HoldCharge(10, 120); sim.Step(119);
    Assert.AreEqual(0, sim.Projectiles.Count);
    sim.Step();
    Assert.AreEqual(1, sim.Projectiles.Count);
    Assert.AreEqual(24, sim.Player(10).CooldownTicks);
    Assert.AreEqual(1000, sim.Projectiles[0].ChargePermille);
}

[TestMethod]
public void ChargeDoesNotChangeProjectileRadiusOrSpeed()
{
    var low = ArenaHarness.Fire(chargeTicks: 0);
    var high = ArenaHarness.Fire(chargeTicks: 90);
    Assert.AreEqual(180, ArenaRulesetV1.ProjectileRadius);
    Assert.AreEqual(low.ProjectileVelocityLengthSquared, high.ProjectileVelocityLengthSquared);
}

[TestMethod]
public void ReleaseAtZeroChargeFiresImmediatelyAndCooldownBlocksTheNextCharge()
{
    var sim = ArenaHarness.Live();
    sim.ReleaseFire(10); sim.Step();
    Assert.AreEqual(1, sim.Projectiles.Count);
    sim.HoldCharge(10, 24); sim.Step(23);
    Assert.AreEqual(0, sim.Player(10).ChargeTicks);   // no charge accrues during cooldown
    Assert.AreEqual(1, sim.Player(10).CooldownTicks);
}

[TestMethod]
public void ProjectilesPassThroughEachOtherAndOnlyHitTheOpponent()
{
    var sim = ArenaHarness.LiveWithOpposingShots();
    sim.Step(10);
    Assert.AreEqual(2, sim.Projectiles.Count);          // no mutual cancellation
    Assert.AreEqual(0, sim.Player(10).Vx + sim.Player(10).Vy); // own projectile did not hit its owner
}

[TestMethod]
public void DashIsOneUsePerRoundAndUsesAimWhenStationary()
{
    var sim = ArenaHarness.Live();
    sim.Aim(10, 0, 32767); sim.DashEdge(10); sim.Step();
    Assert.IsFalse(sim.Player(10).DashAvailable);
    Assert.AreEqual(240, sim.Player(10).Y);
    sim.DashEdge(10); sim.Step();
    Assert.AreEqual(5, sim.Player(10).DashTicks);       // the second edge was ignored, not restarted
}
```

- [ ] **Step 2: Run the combat tests and verify the missing behaviour**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaCombatTests`

Expected: FAIL — no projectile is ever spawned, dash never consumes availability, cooldown is never set.

- [ ] **Step 3: Implement edge-deduplicated fire and cooldown**

On a rising `FireReleased` edge, fire even at charge 0, but only when Live and cooldown is 0. Maximum charge starts a 30-tick forced-fire counter on the 89→90 transition only; fire automatically when it reaches 0. Spawn at `player center + aim.Scale(600 + 180)`, velocity `aim.Scale(240)`, apply the opposite recoil to velocity, reset charge and forced fire, set cooldown 24. Ignore charge starts during cooldown. Projectile IDs come from a per-match monotonic counter that never resets within a match.

- [ ] **Step 4: Implement projectile collision and removal**

Advance projectiles in ascending projectile ID. They never compare with each other. Each compares only with the **opposing** body, using radius sum 780 and squared distance in `long`. On a hit, apply `Knockback(chargePermille)` along the normalized travel direction to the opponent's velocity, increment shot/hit telemetry counters, and remove the projectile. Also remove a projectile whose center is outside the current arena radius.

- [ ] **Step 5: Implement the one-use collision-respecting dash**

On a deduplicated `Dash` edge in Live, consume availability and set six dash ticks. Each dash tick moves 240 along the normalized movement vector, or along aim if movement is zero, and then stage 9's body collision still applies. No invulnerability and no boundary clamp. Round reset restores availability (Task 7).

- [ ] **Step 6: Run the combat tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaCombatTests`

Expected: PASS for the immediate low shot, cooldown rejection, forced fire, constant projectile geometry and speed, projectile pass-through, opponent-only hits, charge-scaled force and recoil, coexisting projectiles, one-use dash, stationary aim dash and dash collision.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/Arena/ArenaSimulation.cs tests/Brmble.Server.Tests/Games/Arena/ArenaCombatTests.cs
git commit -m "feat: add arena projectiles recoil and dash"
```

## Task 7: Complete BO3 Rounds, KO Causes, Double-KO Anti-Loop And The Snapshot View

Lifted from July Task 5, with the snapshot-view half of July Task 11 Step 3 pulled forward because Task 11 (spectator authorization) is out of 3a and the participant path needs the view now.

**Files:**
- Modify: `src/Brmble.Server/Games/Arena/ArenaModels.cs`
- Modify: `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaMatchTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaDeterminismTests.cs`

**Interfaces:**
- Produces: `ArenaSnapshotView` — the immutable world state whose field names and shapes match the `snapshot` JSON in the protocol section exactly, minus the envelope. `ParticipantSnapshot(sessionId, acknowledgedInputs)` returns that view with each player's `acknowledgedInput` filled in; `SpectatorSnapshot()` returns the same view with every `acknowledgedInput` omitted. **Only `ParticipantSnapshot` is called in 3a.** Also produces `ContinuousCompletion` with `MatchSummary` = metadata schema 1, consumed by Task 10.

- [ ] **Step 1: Write the failing round and match outcome tests**

```csharp
[TestMethod]
public void FourthConsecutiveSameTickDoubleKo_EndsMatchDrawWithoutScoreChange()
{
    var sim = ArenaHarness.Live();
    for (var replay = 1; replay <= 4; replay++)
    {
        sim.PlaceBothOutside(); sim.Step();
        if (replay < 4) { CollectionAssert.AreEqual(new[] { 0, 0 }, sim.Score.ToArray()); sim.StepRoundIntroduction(); }
    }
    Assert.IsTrue(sim.Completed);
    Assert.AreEqual("draw", sim.Completion!.Outcome);
    Assert.AreEqual(4, sim.Telemetry.DoubleKoReplays);
}

[TestMethod]
public void FirstToTwoWinsCompletesBo3AndDecisiveRoundResetsDoubleKoCounter()
{
    var sim = ArenaHarness.Live();
    sim.DoubleKo(); sim.WinRound(10); sim.WinRound(10);
    CollectionAssert.AreEqual(new[] { 2, 0 }, sim.Score.ToArray());
    Assert.AreEqual(0, sim.ConsecutiveDoubleKos);
    Assert.AreEqual("decided", sim.Completion!.Outcome);
}

[TestMethod]
public void RoundResetClearsEveryPerRoundValueAndRestoresDash()
{
    var sim = ArenaHarness.Live();
    sim.HoldCharge(10, 30); sim.DashEdge(20); sim.Step(30);
    sim.WinRound(10);
    sim.StepRoundIntroduction();
    foreach (var id in new[] { 10L, 20L })
    {
        Assert.AreEqual(0, sim.Player(id).Vx); Assert.AreEqual(0, sim.Player(id).Vy);
        Assert.AreEqual(0, sim.Player(id).ChargeTicks);
        Assert.AreEqual(0, sim.Player(id).ForcedFireTicks);
        Assert.AreEqual(0, sim.Player(id).CooldownTicks);
        Assert.IsTrue(sim.Player(id).DashAvailable);
    }
    Assert.AreEqual(0, sim.Projectiles.Count);
    Assert.AreEqual(9000, sim.View().Arena.Radius);
    Assert.AreEqual(-3500, sim.Player(10).X);
}

[TestMethod]
public void ParticipantSnapshotCarriesAcknowledgementsAndSpectatorSnapshotDoesNot()
{
    var sim = ArenaHarness.Live();
    var participant = (ArenaSnapshotView)sim.Simulation.ParticipantSnapshot(10,
        new Dictionary<long, long> { [10] = 42, [20] = 37 });
    Assert.AreEqual(42, participant.Players.Single(p => p.SessionId == 10).AcknowledgedInput);
    var spectator = (ArenaSnapshotView)sim.Simulation.SpectatorSnapshot();
    Assert.IsTrue(spectator.Players.All(p => p.AcknowledgedInput is null));
}
```

And in `ArenaDeterminismTests.cs`:

```csharp
[TestMethod]
public void IdenticalInputStream_ProducesIdenticalPerTickHashesAndOutcome()
{
    var inputs = DeterministicInputGenerator.Build(seed: 0xA8E1, ticks: 3_600);
    var first = ArenaHarness.RunToCompletion(sessionIds: [10, 20], inputs);
    var second = ArenaHarness.RunToCompletion(sessionIds: [10, 20], inputs);
    CollectionAssert.AreEqual(first.TickHashes, second.TickHashes);
    Assert.AreEqual(first.Outcome, second.Outcome);
}

[TestMethod]
public void MirroredInputsAndSides_ProduceMirroredScores()
{
    var inputs = DeterministicInputGenerator.Build(seed: 0xA8E1, ticks: 3_600);
    var normal = ArenaHarness.RunToCompletion(sessionIds: [10, 20], inputs);
    var mirrored = ArenaHarness.RunToCompletion(sessionIds: [10, 20], DeterministicInputGenerator.Mirror(inputs));
    CollectionAssert.AreEqual(normal.Score.Reverse().ToArray(), mirrored.Score.ToArray());
}
```

`DeterministicInputGenerator` is a **test-only** type. Its seeded PRNG generates the input stream and nothing else; no randomness may enter `ArenaSimulation`.

- [ ] **Step 2: Run the match tests and verify terminal behaviour fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ArenaMatchTests|FullyQualifiedName~ArenaDeterminismTests"`

Expected: FAIL — scoring, round replay, telemetry, the snapshot view and completion are all absent.

- [ ] **Step 3: Implement same-tick terminal classification**

Evaluate both centers only at stage 13, after all movement, collision, recoil, projectile and radius updates for the tick. One outside is a round loss; both outside on the same tick is a double KO. Classify the most recent boundary-causing event as `OpponentProjectile`, `Recoil`, `DashOrMovement` or `Collapse`. Ordinary movement and dash share `DashOrMovement` in persisted telemetry.

- [ ] **Step 4: Reset all round state and enforce BO3 and the anti-loop**

Every round and replay clears momentum, projectiles, charge, forced fire, cooldown and shrink tick, restores dash availability, mirrors spawns, resets inputs to neutral, and runs Loading plus Positioning again. A double KO does not score and increments the consecutive count. Counts 1–3 replay; count 4 completes the match as a draw. Any decisive round resets the count to 0. The first score of 2 completes.

- [ ] **Step 5: Define the one complete snapshot view**

Add immutable `ArenaSnapshotView` and its nested `ArenaPlayerView` / `ArenaProjectileView` / `ArenaArenaView`, matching the protocol JSON field-for-field. `ArenaPlayerView.AcknowledgedInput` is `long?` and is `null` in the spectator projection. The view is built once per generated snapshot, under the match lock, and is never mutated after construction. No `SpectatorSourceFrame` is created for Arena, ever.

Build `ContinuousCompletion` here too: `Outcome` is `"decided"`, `"draw"` or `"abandoned"`; `MatchSummary` is metadata schema 1 containing final score, rounds played, double-KO replays, round durations, KO causes, shot and hit counts, fired and landed charge arrays, dash use and KO radii.

- [ ] **Step 6: Run all Arena simulation tests repeatedly**

Run: `1..20 | ForEach-Object { dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Arena"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`

Expected: PASS on all 20 runs with identical per-tick hashes, exact phases, BO3 completion and bounded symmetric double-KO behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/Arena/ArenaModels.cs src/Brmble.Server/Games/Arena/ArenaSimulation.cs tests/Brmble.Server.Tests/Games/Arena/ArenaMatchTests.cs tests/Brmble.Server.Tests/Games/Arena/ArenaDeterminismTests.cs
git commit -m "feat: complete arena knockoff ruleset v1"
```

## Task 8: Add 60 Hz Scheduling And Replaceable 20 Hz Backpressure

Lifted from July Task 6.

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/FixedStepScheduler.cs`
- Create: `src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/FixedStepSchedulerTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/RealtimeSnapshotMailboxTests.cs`

**Interfaces:**
- Produces: `FixedStepScheduler(TimeProvider clock, int tickRate, int maxCatchUpTicks)` with `Start(long timestamp)`, `CyclePlan PlanCycle()` returning `(int Ticks, bool Overloaded, long NextDeadline)`, `long AdvanceDeadline()` and `long NextDeadline`. And `RealtimeSnapshotMailbox` with `void WriteControl(RealtimeControl control)`, `void ReplaceSnapshot(string json)`, `ValueTask<RealtimeOutbound> ReadNextAsync(CancellationToken)`, `int DroppedSnapshots`, `bool Overloaded`. `RealtimeControl` is `(string Type, long? SessionId, long? Sequence, string Json, bool Coalescible)`.

- [ ] **Step 1: Write the failing cadence, catch-up and replacement tests**

```csharp
[TestMethod]
public void DelayedCycle_RunsAtMostFiveTicksAndResynchronizesDeadline()
{
    var clock = new ManualTimestampClock(frequency: 60_000);
    var sut = new FixedStepScheduler(clock, tickRate: 60, maxCatchUpTicks: 5);
    sut.Start(clock.Timestamp);
    clock.AdvanceMilliseconds(200);
    var cycle = sut.PlanCycle();
    Assert.AreEqual(5, cycle.Ticks);
    Assert.IsTrue(cycle.Overloaded);
    Assert.AreEqual(clock.Timestamp + 1_000L, cycle.NextDeadline);
}

[TestMethod]
public void RationalPeriod_ProducesExactlySixtyDeadlinesPerSecond()
{
    var sut = new FixedStepScheduler(new ManualTimestampClock(10_000_000), 60, 5);
    sut.Start(0);
    CollectionAssert.AreEqual(new long[] { 166_666, 333_333, 500_000, 666_666, 833_333, 1_000_000 },
        Enumerable.Range(0, 6).Select(_ => sut.AdvanceDeadline()).ToArray());
    for (var i = 6; i < 60; i++) sut.AdvanceDeadline();
    Assert.AreEqual(10_000_000L, sut.NextDeadline);
}

[TestMethod]
public async Task SlowWriter_ReceivesLatestSnapshotNotTwentyQueuedSnapshots()
{
    var box = new RealtimeSnapshotMailbox();
    for (var i = 1; i <= 20; i++) box.ReplaceSnapshot($"s{i}");
    Assert.AreEqual("s20", (await box.ReadNextAsync(default)).Json);
    Assert.AreEqual(19, box.DroppedSnapshots);
}

[TestMethod]
public async Task CoalescibleControlsReplaceTheirOwnKeyAndTerminalControlsAlwaysFit()
{
    var box = new RealtimeSnapshotMailbox();
    for (var i = 1; i <= 30; i++) box.WriteControl(Reject(sequence: 7, reason: $"r{i}"));
    box.WriteControl(MatchClosed(sequence: 121));
    var drained = await DrainAsync(box);
    Assert.AreEqual(1, drained.Count(c => c.Type == "inputRejected"));
    Assert.AreEqual("r30", drained.Single(c => c.Type == "inputRejected").Reason());
    Assert.IsTrue(drained.Any(c => c.Type == "matchClosed"));
    Assert.IsFalse(box.Overloaded);
}

[TestMethod]
public async Task SendLoopFairness_EmitsAtMostFourControlsBeforeTheLatestSnapshot()
{
    var box = new RealtimeSnapshotMailbox();
    for (var i = 1; i <= 6; i++) box.WriteControl(ConnectionState(sessionId: i, state: "reconnecting"));
    box.ReplaceSnapshot("s1");
    var first = await TakeAsync(box, 5);
    Assert.AreEqual(4, first.Count(x => x.IsControl));
    Assert.AreEqual("s1", first[4].Json);
}
```

`ManualTimestampClock` is a test `TimeProvider` subclass overriding `TimestampFrequency` and `GetTimestamp()`.

- [ ] **Step 2: Run the tests and verify the scheduler and mailbox are missing**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~FixedStepSchedulerTests|FullyQualifiedName~RealtimeSnapshotMailboxTests"`

Expected: FAIL with `CS0246` for `FixedStepScheduler` and `RealtimeSnapshotMailbox`.

- [ ] **Step 3: Implement monotonic deadline arithmetic**

Use `TimeProvider.GetTimestamp()` and a rational accumulator: `basePeriod = frequency / 60`, `remainder = frequency % 60`, `carry += remainder`, then add `basePeriod + (carry >= 60 ? 1 : 0)` and subtract 60 from `carry` when it carries. **Never** repeatedly truncate `frequency / 60`. Normal catch-up advances the previous deadline once per simulated tick; after five overdue ticks, record the overload, clear `carry`, and schedule the first new deadline from `now` with the same rational formula.

- [ ] **Step 4: Implement separate reliable and replacement queues**

`RealtimeSnapshotMailbox` holds a bounded capacity-16 `Channel` for controls and a capacity-one drop-oldest `Channel` for snapshots. Implement the coalescing rules from the protocol section: a coalescible control replaces an older pending entry with the same `(Type, SessionId)` or `(Type, Sequence)` key; noncoalescible `welcome` and `matchClosed` reserve two slots, and a writer that cannot enqueue one sets `Overloaded` (the endpoint closes the socket in Task 12). `ReadNextAsync` implements the four-controls-then-latest-snapshot fairness rule so snapshots cannot be starved. Obsolete snapshots may be dropped; terminal state may not.

- [ ] **Step 5: Run the cadence tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~FixedStepSchedulerTests|FullyQualifiedName~RealtimeSnapshotMailboxTests"`

Expected: PASS for exactly 60 ticks per second, the five-tick catch-up maximum, deadline resynchronization, latest-only snapshot replacement, control coalescing and send-loop fairness.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/Continuous/FixedStepScheduler.cs src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs tests/Brmble.Server.Tests/Games/Continuous/FixedStepSchedulerTests.cs tests/Brmble.Server.Tests/Games/Continuous/RealtimeSnapshotMailboxTests.cs
git commit -m "feat: schedule continuous matches with snapshot backpressure"
```

## Task 9: Validate Inputs, Heartbeats And The Neutral Timeout

Lifted from July Task 7.

**Files:**
- Modify: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs`

**Interfaces:**
- Produces on `ContinuousGameCoordinator`: `InputResult SubmitInput(long matchId, long sessionId, RealtimeRole role, ContinuousInput input, bool isHeartbeat)` returning `(bool Accepted, ContinuousRejectReason Reason, long AcknowledgedInput)`. Task 12's receive loop is the only caller.

- [ ] **Step 1: Write the failing sequence, rate and neutral tests**

```csharp
[TestMethod]
public void InputValidation_DeduplicatesEdgesRejectsGapAndNeutralizesAfterSevenHundredFiftyMs()
{
    var h = CoordinatorHarness.LiveArena();
    Assert.IsTrue(h.Input(10, Seq(1, dash: true)).Accepted);
    Assert.AreEqual(ContinuousRejectReason.StaleSequence, h.Input(10, Seq(1, dash: true)).Reason);
    Assert.AreEqual(ContinuousRejectReason.SequenceGap, h.Input(10, Seq(3)).Reason);
    h.AdvanceMilliseconds(751);
    Assert.IsTrue(h.InputFor(10).IsNeutral);
    Assert.IsFalse(h.Simulation.Player(10).DashAvailable); // neutral does NOT restore a spent edge
}

[TestMethod]
public void RateLimits_AreOneHundredTwentyMessagesAndThirtyAimChangesPerRollingSecond()
{
    var h = CoordinatorHarness.LiveArena();
    for (var i = 1; i <= 120; i++) Assert.IsTrue(h.Input(10, Seq(i)).Accepted);
    Assert.AreEqual(ContinuousRejectReason.RateLimited, h.Input(10, Seq(121)).Reason);
    h.AdvanceMilliseconds(1_000);
    Assert.IsTrue(h.Input(10, Seq(121)).Accepted);
}

[DataTestMethod]
[DataRow(0, 0, ContinuousRejectReason.InvalidRange)]        // zero aim
[DataRow(40_000, 0, ContinuousRejectReason.InvalidRange)]   // axis out of range
public void AimValidation_RejectsZeroAndOutOfRangeVectors(int aimX, int aimY, ContinuousRejectReason expected)
{
    var h = CoordinatorHarness.LiveArena();
    Assert.AreEqual(expected, h.Input(10, Seq(1, aimX: aimX, aimY: aimY)).Reason);
}

[TestMethod]
public void PredictedTickOutsideTheAcceptedWindowIsRejected()
{
    var h = CoordinatorHarness.LiveArena(serverTick: 1_000);
    Assert.AreEqual(ContinuousRejectReason.InvalidRange, h.Input(10, Seq(1, predictedTick: 879)).Reason);
    Assert.AreEqual(ContinuousRejectReason.InvalidRange, h.Input(10, Seq(1, predictedTick: 1_031)).Reason);
    Assert.IsTrue(h.Input(10, Seq(1, predictedTick: 1_000)).Accepted);
}

[TestMethod]
public void RejectedMessagesDoNotAdvanceAcknowledgement()
{
    var h = CoordinatorHarness.LiveArena();
    h.Input(10, Seq(1));
    h.Input(10, Seq(3));
    Assert.AreEqual(1, h.AcknowledgedInput(10));
    Assert.IsTrue(h.Input(10, Seq(2)).Accepted);
}
```

- [ ] **Step 2: Run the input tests and verify validation is absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousInputTests`

Expected: FAIL — `SubmitInput` does not exist on the coordinator.

- [ ] **Step 3: Add the exact limits and validation order**

Accept at most 120 total input/heartbeat messages and 30 aim-changing messages per rolling second per participant. Require exactly `sequence == lastAccepted + 1`; reject `<= lastAccepted` as `StaleSequence` and `> lastAccepted + 1` as `SequenceGap`. Require `predictedTick` in `[serverTick - 120, serverTick + 30]`, each axis in `[-32767, 32767]`, normalized movement, a nonzero normalized aim, a matching match ID, `RealtimeRole.Participant`, and phase-legal edges (`PhaseDenied` outside Live for charge/fire/dash, `Cooldown` for a fire attempt during cooldown, `DashSpent` for a second dash in a round). Rejected messages do not advance acknowledgement. `welcome` and every snapshot always report `acknowledgedInput`; a new connection's first legal sequence is exactly `acknowledgedInput + 1`.

- [ ] **Step 4: Install neutral state on every required path**

A heartbeat carries complete held state and is validated identically, except that it may not carry `fireReleased` or `dash` edges. Track the last accepted input or heartbeat monotonic timestamp; after 750 ms, call `IContinuousSimulation.SetNeutralInput(sessionId)` — which zeroes movement and charging but does **not** restore a spent dash or a consumed fire edge. Also neutralize immediately on participant socket loss, on an explicit capture-release input, on a replacement socket attach, and on match teardown.

- [ ] **Step 5: Run the input tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousInputTests`

Expected: PASS for exact-next ordering, gap rejection, edge deduplication, ranges, normalization, the 120/30 per-second limits, role/phase/cooldown/dash rejection, 250 ms heartbeat acceptance, 750 ms neutralization and acknowledgement behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs
git commit -m "feat: validate continuous inputs and stale heartbeats"
```

## Task 10: Implement The Participant Attach Gate, Reconnect Grace, Completion And Registration

Lifted from July Task 8. **Deviation from the July plan:** it also injected `ISpectatorCoordinator` into the coordinator and called `RegisterContinuousMatchAsync` on start. 3a does not touch `SpectatorService` at all (revision spec §4.1), so that injection and that call are **not** made here. Slice 3b adds both.

**Files:**
- Modify: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs`

**Interfaces:**
- Consumes: `ContinuousCompletion` and `ArenaSnapshotView` from Task 7; `FixedStepScheduler` and `RealtimeSnapshotMailbox` from Task 8; `SubmitInput` from Task 9.
- Produces on `ContinuousGameCoordinator`, all called only by Task 12's endpoint: `Task<AttachResult> AttachParticipantAsync(long matchId, long stableUserId, long sessionId, string connectionId, RealtimeSnapshotMailbox mailbox)` returning `(bool Ok, WelcomeMessage? Welcome, string? Error)`; `void AcknowledgeAttach(string connectionId, long snapshotSequence)`; `Task DetachAsync(string connectionId)`.

- [ ] **Step 1: Write the failing attach, reconnect and completion tests**

```csharp
[TestMethod]
public async Task FirstLoadingWaitsForBothAttachAcksAndFifteenSecondFailureForfeits()
{
    var h = CoordinatorHarness.StartedArena();
    await h.AttachParticipantAsync(10, acknowledge: true);
    h.AdvanceSeconds(14); Assert.AreEqual(ContinuousMatchPhase.AwaitingParticipants, h.Phase);
    h.AdvanceSeconds(1);
    Assert.AreEqual("connection_timeout", h.CompletedMatch.AbandonReason);
    Assert.AreEqual(502, h.CompletedMatch.Participants.Single(x => x.Result == "abandoned").UserId);
}

[TestMethod]
public async Task BothAcksTransitionToLoadingAndAnAttachedSocketAloneDoesNot()
{
    var h = CoordinatorHarness.StartedArena();
    await h.AttachParticipantAsync(10, acknowledge: false);
    await h.AttachParticipantAsync(20, acknowledge: false);
    Assert.AreEqual(ContinuousMatchPhase.AwaitingParticipants, h.Phase);
    h.Acknowledge(10); h.Acknowledge(20);
    Assert.AreEqual(ContinuousMatchPhase.Loading, h.Phase);
}

[TestMethod]
public async Task ReconnectWithinFiveSecondsGetsCompleteSnapshotAndNoStaleInput()
{
    var h = CoordinatorHarness.LiveArena();
    await h.DisconnectAsync(10); h.AdvanceMilliseconds(4_999);
    var welcome = await h.ReattachAsync(10, newSessionId: 11);
    Assert.AreEqual(h.ServerTick, welcome.ServerTick);
    Assert.AreEqual(welcome.AcknowledgedInput + 1, h.NextAcceptedSequence(11));
    Assert.IsTrue(h.InputFor(11).IsNeutral);
    Assert.IsNull(h.CompletedMatch);
    // The stable user still owns the match; only the transient session moved.
    Assert.IsTrue(h.Coordinator.TryGetActiveMatch(501, out _));
}

[TestMethod]
public async Task TheSimulationDoesNotPauseDuringTheReconnectGrace()
{
    var h = CoordinatorHarness.LiveArena();
    var before = h.ServerTick;
    await h.DisconnectAsync(10); h.AdvanceMilliseconds(2_000);
    Assert.IsTrue(h.ServerTick > before);
}

[TestMethod]
public async Task GraceExpiryForfeitsTheMatchNotTheRound()
{
    var h = CoordinatorHarness.LiveArena();
    await h.DisconnectAsync(10); h.AdvanceMilliseconds(5_001);
    Assert.AreEqual("realtime_disconnect", h.CompletedMatch!.AbandonReason);
}

[TestMethod]
public async Task CompletionEnqueuesPersistenceThenRaisesMatchCompletedWithoutAwaitingTheSink()
{
    var h = CoordinatorHarness.LiveArena(slowSink: true);
    await h.ForceCompletionAsync();
    Assert.IsTrue(h.MatchCompletedRaised);
    Assert.IsFalse(h.SinkFlushed);   // queue advancement never waits on persistence
    Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
    Assert.AreEqual(0, h.Publisher.ArenaSnapshotEventCount);  // zero world state on the event bus
}
```

- [ ] **Step 2: Run the coordinator tests and verify the lifecycle failures**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousGameCoordinatorTests`

Expected: FAIL — `AttachParticipantAsync`, the attach gate, the reconnect grace and completion routing do not exist.

- [ ] **Step 3: Implement start and the first-round gate**

`StartAsync(DuelReservation)` already validates `RunnerKey` (Task 3). Extend it to: validate the canonical Arena configuration, create `AwaitingParticipants` state, index the stable users from `DuelPlayer.UserId`, store the current realtime sessions from `DuelPlayer.SessionId`, publish reliable `game.started` through the existing `IGameEventPublisher`, and arm **one generation-safe** 15-second timer (the timer callback must verify the match generation counter so a rearmed or completed match cannot be forfeited by a stale callback).

Each attached participant socket receives `welcome` plus a complete snapshot at sequence 1 and must send a matching `attachAck`. **Only both acknowledgements transition to Loading.** Do not start the scheduler before that transition.

- [ ] **Step 4: Implement the non-pausing five-second reconnect grace**

Socket loss immediately neutralizes that participant's input and writes a `connectionState` control to the surviving participant's mailbox; the simulation continues. A fresh participant ticket and socket for the **same stable user** may replace the transient session mapping, receives a complete snapshot containing the last accepted input acknowledgement, and resumes at exactly `acknowledgedInput + 1`. Grace expiry calls `ForfeitAsync(matchId, stableUserId, "realtime_disconnect")`.

Project 1 already routes voice leave and disconnect immediately through `IDuelMatchRunnerRouter.TryGetActiveMatch(stableUserId, …)` and `ForfeitAsync(…, stableUserId, …)`. Do not modify that presence flow.

- [ ] **Step 5: Own the scheduler and the snapshot fan-out**

On the transition to Loading, start one `Task` per match running the `FixedStepScheduler` loop. Each cycle: plan the cycle, step the simulation that many times, and on every tick divisible by 3 build **one** immutable `ArenaSnapshotView` under the match lock, serialize it once per participant envelope, and call `ReplaceSnapshot` on each attached participant's mailbox. Capture is separated from sending: the loop never awaits a socket write. `IGameEventPublisher` is never called with world state.

- [ ] **Step 6: Build the completion records and release before persistence retry**

Produce `CompletedMatch("arena-knockoff", channelId, "bo3", 1, outcome, abandonReason, startedAt, endedAt, participants, metadataJson)` with persisted participant IDs from `DuelPlayer.UserId`, never session IDs. Enqueue through project 1's existing `ICompletedMatchSink`, remove both stable-user index entries, raise the unchanged `MatchCompletion(matchId, reservationId, channelId, playerOne, playerTwo, configuration, endedAt)`, then publish `game.ended`. **Never await persistence before queue advancement.** Write `matchClosed` into every attached mailbox before teardown.

- [ ] **Step 7: Register the definition and the runner in project 1's existing collections**

In `GamesExtensions.cs`, alongside the existing registrations:

```csharp
services.AddSingleton<Arena.ArenaGameDefinition>();
services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<Arena.ArenaGameDefinition>());
services.AddSingleton<Continuous.IContinuousGameDefinition>(sp => sp.GetRequiredService<Arena.ArenaGameDefinition>());
services.AddSingleton<Continuous.ContinuousGameCoordinator>();
services.AddSingleton<IDuelMatchRunner>(sp => sp.GetRequiredService<Continuous.ContinuousGameCoordinator>());
```

Project 1's existing `DuelMatchRunnerRouter(IEnumerable<IDuelMatchRunner>, ILogger)` then discovers both `"discrete"` and `"continuous"` with no change. Do **not** inject `ISpectatorCoordinator`, do not replace `IDuelMatchRunnerRouter`, do not alter `GameSessionManager`, and do not bind continuous state to the discrete spectator source.

- [ ] **Step 8: Run the continuous and discrete lifecycle tests together**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ContinuousGameCoordinatorTests|FullyQualifiedName~GameSessionManagerTests|FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~SpectatorServiceTests|FullyQualifiedName~GamesExtensionsTests"`

Expected: PASS. The initial gate, later rounds entering Loading immediately, reconnect, immediate voice forfeit, persistence enqueue, queue advancement and unchanged Deathroll/RPS behaviour all coexist. `SpectatorServiceTests` must pass **unmodified** — if it does not, this task touched something it must not have.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs src/Brmble.Server/Games/GamesExtensions.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs
git commit -m "feat: coordinate continuous match lifecycle and reconnects"
```

## Task 11: Issue Bounded One-Time Tickets Through The Existing mTLS GameService

Lifted from July Task 9, **participant role only**. The July plan's Step 4 required checking "the descriptor's canonical configuration `RunnerKey`" returned from `ISpectatorCoordinator.AuthorizeAsync`. That is unimplementable — `AuthorizeAsync` returns no descriptor, and `SpectatorMatchDescriptor` has no `Configuration` member (`SpectatorModels.cs:67-78`). Revision spec §2.2 replaces it with a `ContinuousGameCoordinator.TryGetActiveMatch` check, which is what this task implements. **`ISpectatorCoordinator` is not called at all.**

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/RealtimeTicketStore.cs`
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Modify: `src/Brmble.Server/appsettings.json`
- Modify: `src/Brmble.Client/Services/Games/GameService.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/RealtimeTicketStoreTests.cs`
- Modify: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`
- Modify: `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`

**Interfaces:**
- Produces: `RealtimeTicketStore(TimeProvider time, IOptions<GamesRealtimeOptions> options)` with `IssuedTicket Issue(long stableUserId, long sessionId, long matchId, RealtimeRole role)` returning `(string Token, DateTimeOffset ExpiresAt)`, `bool TryConsume(string token, out TicketScope scope)` where `TicketScope` is `(long StableUserId, long SessionId, long MatchId, RealtimeRole Role)`, `void Scavenge()`, `int Count`, and `RealtimeTicketLimitException`. Task 12's endpoint is the only consumer of `TryConsume`.

- [ ] **Step 1: Write the failing expiry, scope, race and native tests**

```csharp
[TestMethod]
public async Task ConcurrentConsumption_AllowsExactlyOneUse()
{
    var store = TicketHarness.Create(now: DateTimeOffset.UnixEpoch);
    var issued = store.Issue(100, 10, 91, RealtimeRole.Participant);
    var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ =>
        Task.Run(() => store.TryConsume(issued.Token, out _))));
    Assert.AreEqual(1, results.Count(x => x));
}

[TestMethod]
public void Issue_EnforcesPerUserAndGlobalBoundsAndScavengesExpiredTickets()
{
    var store = TicketHarness.Create(now: DateTimeOffset.UnixEpoch, globalLimit: 10, perUserLimit: 2);
    store.Issue(100, 10, 91, RealtimeRole.Participant);
    store.Issue(100, 10, 91, RealtimeRole.Participant);
    Assert.ThrowsException<RealtimeTicketLimitException>(() => store.Issue(100, 10, 91, RealtimeRole.Participant));
    store.AdvanceSeconds(15); store.Scavenge();
    Assert.AreEqual(0, store.Count);
}

[TestMethod]
public void TicketExpiresExactlyFifteenSecondsAfterIssue()
{
    var store = TicketHarness.Create(now: DateTimeOffset.UnixEpoch);
    var issued = store.Issue(100, 10, 91, RealtimeRole.Participant);
    Assert.AreEqual(DateTimeOffset.UnixEpoch.AddSeconds(15), issued.ExpiresAt);
    store.AdvanceMilliseconds(14_999);
    Assert.IsTrue(store.TryConsume(issued.Token, out var scope));
    Assert.AreEqual(91, scope.MatchId);

    var second = store.Issue(100, 10, 91, RealtimeRole.Participant);
    store.AdvanceSeconds(15);
    Assert.IsFalse(store.TryConsume(second.Token, out _));
}

[TestMethod]
public void TheRawTokenIsNeverStored()
{
    var store = TicketHarness.Create(now: DateTimeOffset.UnixEpoch);
    var issued = store.Issue(100, 10, 91, RealtimeRole.Participant);
    Assert.IsFalse(store.DebugKeys.Contains(issued.Token));
    Assert.IsTrue(store.DebugKeys.Contains(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(issued.Token)))));
}
```

In `GameEndpointsTests.cs`, assert that `POST /games/realtime-ticket` for a user with no live continuous match returns 400 with `{"reason":"matchNotLive"}`, that a user whose live match belongs to the discrete runner returns the same, and that a participant of a live continuous match receives `protocolVersion`, `ticket`, `url` and `expiresAt`.

In `GameServiceTests.cs`, send `games.request` with `{ action: "realtime-ticket", matchId: 91, role: "participant", requestId: 7 }` and assert exactly one POST to `games/realtime-ticket` with body `{"matchId":91,"role":"participant"}` and exactly one `games.response` correlated to `requestId` 7. Follow the existing test file's harness for the `_postJsonAsync` fake; do not build a new one.

- [ ] **Step 2: Run the ticket and native tests and verify the missing routes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RealtimeTicketStoreTests|FullyQualifiedName~GameEndpointsTests"`

Expected: FAIL with `CS0246` for `RealtimeTicketStore`, and 404 for `/games/realtime-ticket`.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~GameServiceTests`

Expected: FAIL — the response is `Unknown games request action 'realtime-ticket'` (`GameService.cs:176`).

- [ ] **Step 3: Implement hashed one-time ticket storage**

Use `RandomNumberGenerator.GetBytes(32)` and Base64URL without padding. The dictionary key is the SHA-256 of the token; the raw token is never retained. Use the injected `TimeProvider` and a single lock around scope validation and removal. `Issue` returns expiry `now + 15s`. `TryConsume` removes the entry **before** returning and rejects `now >= expiresAt`. Enforce a maximum of 2 outstanding tickets per stable user and 10,000 globally. Scavenge expired entries on every issue and consume, and from a 5-second `PeriodicTimer`; `Dispose` stops the timer. **Never log the token, the token hash, the query string or the full WebSocket URL.**

- [ ] **Step 4: Add the authenticated endpoint**

```csharp
public record RealtimeTicketDto(long MatchId, string Role);
```

`POST /games/realtime-ticket` resolves the certificate stable user and current session exactly as the existing games endpoints do (`ResolveUserAsync` + `ISessionMappingService.TryGetSessionByUserId`). Then:

1. Reject any `role` other than `"participant"` with reason `wrongRole`. Spectator tickets are slice 3b.
2. Require `coordinator.TryGetActiveMatch(user.UserId, out var active)`, `active.MatchId == dto.MatchId` and `active.RunnerKey == "continuous"`. Any failure returns reason `matchNotLive`. **This is the whole participant authorization.** Do not call `ISpectatorCoordinator`.
3. Issue the ticket bound to `(user.UserId, session, dto.MatchId, RealtimeRole.Participant)`, mapping `RealtimeTicketLimitException` to reason `ticketLimit`.
4. Return `Games:RealtimePublicWebSocketUrl` from configuration. **Never derive the authority from an untrusted `Host` header.** Production rejects a missing or non-`wss` URL at startup; a Development-only derivation requires trusted forwarded-header configuration and allowed hosts.

Reasons are the stable strings `matchNotLive | wrongRole | notPresent | ticketLimit`. Apply a fixed-window limiter of 10 requests per stable user per minute.

- [ ] **Step 5: Add the correlated native request case**

In `GameService.cs`, add a `case "realtime-ticket":` to the existing `switch (action)` block. Read `matchId` and `role` from the payload, serialize **only** `{ matchId, role }`, call the existing `_postJsonAsync(cert, new Uri(baseUri, "games/realtime-ticket"), body)`, and reply with the existing `SendResponse(requestId, …)`. Do not add a native WebSocket and do not cache tickets.

- [ ] **Step 6: Run the ticket and native tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RealtimeTicketStoreTests|FullyQualifiedName~GameEndpointsTests"`

Expected: PASS for the 15-second boundary, single consumption, scope binding, the `RunnerKey`-based authorization and the stable error reasons.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~GameServiceTests`

Expected: PASS with the exact route, body and response correlation.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/Continuous/RealtimeTicketStore.cs src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/Games/GamesExtensions.cs src/Brmble.Server/appsettings.json src/Brmble.Client/Services/Games/GameService.cs tests/Brmble.Server.Tests/Games/Continuous/RealtimeTicketStoreTests.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs tests/Brmble.Client.Tests/Services/GameServiceTests.cs
git commit -m "feat: issue scoped one-time realtime game tickets"
```

## Task 12: Add The Direct Browser WebSocket And Role-Safe Protocol

Lifted from July Task 10, **participant role only**. As in Task 11, the July plan's attach-time `ISpectatorCoordinator.AuthorizeAsync` revalidation with a descriptor `RunnerKey` check is replaced by the coordinator check. A `RealtimeRole.Spectator` ticket cannot exist in 3a, so the endpoint rejects that role outright.

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs`
- Modify: `src/Brmble.Server/Program.cs:141-145`
- Modify: `src/Brmble.Server/appsettings.json`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/RealtimeGameEndpointTests.cs`

**Interfaces:**
- Consumes: `RealtimeTicketStore.TryConsume`, `ContinuousGameCoordinator.{TryGetActiveMatch, AttachParticipantAsync, AcknowledgeAttach, SubmitInput, DetachAsync}`, `RealtimeSnapshotMailbox`.
- Produces: `static Task RealtimeGameEndpoint.HandleAsync(HttpContext context)`.

- [ ] **Step 1: Write the failing WebSocket protocol tests**

Use ASP.NET Core `TestServer`'s `server.CreateWebSocketClient()`. `ClientWebSocket` cannot connect to the in-memory TestServer transport; do not try.

Cover: a missing ticket, an expired ticket and a reused ticket are each rejected before upgrade; a valid participant ticket receives a `welcome` carrying `protocolVersion` 1, `rulesetVersion` 1, `tickRate` 60, `snapshotRate` 20, `interpolationMs` 100, `maxExtrapolationMs` 50, `inputHeartbeatMs` 250, `neutralAfterMs` 750, `reconnectGraceMs` 5000 and the full `prediction` object; a `RealtimeRole.Spectator` ticket is rejected with `wrongRole`; malformed JSON, a payload above 64 KiB, a stale `protocolVersion` and a mismatched `matchId` all close with `InvalidPayloadData`; an absent or unlisted `Origin` is rejected outside Development; a consumed ticket whose match ended between consumption and attach fails and cannot be retried; socket close calls `DetachAsync` exactly once; `matchClosed` is received **before** the close frame; and a slow reader receives the latest snapshot rather than a backlog.

```csharp
[TestMethod]
public async Task TerminalStateIsDeliveredBeforeTheCloseFrame()
{
    await using var h = await RealtimeHarness.ConnectedParticipantAsync();
    await h.CompleteMatchAsync();
    var closed = await h.ReceiveJsonAsync();
    Assert.AreEqual("matchClosed", closed.GetProperty("type").GetString());
    Assert.AreEqual(2, closed.GetProperty("finalState").GetProperty("score")[0].GetInt32());
    Assert.AreEqual(WebSocketMessageType.Close, (await h.ReceiveRawAsync()).MessageType);
}
```

- [ ] **Step 2: Run the endpoint tests and verify the route is absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~RealtimeGameEndpointTests`

Expected: FAIL with HTTP 404 for `/games/realtime`.

- [ ] **Step 3: Implement upgrade and atomic attachment**

Accept only a WebSocket `GET` with exactly one `ticket` query value and an `Origin` exactly present in configured `Games:RealtimeAllowedOrigins`; reject an absent or unlisted `Origin` outside Development. Consume the ticket, then **revalidate immediately before `AcceptWebSocketAsync`**:

1. `scope.Role` must be `RealtimeRole.Participant`.
2. `coordinator.TryGetActiveMatch(scope.StableUserId, out var active)` must succeed, with `active.MatchId == scope.MatchId` and `active.RunnerKey == "continuous"`.

Only after both pass does `AttachParticipantAsync` update the internal session mapping. A consumed ticket that loses authorization fails and cannot be retried.

Use UTF-8 text frames only, a pooled fragmented buffer capped at 65,536 bytes, camel-case enum serialization, and `WebSocketCloseStatus.InvalidPayloadData` for malformed, wrong-version and match-mismatched payloads. Logging middleware logs the path only and redacts the query; the endpoint logs the connection ID, match ID and role — never the token and never the URL.

- [ ] **Step 4: Implement independent receive and send loops**

The receive loop handles `attachAck`, `input` and `heartbeat` and nothing else — an unknown discriminant closes with `InvalidPayloadData`. `telemetry` is **not** handled in 3a. The send loop drains `RealtimeSnapshotMailbox.ReadNextAsync`, applying its capacity-16 / coalescing / four-control fairness rules; if the mailbox reports `Overloaded`, close the socket. On terminal state it sends `matchClosed` with `finalState`, awaits the successful send for up to two seconds, marks terminal delivered, and only then sends a normal close. Cancellation of either loop calls `DetachAsync(connectionId)` exactly once, which starts the participant reconnect grace.

- [ ] **Step 5: Map the endpoint without touching `/ws`**

In `Program.cs`, between `app.Map("/ws", BrmbleWebSocketHandler.HandleAsync);` (`:141`) and `app.MapReverseProxy();` (`:145`):

```csharp
app.Map("/games/realtime", RealtimeGameEndpoint.HandleAsync);
```

`app.UseWebSockets()` at `:127` already runs. Normal lifecycle and queue events remain on the project-1 event bus over `/ws`.

- [ ] **Step 6: Run the endpoint and backpressure tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RealtimeGameEndpointTests|FullyQualifiedName~RealtimeSnapshotMailboxTests"`

Expected: PASS for role-scoped traffic, every protocol example, the size and version limits, snapshot replacement, terminal-before-close and cleanup.

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS with zero failures — the whole server suite, because this is the last server task in the slice.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs src/Brmble.Server/Program.cs src/Brmble.Server/appsettings.json tests/Brmble.Server.Tests/Games/Continuous/RealtimeGameEndpointTests.cs
git commit -m "feat: add direct browser realtime game websocket"
```

## Task 13: Add The Typed Browser Connection, Sequenced Input And Reconnect

Lifted from July Task 12, participant role only.

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaProtocol.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaProtocol.test.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.test.tsx`

**Interfaces:**
- Consumes: `bridge` and `isWebViewBridgeAvailable` from `src/Brmble.Web/src/api/games.ts`'s existing helpers.
- Produces: `requestRealtimeTicket(matchId: number, role: 'participant'): Promise<RealtimeTicket>` in `api/games.ts`; from `arenaProtocol.ts` the exported types `ArenaClientMessage`, `ArenaServerMessage`, `ArenaWelcome`, `ArenaSnapshot`, `ArenaPlayerSnapshot`, `ArenaProjectileSnapshot`, `ArenaMatchClosed`, `ArenaPredictionConstants` and the guard `parseServerMessage(raw: string): ArenaServerMessage | null`; from `useArenaConnection.ts` the hook `useArenaConnection({ matchId, enabled })` returning `{ status, welcome, latestSnapshot, closed, sendInput, sendHeartbeat }`. Tasks 14, 15, 16 and 17 consume these names exactly.

- [ ] **Step 1: Write the failing ticket, socket and heartbeat tests**

```tsx
it('opens the direct URL, acknowledges welcome, sequences changes, and heartbeats at 250ms', async () => {
  vi.useFakeTimers();
  api.requestRealtimeTicket.mockResolvedValue(ticket(91, 'participant'));
  const { result } = renderHook(() => useArenaConnection({ matchId: 91, enabled: true }));
  await socket.opened();
  expect(socket.url).toBe('wss://chat.example/games/realtime?ticket=' + encodeURIComponent(TICKET));

  socket.serverMessage(welcome({ snapshotSequence: 1, acknowledgedInput: 0 }));
  expect(socket.sent[0]).toEqual({ type: 'attachAck', protocolVersion: 1, matchId: 91, snapshotSequence: 1 });

  act(() => result.current.sendInput({ moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false }));
  expect(socket.sent[1].sequence).toBe(1);

  await vi.advanceTimersByTimeAsync(250);
  expect(socket.sent[2]).toMatchObject({ type: 'heartbeat', sequence: 2 });
});

it('resumes at acknowledgedInput plus one and renders finalState before close', async () => {
  const h = await connectedArena({ acknowledgedInput: 87 });
  h.sendHeldState(right);
  expect(h.lastSent().sequence).toBe(88);
  h.serverMessage(matchClosed({ sequence: 121, score: [2, 1] }));
  expect(h.result.current.closed?.finalState.score).toEqual([2, 1]);
  h.socketClose();
  expect(h.result.current.closed?.reason).toBe('completed');
  expect(h.result.current.status).toBe('closed');
});

it('requests a FRESH ticket on every reconnect attempt, backing off 250/500/1000/2000ms', async () => {
  vi.useFakeTimers();
  const h = await connectedArena({});
  h.socketError();
  for (const delay of [250, 500, 1000, 2000]) {
    await vi.advanceTimersByTimeAsync(delay);
    h.socketError();
  }
  expect(api.requestRealtimeTicket).toHaveBeenCalledTimes(5);
});

it('clears pending inputs and restarts sequencing from the new welcome after a reconnect', async () => {
  const h = await connectedArena({ acknowledgedInput: 10 });
  h.sendHeldState(right); h.sendHeldState(left);
  h.socketError();
  await h.reconnect(welcome({ snapshotSequence: 40, acknowledgedInput: 11 }));
  h.sendHeldState(right);
  expect(h.lastSent().sequence).toBe(12);
  expect(h.result.current.pendingInputCount).toBe(1);
});

it('rejects a snapshot whose sequence went backwards', () => {
  const h = connectedArenaSync({});
  h.serverMessage(snapshot({ sequence: 30 }));
  h.serverMessage(snapshot({ sequence: 29 }));
  expect(h.result.current.latestSnapshot?.sequence).toBe(30);
});
```

And in `arenaProtocol.test.ts`, table-driven guard tests: a wrong `protocolVersion`, a non-integer `x`, duplicate `sessionId`s in `players`, an unknown `type` and a missing `finalState` on `matchClosed` each return `null` from `parseServerMessage`.

- [ ] **Step 2: Run the hook tests and verify the protocol files are missing**

Run: `npm test -- --run src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL — neither module resolves.

- [ ] **Step 3: Add the exact protocol-v1 unions and runtime guards**

Define every JSON field from the **Realtime Protocol Version 1** section as `ArenaClientMessage` / `ArenaServerMessage` discriminated unions. `parseServerMessage` rejects a wrong `protocolVersion`, non-integer numeric fields, duplicate player session IDs, a non-monotonic snapshot sequence (tracked by the caller and passed in) and unknown discriminants. **Do not use `any`**, and do not use a type assertion to bypass a guard.

- [ ] **Step 4: Implement the ticket API and the socket lifecycle**

In `api/games.ts`, add `requestRealtimeTicket` following the file's existing WebView-bridge-or-fetch pattern exactly: `bridgeRequest` with action `realtime-ticket` inside WebView, `POST /games/realtime-ticket` otherwise, unwrapping errors through the existing `toGameApiError`.

`useArenaConnection` opens ``new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`)`` **directly** — never through the bridge, which cannot carry realtime frames. It sends `attachAck` only after a complete, valid `welcome`.

- [ ] **Step 5: Implement bounded input production and reconnection**

Send held-state changes and edges immediately; send aim-only changes at most every 34 ms; send a complete heartbeat every 250 ms. Initialize `nextSequence = welcome.acknowledgedInput + 1`; every sent `input` and `heartbeat` consumes exactly one sequence. Record `{ sequence, predictedTick, fromTick, toTick, input }` in a pending list until acknowledged, and expose `pendingInputs` for Task 14. On reconnect, clear pending inputs, install neutral locally, and set the next sequence from the **new** welcome's acknowledgement plus one. Retry with a fresh ticket at 250, 500, 1000 and 2000 ms; give up after the 5-second grace. `matchClosed` applies and exposes the complete `finalState` **synchronously**, before the browser close event can mark the transport closed.

- [ ] **Step 6: Run the hook tests and type-check**

Run: `npm test -- --run src/components/Games/Arena/arenaProtocol.test.ts src/components/Games/Arena/useArenaConnection.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for the direct URL, attach ack, sequencing, edges, 30 Hz aim, heartbeat, stale-snapshot rejection, fresh-ticket reconnect and teardown.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS with every protocol payload fully typed and no `any`.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/api/games.ts src/Brmble.Web/src/components/Games/Arena/arenaProtocol.ts src/Brmble.Web/src/components/Games/Arena/arenaProtocol.test.ts src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts src/Brmble.Web/src/components/Games/Arena/useArenaConnection.test.tsx
git commit -m "feat: connect browser directly to arena realtime"
```

## Task 14: Implement Prediction, Reconciliation And Interpolation

Lifted from July Task 13, minus the spectator no-prediction cases, which have no consumer until 3b. Prediction is deliberately **in** this slice: the protocol carries `predictedTick` and acknowledgement sequences regardless, so deferring it would need no protocol change, but a brawler that ships with visible input latency reads as broken rather than as incomplete.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`

**Interfaces:**
- Consumes: `normalizeQ15`, `movePerTick`, `damp` from Task 4; `ArenaSnapshot`, `ArenaPredictionConstants`, `pendingInputs` from Task 13.
- Produces (arenaMath): `stepLocal(state, input, constants)`, `reconcile(authority, pending, constants): { local, pending, replayedTicks, correction, snapped }`, `sampleTimeline(frames, nowMs, interpolationMs, maxExtrapolationMs)`, `worldToScreen(world, layout)`, `screenToWorld(point, layout)`, `computeLayout(cssWidth, cssHeight)`.
- Produces (useArenaState): `useArenaState({ welcome, latestSnapshot, pendingInputs, selfSessionId })` returning `{ localPlayer, remotePlayer, projectiles, arena, phase, phaseEndsAtTick, score, consecutiveDoubleKos, snapCount }`.

- [ ] **Step 1: Write the failing replay, interpolation and snap tests**

```ts
it('resets to authority and replays each unacknowledged held interval', () => {
  const next = reconcile(authority({ x: 1000, acknowledgedInput: 7, serverTick: 100 }), [
    predicted(8, 101, 103, right), predicted(9, 104, 105, chargingRight),
  ], predictionConstants);
  expect(next.replayedTicks).toBe(5);
  expect(next.pending.map(x => x.sequence)).toEqual([8, 9]);
});

it('discards acknowledged sequences before replaying', () => {
  const next = reconcile(authority({ acknowledgedInput: 9, serverTick: 100 }), [
    predicted(8, 101, 103, right), predicted(9, 104, 105, right), predicted(10, 106, 106, right),
  ], predictionConstants);
  expect(next.pending.map(x => x.sequence)).toEqual([10]);
});

it('smooths a small correction and snaps a large one', () => {
  expect(reconcile(authorityOffsetBy(300), [], predictionConstants).snapped).toBe(false);
  expect(reconcile(authorityOffsetBy(301), [], predictionConstants).snapped).toBe(true);
});

it.each([
  ['predicted center outside the current radius', outsideRadius],
  ['predicted overlap with the opponent', overlapping],
  ['phase changed', phaseChanged],
  ['score changed', scoreChanged],
  ['authority spent the dash the prediction still holds', dashDisagreement],
  ['authority is on cooldown the prediction is not', cooldownDisagreement],
])('snaps on %s', (_label, authorityState) => {
  expect(reconcile(authorityState, [predicted(8, 101, 103, right)], predictionConstants).snapped).toBe(true);
});

it('caps extrapolation at one 50ms interval then holds the latest frame', () => {
  const frames = framesAt(0, 50);
  expect(sampleTimeline(frames, 125, 100, 50)).toEqual(extrapolatedTo(75));
  expect(sampleTimeline(frames, 400, 100, 50)).toEqual(frameAt(50));
});

it('never extrapolates phase, score, projectile creation or removal', () => {
  const sampled = sampleTimeline(framesAt(0, 50), 125, 100, 50);
  expect(sampled.phase).toBe(frameAt(50).phase);
  expect(sampled.projectiles.map(p => p.id)).toEqual(frameAt(50).projectiles.map(p => p.id));
});
```

- [ ] **Step 2: Run the state tests and verify the helpers are missing**

Run: `npm test -- --run src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL — `reconcile`, `stepLocal` and `sampleTimeline` are not exported, and `useArenaState` does not exist.

- [ ] **Step 3: Mirror only the prediction-relevant fixed-step rules**

`stepLocal` uses integer positions and velocities and the **server-supplied** constants from `welcome.prediction` — never the local copies of `ArenaRulesetV1`, so a ruleset bump cannot silently desync a stale client. Predict local movement, charge slowdown, dash, recoil and the immediate presentation of one's own projectile. **Never predict** hits, opponent impulses, KO, score, phase or shrink outcomes. Store each input's exact `[fromTick, toTick]` interval so replay runs the correct number of fixed steps.

- [ ] **Step 4: Reconcile acknowledgements and mandatory snaps**

Reset the local player to authority, discard sequences `<= acknowledgedInput`, replay the remaining intervals, and compute the correction magnitude in fixed units. Smooth a correction `<= 300` over 100 ms. **Snap immediately** when the correction is larger, when the predicted center is outside the current radius, when the two bodies overlap, when phase or score changed, when the local KO state differs, or when replay would retain a cooldown or dash state that authority contradicts.

- [ ] **Step 5: Add the 100 ms interpolation buffer and the 50 ms cap**

Keep timestamp- and sequence-ordered complete frames. Render the remote player, projectiles and the arena radius at `now - 100ms`, linearly interpolating integer values and taking the shortest normalized aim direction. Extrapolate velocity for at most one 50 ms interval, then hold the latest authoritative frame. Never extrapolate phase, score, projectile creation or removal, or KO.

- [ ] **Step 6: Run the state tests**

Run: `npm test -- --run src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for interval replay, acknowledgement pruning, smoothing, every mandatory snap case, jitter and loss ordering, the 100 ms buffer and the 50 ms cap. The Task 4 golden vectors in the same file must still pass unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx
git commit -m "feat: predict and reconcile arena client state"
```

## Task 15: Build The Accessible Canvas Renderer And ArenaBoard

Lifted from July Task 14, with the client surface replaced by revision spec §3.2. **Read `docs/UI_GUIDE.md` sections "Minigame Panel Pattern" (`:313`) and "Main Panel Region Pattern" (`:234`) in full before writing any code in this task.**

The board is mounted in this task only by its own test. Task 16 mounts it in App.

**Files:**
- Modify: `docs/UI_GUIDE.md` (Minigame Panel Pattern)
- Modify: `src/Brmble.Web/src/components/Games/GameSurface.tsx`
- Modify: `src/Brmble.Web/src/components/Games/GameSurface.css`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.module.css`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.test.tsx`

**Interfaces:**
- Consumes: `useArenaConnection` (Task 13), `useArenaState`, `computeLayout`, `worldToScreen`, `screenToWorld` (Task 14).
- Produces: `class ArenaRenderer` with `constructor(canvas: HTMLCanvasElement)`, `resize(cssWidth, cssHeight, dpr)`, `render(view: ArenaRenderView, options: { reducedMotion: boolean })`, `pointerToWorld(clientX, clientY)`, `dispose()`; `ArenaBoard` with props `{ matchId, selfSessionId, resolveName, resolveAvatarUrl, onForfeit, onClose, ended }`; and `<GameSurface fill>`.

**HUD split (binding — revision spec §3.2 and §7).**

| Drawn as real DOM, in the header | Drawn on the canvas |
|---|---|
| Match title | Bodies with clipped avatars, names and non-colour side markers |
| Round and score | The always-visible thin aim line |
| Phase countdown | The growing charge line with its attached forced-fire countdown |
| Session mute (a disabled placeholder in 3a; wired in 3c) | Projectiles with presentation-only trails |
| Close / forfeit | The arena circle and a shrink-phase label at the canvas edge |
| | The shot-cooldown arc and dash marker, **on the player's own body** |

Combat state sits at the player because a knockback brawler is unplayable if you must look away from your character to learn whether you can shoot. **Everything drawn is also mirrored into an `.sr-only` live region: no gameplay information exists only on the canvas, and none is conveyed by colour or sound alone.**

- [ ] **Step 1: Amend the UI guide before writing UI code**

In `docs/UI_GUIDE.md`, in the **Minigame Panel Pattern** section, after the paragraph ending "…do not put a live match back behind an overlay." (`:351`), add:

```markdown
Two boards fit the surface in two different ways, and `GameSurface` supports both. By
default it centers a content-sized child with `padding: var(--space-lg)`, which is right
for Deathroll and RPS: they are small cards and centering them reads as deliberate. A
continuous board with a fixed-geometry canvas is the opposite case — Arena's world is
20 000 units square and the letterboxed canvas should be as large as the panel allows —
so `<GameSurface fill>` stretches its single child to the full surface instead. The board
still wears the same shared card shell; only `align-items` / `justify-content` / `padding`
change. Do not add a third layout mode, and do not make `fill` the default: centering is
correct for every discrete board.

**Arena's HUD split.** A continuous board splits its HUD between real DOM and the canvas,
and the split is not a free choice. The header holds what is textual and stable — match
title, round and score, the phase countdown, session mute, and close/forfeit — as ordinary
DOM, so it is focusable, selectable, translatable and reachable by a screen reader without
any parallel implementation. The canvas draws what is spatial: bodies with clipped avatars,
names and non-colour side markers, the always-visible thin aim line, the growing charge
line with its attached forced-fire countdown, projectiles with presentation-only trails,
the arena circle, a shrink-phase label at the canvas edge, and — **on the player's own
body** — the shot-cooldown arc and the dash marker. Combat state sits at the player because
a knockback brawler is unplayable if you have to look away from your character to learn
whether you can shoot.

Everything drawn on the canvas is also mirrored into an `.sr-only` live region on the
board. **No gameplay information may exist only on the canvas, and none may be conveyed by
colour or sound alone.** Colour is always supplementary: names, distinct outlines and side
notches carry identity, and thickness or texture carries charge intensity.

`prefers-reduced-motion` removes shake, flashes and decorative trail motion. It must not
change simulation timing, state, or any information the player needs.
```

- [ ] **Step 2: Write the failing transform, drawing and accessibility tests**

```ts
// ArenaRenderer.test.ts — a stubbed CanvasRenderingContext2D recording calls.
it('scales uniformly and letterboxes a 1000x600 canvas', () => {
  const layout = computeLayout(1000, 600);
  expect(layout.scale).toBeCloseTo(0.03);
  expect(layout.offsetX).toBeCloseTo(200);
  expect(layout.offsetY).toBeCloseTo(0);
});

it('maps a pointer at the canvas center to world origin, before and after a resize', () => {
  const r = renderer(1000, 600);
  expect(r.pointerToWorld(500, 300)).toEqual({ x: 0, y: 0 });
  r.resize(600, 1000, 1);
  expect(r.pointerToWorld(300, 500)).toEqual({ x: 0, y: 0 });
});

it('always draws the aim line and caps the charge line at 2200 world units', () => {
  const ctx = render({ chargePermille: 0 });
  expect(ctx.strokeCalls.filter(c => c.role === 'aim')).toHaveLength(2);
  const full = render({ chargePermille: 1000 });
  expect(full.strokeCalls.find(c => c.role === 'charge')!.worldLength).toBe(2200);
});

it('draws the cooldown arc and dash marker only on the local body', () => {
  const ctx = render({ selfSessionId: 10, cooldown: { 10: 12, 20: 12 }, dash: { 10: true, 20: true } });
  expect(ctx.arcCalls.filter(c => c.role === 'cooldown').map(c => c.sessionId)).toEqual([10]);
  expect(ctx.markerCalls.filter(c => c.role === 'dash').map(c => c.sessionId)).toEqual([10]);
});

it('falls back to the Brmble logo when an avatar image errors', () => {
  const r = renderer(1000, 600);
  r.setAvatar(10, brokenImage());
  expect(r.render(view(), { reducedMotion: false }).avatarSources[10]).toBe(FALLBACK_AVATAR_SRC);
});

it('omits shake and flash under reduced motion without changing any drawn state', () => {
  const normal = render({ reducedMotion: false, impactAtTick: 100 });
  const reduced = render({ reducedMotion: true, impactAtTick: 100 });
  expect(reduced.shakeCalls).toHaveLength(0);
  expect(reduced.bodyPositions).toEqual(normal.bodyPositions);
});
```

```tsx
// ArenaBoard.test.tsx
it('exposes phase, score, countdown, cooldown and dash as DOM text, not only on the canvas', () => {
  render(<ArenaBoard {...props({ phase: 'live', score: [1, 0], cooldownTicks: 12, dashAvailable: false })} />);
  expect(screen.getByTestId('arena-score')).toHaveTextContent('1 – 0');
  const live = screen.getByTestId('arena-live-region');
  expect(live).toHaveTextContent(/Live/);
  expect(live).toHaveTextContent(/cooldown/i);
  expect(live).toHaveTextContent(/dash used/i);
});

it('keeps the live region polite and does not announce every frame', async () => {
  const { rerender } = render(<ArenaBoard {...props({ phase: 'live' })} />);
  const live = screen.getByTestId('arena-live-region');
  expect(live).toHaveAttribute('aria-live', 'polite');
  const first = live.textContent;
  rerender(<ArenaBoard {...props({ phase: 'live', selfX: 40 })} />);
  expect(live.textContent).toBe(first);  // position alone is not announced
});

it('fills the surface rather than hugging its content', () => {
  const { container } = render(<GameSurface fill><ArenaBoard {...props({})} /></GameSurface>);
  expect(container.querySelector('.game-surface')).toHaveClass('game-surface--fill');
});

it('renders the shared card shell and a close control', () => {
  const onClose = vi.fn();
  render(<ArenaBoard {...props({ onClose })} />);
  expect(document.querySelector('.glass-panel.animate-slide-up')).not.toBeNull();
  expect(document.querySelector('h2.heading-title.modal-title')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /forfeit|close/i }));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the renderer and board tests and verify the files are missing**

Run: `npm test -- --run src/components/Games/Arena/ArenaRenderer.test.ts src/components/Games/Arena/ArenaBoard.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL — neither module resolves, and `GameSurface` has no `fill` prop.

- [ ] **Step 4: Add the `fill` variant to GameSurface**

```tsx
export function GameSurface({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  return <div className={`game-surface${fill ? ' game-surface--fill' : ''}`}>{children}</div>;
}
```

```css
/*
 * Default: center a content-sized board. Right for Deathroll and RPS.
 * `--fill`: stretch one child to the whole surface. Right for a fixed-geometry
 * canvas board (Arena), whose letterboxed world should be as large as the panel
 * allows. See UI_GUIDE "Minigame Panel Pattern". Do not make this the default.
 */
.game-surface--fill {
  align-items: stretch;
  justify-content: stretch;
  padding: var(--space-sm);
  overflow: hidden;
}
```

Use existing `--space-*` tokens only. Do not introduce a literal.

- [ ] **Step 5: Implement canvas scaling and identity**

`ArenaRenderer` uses a `ResizeObserver`, the device pixel ratio, `scale = min(cssWidth / 20000, cssHeight / 20000)` and centered offsets, with `pointerToWorld` as the exact inverse. The world is fixed at `[-10000, 10000]` on both axes regardless of app dimensions; resizing never changes gameplay geometry or input interpretation.

Clip avatars to radius 600. Side 0 uses the theme primary presentation plus a **left notch**; side 1 uses the danger presentation plus a **right notch**. Both always carry a name label and distinct outlines (double vs single). A failed or missing image renders the existing Brmble logo asset immediately — never a blank body.

Read every colour from resolved CSS custom properties on the canvas element (`getComputedStyle`), never from a literal, so Classic and Retro Terminal themes both work with no renderer change.

- [ ] **Step 6: Draw the complete public gameplay state**

Draw: the arena circle and its shrink state, a shrink-phase label at the canvas edge, the orb hit shape at radius 180, a short presentation-only trail thinner than the orb diameter, the thin neutral aim line from **every** body at all times, a textured charge line up to 2200 world units with the forced-fire numeric countdown attached to its end, and — on the local body only — the shot-cooldown arc with its remaining-tick text and the dash-availability marker.

Do **not** draw an aim cone, a spread preview, a charge ring around the player, a recoil-direction indicator, health, or damage.

- [ ] **Step 7: Build ArenaBoard with the DOM HUD and the live region**

`ArenaBoard` wears the shared card shell — `.glass-panel.animate-slide-up`, `.modal-header`, `h2.heading-title.modal-title`, `.modal-close` — and **fills** the surface. The `.modal-header` holds the match title, round and score, the phase countdown, a disabled session-mute placeholder (`aria-disabled`, tooltip "Arena audio arrives in a later release" — the real control is slice 3c) and the close/forfeit control. The canvas sits below in a flex-1 box.

Add `<div className="sr-only" data-testid="arena-live-region" role="status" aria-live="polite">` mirroring everything drawn: phase and countdown, score, both players' names and sides, whether the local player is on cooldown and for how long, whether the dash is available or spent, charge level as a percentage band, the shrink phase, and the outcome. Recompute it on **state** changes only, never per animation frame, or a screen reader is unusable.

`ArenaBoard.module.css` uses only `--space-*`, `--text-*`, `--bg-*`, `--accent-*`, `--radius-*`, `--font-*`, `--glass-*`, `--shadow-*` and transition tokens. If a value has no token, add a token in `src/Brmble.Web/src/themes/_template.css` and every theme file rather than writing a literal.

Honour `prefers-reduced-motion`: pass `reducedMotion` into `render`, which disables shake, flash and moving trails while leaving canvas timing and every piece of state unchanged.

- [ ] **Step 8: Run the UI tests, the full web suite and type-check**

Run: `npm test -- --run src/components/Games/Arena/ArenaRenderer.test.ts src/components/Games/Arena/ArenaBoard.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for transforms, pointer inversion after resize, avatar fallback, the complete cue set, the local-only combat markers, semantic DOM status and reduced motion.

Run: `npm test`

Working directory: `src/Brmble.Web`

Expected: PASS with zero failures. The `GameSurface` change must not have altered any Deathroll or RPS board test.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add docs/UI_GUIDE.md src/Brmble.Web/src/components/Games/GameSurface.tsx src/Brmble.Web/src/components/Games/GameSurface.css src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx src/Brmble.Web/src/components/Games/Arena/ArenaBoard.module.css src/Brmble.Web/src/components/Games/Arena/ArenaBoard.test.tsx
git commit -m "feat: render accessible responsive arena canvas"
```

## Task 16: Integrate Arena Into The Main Panel As Game Mode

**This task replaces July Task 17 entirely.** That task built on `ForegroundActivity`, `useForegroundActivity`, `setRemotePlaybackPaused`, a shared upper `ChatPanel` foreground slot and `DuelActivity`. All five have **zero occurrences** in `src/` and will never exist; they were explicitly killed by the game-spectating design. Every July line depending on them is void: 7, 65, 1151, 1330, 1339, 1347, 1349, 1351, 1359, 1374, 1516. The screen-share pause/restore behaviour it specified is also gone — PR #642 replaced it with the activity region's 10-second grace period (`UI_GUIDE.md:259-261`), which staging owns and which is not Arena's concern.

This is the task that first introduces `arena-knockoff` on the client. Tasks 1 and 2 made every site that must learn about it a compile error.

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/gameTypes.ts`
- Modify: `src/Brmble.Web/src/components/Games/challengeMenu.tsx`
- Modify: `src/Brmble.Web/src/components/Games/challengeMenu.test.tsx`
- Modify: `src/Brmble.Web/src/utils/games.ts`
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`
- Create: `src/Brmble.Web/src/App.arenaPanel.test.tsx`
- Modify: `src/Brmble.Web/src/components/Games/SpectatorActivity.tsx`

**Interfaces:**
- Consumes: `ArenaBoard` (Task 15), `GameType` / `isGameType` (Task 1), `ChallengeHandler` (Task 2).
- Produces: `'arena-knockoff'` as a member of `GAME_TYPES`. Task 17 consumes nothing new from here.

**What "participation is game mode" means concretely.** `game.started` on the normal event bus is already handled by `useGameState`; it sets `activeMatch`, which App already converts to `participatingMatchId` (`App.tsx:4983-4987`), which `selectMainPanelMode` already turns into `'game'` (`workspace/mainPanelMode.ts`), which `MainPanel` already renders as the game layer with the split layer hidden by `visibility` + `inert` (`MainPanel.tsx`, `MainPanel.css`). **None of that machinery changes.** Arena only adds a `case` to the board picker and the Arena-specific teardown. Do not add a mode, do not add a store, and do not return the game surface early in place of the split layer (`UI_GUIDE.md:337-346`).

Arena spectating is **not** in this task and is not in this slice. `UI_GUIDE.md:245` — game mode is entered by participating, never by spectating — is load-bearing and is not amended.

- [ ] **Step 1: Write the failing integration tests**

```tsx
// src/App.arenaPanel.test.tsx
it('enters game mode and renders ArenaBoard when an arena match starts', async () => {
  const h = renderApp({ joinedChannelId: 7 });
  act(() => { bridge.emit('game.started', { matchId: 91, gameType: 'arena-knockoff', players: [10, 20] }); });

  await screen.findByTestId('arena-board');
  expect(document.querySelector('[data-main-panel-layer="game"]')).not.toBeNull();
  expect(document.querySelector('[data-main-panel-layer="split"]')).toHaveClass('main-panel__split--hidden');
});

it('hides rather than unmounts the split layer for a whole match', async () => {
  const h = renderApp({ joinedChannelId: 7 });
  await h.typeChatDraft('half a message');
  act(() => { bridge.emit('game.started', { matchId: 91, gameType: 'arena-knockoff', players: [10, 20] }); });
  await screen.findByTestId('arena-board');

  const split = document.querySelector('[data-main-panel-layer="split"]')!;
  expect(split).toBeInTheDocument();
  expect(split).toHaveAttribute('inert');

  act(() => { bridge.emit('game.ended', { matchId: 91, outcome: 'decided' }); });
  act(() => { fireEvent.click(screen.getByRole('button', { name: /close/i })); });

  expect(h.chatDraft()).toBe('half a message');
});

it('never enters game mode for a spectated arena match', async () => {
  const h = renderApp({ joinedChannelId: 7 });
  act(() => { bridge.emit('game.queueSnapshot', { channelId: 7, active: { matchId: 91, gameType: 'arena-knockoff', players: [30, 40] } }); });
  act(() => { h.clickWatchToggle(7); });

  expect(document.querySelector('[data-main-panel-layer="game"]')).toBeNull();
  expect(screen.queryByTestId('arena-board')).toBeNull();
});

it('offers Arena in the challenge menu and invites with no options', async () => {
  const h = renderApp({ joinedChannelId: 7 });
  const item = h.challengeMenuFor(20);
  findChild(item, 'Arena Knockoff').onClick?.();
  expect(gamesApi.invite).toHaveBeenCalledWith(20, 'arena-knockoff', undefined);
});

it('tears the arena connection down on channel leave', async () => {
  const h = renderApp({ joinedChannelId: 7 });
  act(() => { bridge.emit('game.started', { matchId: 91, gameType: 'arena-knockoff', players: [10, 20] }); });
  await screen.findByTestId('arena-board');
  act(() => { bridge.emit('voice.channelJoined', { channelId: 9 }); });
  expect(screen.queryByTestId('arena-board')).toBeNull();
  expect(fakeSocket.closed).toBe(true);
});
```

- [ ] **Step 2: Run the tests and verify Arena is not wired**

Run: `npm test -- --run src/App.arenaPanel.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL. The invite is declined by Task 1's unsupported-type branch, so no match starts and `arena-board` never appears; the challenge menu has no Arena entry.

- [ ] **Step 3: Add the game type and let the compiler find every site**

In `gameTypes.ts`: `export const GAME_TYPES = ['deathroll', 'rps', 'arena-knockoff'] as const;`

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: FAIL with `assertNever` errors at exactly two sites — App's participant board picker and `SpectatorActivity`'s spectator board picker. That is Task 1 working. Fix both in Steps 4 and 5, and do not silence either with a cast.

- [ ] **Step 4: Add the participant Arena branch**

In `App.tsx`'s `renderParticipantBoard`:

```tsx
      case 'arena-knockoff':
        return (
          <ArenaBoard
            key={`arena-${gameState.activeMatch?.matchId ?? gameState.ended?.matchId ?? 'none'}`}
            matchId={Number(participatingMatchId)}
            selfSessionId={selfSession}
            resolveName={resolveGamePlayerName}
            resolveAvatarUrl={resolveUserAvatarUrl}
            ended={gameState.ended}
            onForfeit={confirmForfeit}
            onClose={gameState.ended ? gameState.dismissEnded : confirmForfeit}
          />
        );
```

and wrap the surface so Arena — and only Arena — fills it:

```tsx
  const gameSurface = participatingMatchId !== null ? (
    <GameSurface fill={activeGameType === 'arena-knockoff'}>{renderParticipantBoard()}</GameSurface>
  ) : showGame ? (
    <NeonDGame onClose={() => setShowGame(false)} />
  ) : null;
```

where `activeGameType` is the same `gameState.activeMatch?.gameType ?? gameState.ended?.gameType` value `renderParticipantBoard` already reads; hoist it to one `const` rather than reading it twice.

Reuse whatever App already uses to resolve a user's avatar URL for `<Avatar>`; do not add a new resolver.

- [ ] **Step 5: Add the spectator Arena branch as an explicit deferral**

Arena spectating is slice 3b. The compiler now demands a `case 'arena-knockoff'` in `SpectatorActivity`'s switch; give it the honest answer rather than a silent one:

```tsx
    case 'arena-knockoff':
      // Arena spectating is slice 3b. Until then this is a real, visible
      // "not yet" — never a fall-through to another game's board.
      return <UnsupportedSpectatorView gameType={match.gameType} />;
```

Update `SpectatorActivity.test.tsx`'s unsupported-type case accordingly: the assertion that an Arena spectator match shows the notice rather than the Deathroll board is now covering a real branch instead of the fallback, and must keep passing.

- [ ] **Step 6: Add the challenge-menu entry, the icon and the metadata**

In `Icon.tsx`, add one `'game-arena'` entry under the GAMES category, matching the existing `game-deathroll` / `game-rps` entries' shape and viewBox. Do not duplicate an existing path.

In `utils/games.ts`: `'arena-knockoff': { name: 'Arena Knockoff', icon: 'game-arena' },`

In `challengeMenu.tsx`, add a third child to the submenu — Arena takes no options, so it is a leaf like Deathroll:

```tsx
      {
        type: 'item',
        label: 'Arena Knockoff',
        icon: <Icon name="game-arena" size={14} />,
        onClick: () => onChallenge(session, 'arena-knockoff'),
      },
```

Add the matching assertion to `challengeMenu.test.tsx`.

- [ ] **Step 7: Add Arena lifecycle teardown**

`game.ended` marks the lifecycle terminal but must **not** discard realtime state or close the board: `matchClosed.finalState` is the source of the final board, and the result stays visible until the user closes it — which is exactly how `gameState.ended` already behaves for Deathroll and RPS, so no new state is needed.

Voice channel leave, disconnect, and unmount must immediately close the socket, install neutral input and clear the match. App already resets `gameState` on channel leave (`useGameState.ts:565-577`); confirm `activeMatch` and `ended` are both cleared there and extend that reset only if they are not. `ArenaBoard` closes its own socket on unmount via `useArenaConnection`'s cleanup, so clearing `participatingMatchId` is sufficient — do not add a second teardown path.

- [ ] **Step 8: Run the integration tests, the full suite, type-check and build**

Run: `npm test -- --run src/App.arenaPanel.test.tsx src/components/Games/SpectatorActivity.test.tsx src/components/Games/challengeMenu.test.tsx src/components/Games/useGameState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for game mode entry, the split layer surviving a whole match with its chat draft intact, spectating never entering game mode, the Arena challenge entry and channel-leave teardown.

Run: `npm test`

Working directory: `src/Brmble.Web`

Expected: PASS with zero failures.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS with no remaining `assertNever` error.

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS — `tsc -b` and Vite both succeed.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Web/src/components/Games/gameTypes.ts src/Brmble.Web/src/components/Games/challengeMenu.tsx src/Brmble.Web/src/components/Games/challengeMenu.test.tsx src/Brmble.Web/src/components/Games/SpectatorActivity.tsx src/Brmble.Web/src/components/Games/SpectatorActivity.test.tsx src/Brmble.Web/src/utils/games.ts src/Brmble.Web/src/components/Icon/Icon.tsx src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.arenaPanel.test.tsx
git commit -m "feat: play arena knockoff in game mode from the main panel"
```

## Task 17: Add Click Input Capture And Native PTT/Hotkey Isolation

Lifted from July Task 15. **This task is deliberately last in the slice** because it is the only one that modifies `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, which open PR #645 (`fix/client-transport-defects`) also modifies.

- [ ] **Step 0: Check PR #645 before starting**

Run: `gh pr view 645 --json state,mergedAt`

If it is merged, rebase this branch onto `main` and re-run `dotnet test` and `npm test` before continuing. If it is still open, ask the repo owner whether to wait or to proceed and rebase later. Do not edit `MumbleAdapter.cs` in parallel with an open PR that also edits it without saying so.

**Files:**
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaInput.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaInput.test.tsx`
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`

**Interfaces:**
- Consumes: `useArenaConnection.sendInput` / `sendHeartbeat` (Task 13), `ArenaRenderer.pointerToWorld` (Task 15), the existing `InputRouter.Suspend()` (`src/Brmble.Client/Services/Voice/Input/InputRouter.cs:157`) and `Resume()` (`:166`).
- Produces: `useArenaInput({ canvasRef, renderer, connection, enabled })` returning `{ captured, captureId, release }`, and the native bridge handler `game.inputCapture` with payload `{ captureId: string, active: boolean }`.

**Path correction:** `InputRouter` is at `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`, **not** `Services/Input/` as the July plan says. Its test file `tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs` does exist. `game.inputCapture` currently has zero occurrences anywhere.

**Coexistence requirement.** `MumbleAdapter` already registers `voice.suspendHotkeys` and `voice.resumeHotkeys` (`MumbleAdapter.cs:2998-3008`), which call `InputRouter.Suspend()` / `Resume()` **unconditionally**. A bare `resumeHotkeys` must not be able to un-suspend hotkeys while an Arena capture is still held. Route both existing handlers through the same reference counter: `voice.suspendHotkeys` adds the reserved ID `"legacy:voice"` and `voice.resumeHotkeys` removes it. Suspension is active while the set is non-empty.

- [ ] **Step 1: Write the failing capture, release and isolation tests**

```tsx
it.each(['Escape', 'blur', 'visibilitychange', 'socket', 'unmount'])('%s releases capture and sends neutral', reason => {
  const h = inputHarness();
  h.clickBoard(); h.hold('KeyW'); h.releaseBy(reason);
  expect(h.lastInput()).toMatchObject({ moveX: 0, moveY: 0, charging: false, fireReleased: false, dash: false });
  expect(bridge.send).toHaveBeenLastCalledWith('game.inputCapture', { captureId: h.captureId, active: false });
});

it('captures only after a click, and normalizes diagonals', () => {
  const h = inputHarness();
  h.hold('KeyW');
  expect(h.sentInputs()).toHaveLength(0);       // not captured yet
  h.clickBoard(); h.hold('KeyW'); h.hold('KeyD');
  expect(h.lastInput()).toMatchObject({ moveX: 23170, moveY: -23170 });
});

it('ignores key repeat for dash and sends exactly one edge per physical press', () => {
  const h = inputHarness(); h.clickBoard();
  h.keyDown('Space'); h.keyDown('Space', { repeat: true }); h.keyUp('Space');
  expect(h.sentInputs().filter(i => i.dash)).toHaveLength(1);
});

it('does not swallow chat shortcuts once capture is released', () => {
  const h = inputHarness();
  h.clickBoard(); h.releaseBy('Escape');
  const event = h.keyDown('KeyW');
  expect(event.defaultPrevented).toBe(false);
});
```

```csharp
// InputRouterSuspendTests.cs
[TestMethod]
public void FirstCaptureIdSuspendsAndTheLastReleaseResumes()
{
    var h = AdapterHarness.Connected();
    h.Send("game.inputCapture", new { captureId = "a", active = true });
    Assert.IsTrue(h.InputRouter.IsSuspended);
    h.Send("game.inputCapture", new { captureId = "b", active = true });
    h.Send("game.inputCapture", new { captureId = "a", active = false });
    Assert.IsTrue(h.InputRouter.IsSuspended);      // b still holds it
    h.Send("game.inputCapture", new { captureId = "b", active = false });
    Assert.IsFalse(h.InputRouter.IsSuspended);
}

[TestMethod]
public void CaptureForcesPttReleaseAndBlocksShortcutsUntilTheMatchingRelease()
{
    var h = AdapterHarness.Connected();
    h.PressPtt();
    Assert.IsTrue(h.Transmitting);
    h.Send("game.inputCapture", new { captureId = "a", active = true });
    Assert.IsFalse(h.Transmitting);                 // forced PttStateChanged(false)
    h.PressShortcut("toggleMute");
    Assert.AreEqual(0, h.ShortcutDispatchCount);
    h.Send("game.inputCapture", new { captureId = "a", active = false });
    h.PressShortcut("toggleMute");
    Assert.AreEqual(1, h.ShortcutDispatchCount);
}

[TestMethod]
public void AStaleReleaseForAnOldIdCannotResumeWhileANewIdIsHeld()
{
    var h = AdapterHarness.Connected();
    h.Send("game.inputCapture", new { captureId = "old", active = true });
    h.Send("game.inputCapture", new { captureId = "old", active = false });
    h.Send("game.inputCapture", new { captureId = "new", active = true });
    h.Send("game.inputCapture", new { captureId = "old", active = false });
    Assert.IsTrue(h.InputRouter.IsSuspended);
}

[TestMethod]
public void LegacyVoiceSuspendSharesTheSameCounter()
{
    var h = AdapterHarness.Connected();
    h.Send("game.inputCapture", new { captureId = "a", active = true });
    h.Send("voice.resumeHotkeys", new { });
    Assert.IsTrue(h.InputRouter.IsSuspended);       // the arena capture still holds it
}

[DataTestMethod]
[DataRow("")]
[DataRow("   ")]
[DataRow(null)]
public void BlankOrOverlongCaptureIdsAreRejected(string? captureId)
{
    var h = AdapterHarness.Connected();
    h.Send("game.inputCapture", new { captureId, active = true });
    Assert.IsFalse(h.InputRouter.IsSuspended);
}

[TestMethod]
public void VoiceTeardownClearsTheCaptureSetAndResumes()
{
    var h = AdapterHarness.Connected();
    h.Send("game.inputCapture", new { captureId = "a", active = true });
    h.Disconnect();
    Assert.IsFalse(h.InputRouter.IsSuspended);
}
```

`IsSuspended` does not exist on `InputRouter` today. Add it as a public read-only property backed by the existing `_suspended` field in this task; it changes no behaviour and makes the reference counting testable without reflection.

- [ ] **Step 2: Run the web and native input tests and verify the missing capture API**

Run: `npm test -- --run src/components/Games/Arena/useArenaInput.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL — the hook does not exist.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~InputRouterSuspendTests|FullyQualifiedName~MumbleAdapterBridgeTests"`

Expected: FAIL — `game.inputCapture` is not a registered handler, and `InputRouter.IsSuspended` does not compile.

- [ ] **Step 3: Implement click-owned capture**

Only a click on the participant board activates capture. While captured, capture-phase listeners map `WASD` to a movement vector, pointer position to an aim vector via `ArenaRenderer.pointerToWorld`, the left mouse button's hold and release to charge and fire, and `Space` to a dash edge. Normalize the diagonal movement vector before sending. Call `preventDefault` and `stopPropagation` **only while captured**. Ignore `event.repeat` for dash.

- [ ] **Step 4: Release held state on every specified lifecycle event**

`Escape`, `window.blur`, a hidden `visibilitychange`, socket disconnect, match change, board close and unmount each synchronously clear local held state, send exactly one neutral input if still connected, and send `game.inputCapture` with `active: false`. After release, chat and global shortcuts work normally.

- [ ] **Step 5: Add reference-counted native isolation**

Generate one UUID `captureId` per mounted `ArenaBoard` and include it in every `game.inputCapture` message. In `MumbleAdapter`, keep a `HashSet<string> _activeCaptureIds` guarded by a lock. Adding the first ID calls the existing `InputRouter.Suspend()` — which already releases PTT and held shortcuts before flipping its gate (`InputRouter.cs:157-163`) — and removing the last calls `Resume()`. Duplicate adds and removes are idempotent. Voice teardown and window teardown clear the set and then resume. Reject blank, whitespace-only, null and over-128-character IDs without changing state.

Route `voice.suspendHotkeys` and `voice.resumeHotkeys` through the same set using the reserved ID `"legacy:voice"`, as required above. Do **not** create Arena-specific native key bindings.

- [ ] **Step 6: Run the capture and native tests**

Run: `npm test -- --run src/components/Games/Arena/useArenaInput.test.tsx src/components/Games/Arena/ArenaBoard.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for click ownership, the control set, diagonal normalization and every release path.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS with zero failures across the whole native suite, including PTT release, shortcut isolation only during capture, stale-ID safety and the legacy suspend path.

- [ ] **Step 7: Run the full verification for the slice**

Run: `dotnet build -c Release`

Expected: PASS with zero errors.

Run: `dotnet test`

Expected: PASS with zero failures across every test project.

Run: `npm test`

Working directory: `src/Brmble.Web`

Expected: PASS with zero failures.

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS.

Run: `1..20 | ForEach-Object { dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -c Release --filter "FullyQualifiedName~ArenaDeterminismTests|FullyQualifiedName~ContinuousGameCoordinatorTests|FullyQualifiedName~RealtimeTicketStoreTests"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`

Expected: PASS on all 20 runs with identical hashes, exactly one ticket consumer, generation-safe gates and grace, and no duplicate completion.

- [ ] **Step 8: Two-client manual smoke test**

Run: `dotnet run --project src/Brmble.Server -c Release`

Run in another terminal, working directory `src/Brmble.Web`: `npm run dev`

Run in two more terminals: `dotnet run --project src/Brmble.Client`

Debug builds always allow multiple instances, so two clients run side by side. Join both to the same voice channel, challenge one from the other's context menu with **Arena Knockoff**, and verify the whole loop end to end: mirrored spawns; a 1-second Loading and a visible 3-second Positioning countdown; no attack or dash before Live; normalized diagonals; both aim lines public; the charge line growing with its forced-fire countdown; an immediate low shot followed by a visible cooldown arc; constant projectile speed and size; projectiles passing through each other; recoil able to self-KO near the edge; exactly one dash per round; solid body collision; hold, shrink and collapse; BO3 completing at two round wins; the split layer's chat draft and scroll position intact when the board closes; PTT silent while the board has capture and working again after `Escape`.

Disconnect one participant's socket for 3 seconds and confirm it recovers with neutral state and the simulation never paused; disconnect for over 5 seconds and confirm the match forfeits; have one participant leave the voice channel and confirm the immediate forfeit.

This is a smoke test, not the balancing gate. **The balancing gate is slice 3c** and remains the release condition it is in the July plan.

- [ ] **Step 9: Confirm a clean worktree and commit**

Run: `git status --short`

Expected: only the files listed for this task are modified.

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaInput.ts src/Brmble.Web/src/components/Games/Arena/useArenaInput.test.tsx src/Brmble.Web/src/components/Games/Arena/ArenaBoard.tsx src/Brmble.Client/Services/Voice/Input/InputRouter.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs
git commit -m "feat: isolate arena input capture from voice hotkeys"
```

---

## Specification Coverage And Self-Review

| Revision spec requirement | Task | Evidence |
|---|---|---|
| §1.1 Project-1 contracts reused verbatim, unmodified | 3, 10 | Fake definition passed straight to the existing `GameDefinitionCatalog`; existing `DuelMatchRunnerRouter` discovers the second runner; no production change to either file. |
| §1.2 `IGameEngine` untouched; Arena unaffected by `SpectatorView` | Global Constraints, 5 | `ArenaGameDefinition : IDuelGameDefinition, IContinuousGameDefinition` only. |
| §1.4 Foreground model is dead | 16 | July Task 17 replaced wholesale; the five dead names are never created. |
| §1.5 Path corrections | 17 | `Services/Voice/Input/InputRouter.cs`; no `AppSettings.Games` in 3a. |
| §2.1 `SpectatorService` stubs stay stubs in 3a | Global Constraints, 10, 11, 12 | No injection, no call, `SpectatorServiceTests` must pass unmodified. |
| §2.2 `RunnerKey` check moves to `ActiveMatchReference` | 11, 12 | `TryGetActiveMatch` + `active.MatchId` + `active.RunnerKey == "continuous"` at both ticket issue and attach. |
| §2.3 `EndMatchAsync` five parameters | — | Not called in 3a; 3b's concern. |
| §2.4 Simulation, ruleset, protocol survive unchanged | 4–9, 12 | Constants, golden vectors, 15-stage ordering, shrink formulas and protocol v1 lifted verbatim. |
| §3.2 Participation is game mode; split hidden not unmounted | 16 | Test asserts the chat draft survives a whole match and the layer keeps `inert`. |
| §3.2 Board fills the surface | 15 | `<GameSurface fill>`; one amendment to the Minigame Panel Pattern in the same task. |
| §3.2 HUD split; everything drawn mirrored to `.sr-only` | 15 | Header/canvas table is binding; live-region test asserts cooldown and dash as DOM text. |
| §3.3 Spectating is a `'spectate'` chip, never game mode | 16 | Test asserts watching an Arena match never creates the game layer; `UI_GUIDE:245` untouched. Spectator rendering is 3b. |
| §3.4 Three silent-fallback sites fixed first | 1 | Slice Task 1, before `arena-knockoff` exists anywhere; Task 16 Step 3 relies on the resulting compile errors. |
| §3.5 Challenge callbacks collapsed | 2 | One `onChallenge(session, gameType, options)`; `type-check` is the gate. |
| §3.6 Arena volume storage | — | Slice 3c. Not implemented here; no `AppSettings.Games` is added. |
| §4.1 Prediction and reconciliation in 3a | 14 | Full replay, snap and interpolation task. |
| §5 Unknown type not silently declined | 1 | Asserts `lastError` and `console.warn`, not just the decline. |
| §5 Unknown type does not render Deathroll | 1 | Both pickers exhaustive with `assertNever` plus a visible fallback. |
| §5 Panel integration tests | 16 | Game mode set, spectating never sets it, split layer hidden across a whole match. |
| §6 PR #645 coordination | 17 | Last task; explicit Step 0 check. |
| §7 Every decision-table row | 1, 2, 10–12, 15, 16 | See rows above; none reopened. |

**Self-review notes.**

- Every claim about the existing code in this plan was verified against `main` at `dd505be4` before being written, including the ones the revision spec had already checked. Confirmed by direct read: `DuelModels.cs` contract line numbers; `SpectatorModels.cs:67-78` descriptor and authorization-result shapes; `SpectatorService.cs:173-178` stub bodies; `DuelMatchRunnerRouter.cs:26` routing on `Configuration.RunnerKey`; `GamesExtensions.cs:34-35`; `Program.cs:127/141/145`; `GameService.cs`'s `switch (action)` with no `realtime-ticket` case; `GameEndpoints.cs`'s fourteen routes with no realtime route; `InputRouter.cs:157/166`; the absence of `src/Brmble.Server/Games/{Continuous,Arena}` and `src/Brmble.Web/src/components/Games/Arena`; `useGameState.ts:8-10` and `:217-222`; `App.tsx:5287-5321` and `:5396-5397`; `SpectatorActivity.tsx:55-60`; `challengeMenu.tsx`; `MainPanel.tsx` / `MainPanel.css` layer behaviour; `GameSurface.css`'s centering.
- Two facts were found that the handoff did not mention and that change the plan. First, `App.tsx` already imports and uses `assertNever` (`:52`, `:5262`) for the activity-stage switch, so Task 1 follows an established in-file precedent rather than introducing a pattern. Second, `MumbleAdapter.cs:2998-3008` already registers `voice.suspendHotkeys` / `voice.resumeHotkeys`, which call `InputRouter.Suspend()` / `Resume()` unconditionally; without sharing a counter, a bare `resumeHotkeys` would un-suspend hotkeys mid-match. Task 17 routes both through the same reference count and tests it.
- Type consistency was checked across C# and TypeScript for protocol version 1, `arena-knockoff`, `bo3`, ruleset 1, `RunnerKey = "continuous"`, exact-next input sequencing, `acknowledgedInput`, the `welcome.prediction` object, terminal state before close, and the participant role. `ArenaSnapshotView`, `ArenaSnapshot` and `ArenaRenderView` are three distinct names for three distinct layers and are not conflated.
- Commit boundaries were audited. Task 3 creates a compilable coordinator before Tasks 9, 10, 11 and 12 modify it. Task 4 creates `arenaMath.ts` before Task 14 modifies it. Task 5 creates `ArenaSimulation.cs` and `ArenaModels.cs` before Tasks 6 and 7 modify them. Task 15 creates `ArenaBoard.tsx` before Task 17 modifies it. Task 1 creates `gameTypes.ts` before Task 16 modifies it. Every `Modify` in the plan has a preceding `Create`.
- Scope was audited against the slice boundary. `IContinuousSimulation.SpectatorSnapshot()` is implemented but never called; `RealtimeRole.Spectator` exists in the enum but is rejected at both the ticket endpoint and the socket; `SpectatorMatchDescriptor` is never constructed; `ISpectatorCoordinator` is never injected into the coordinator. Each is called out at the site so a reviewer does not read the omission as an oversight.
- Placeholder scan: no step defers work, no step says "add appropriate error handling", and every code step carries the code.

