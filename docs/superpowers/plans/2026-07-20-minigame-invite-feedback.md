# Minigame Invite Feedback, Fixed-Duration Invite & Block Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the challenger distinct feedback for declined / no-response / blocked invites, make the incoming-invite notification a fixed 30s server-removed window, and add a server-authoritative "block all challenges" setting on a new Games settings tab (with the Deathroll stats moved there).

**Architecture:** The server splits the single `game.declined` event into explicit `game.declined` (× pressed) vs new `game.expired` (30s timeout), and rejects invites to blocked users with a `Blocked` reason on `InviteResult`. A live per-user `challenges_blocked` flag is read at invite time via `IGamePresence` (always current, no caching/broadcast). The web client tracks its own `outgoingInvite`, shows three role-aware `info` notifications under one replaceable queue id, and drops the client-side invite timer (`duration={null}`). A new server-backed `/games/settings` endpoint powers the toggle.

**Tech Stack:** C# / ASP.NET Core minimal APIs, Dapper + SQLite, MSTest; React + TypeScript + Vite; existing NativeBridge `game.*` protocol.

**Branch:** `feature/minigame-framework` (already checked out). Never commit to `main`. Do NOT push or open a PR without asking.

**Windows PowerShell notes:** no `&&` (use `;`); no `rg`/`head`/`tail`. Ignore spurious C# LSP restore-noise (Dapper/MSTest/Ice "not found").

---

## Design Refinement vs Spec

The spec suggested reading `challenges_blocked` into `SessionMapping` on connect. This plan instead reads it **live from the DB at invite time** through a new async `IGamePresence` method. Reasons: (1) always correct when the user toggles the setting mid-session (no stale cache, no re-broadcast); (2) far smaller surface (no changes to the `SessionMapping` record, `ISessionMappingService`, or connect handler); (3) trivially unit-testable via the existing `FakePresence`. Server-authoritative guarantee is unchanged.

---

## Task 1: Add `challenges_blocked` column + migration

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs:163-167`

- [ ] **Step 1: Add the idempotent migration**

In `src/Brmble.Server/Data/Database.cs`, immediately after the existing `companion_id` migration block (ends at line 167), add:

```csharp
        // Migrate: add challenges_blocked column (server-authoritative game invite block)
        var hasChallengesBlocked = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='challenges_blocked'");
        if (hasChallengesBlocked == 0)
            conn.Execute("ALTER TABLE users ADD COLUMN challenges_blocked INTEGER NOT NULL DEFAULT 0");
```

- [ ] **Step 2: Build the server**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded (ignore LSP restore-noise if present; the actual `dotnet build` should be clean).

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Data/Database.cs
git commit -m "feat: add challenges_blocked column to users"
```

---

## Task 2: `UserRepository` get/set for the block flag

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs` (add after `SetCompanionId`, ~line 152)
- Test: `tests/Brmble.Server.Tests/Auth/UserRepositoryChallengesBlockedTests.cs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Server.Tests/Auth/UserRepositoryChallengesBlockedTests.cs`. First find how other `UserRepository` tests construct a repo + user by reading an existing test file in `tests/Brmble.Server.Tests/Auth/` (look for a helper that creates an in-memory/temp DB and inserts a user). Mirror that exact setup. The test body:

```csharp
using Brmble.Server.Auth;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryChallengesBlockedTests
{
    [TestMethod]
    public async Task ChallengesBlocked_DefaultsFalse_AndRoundTrips()
    {
        // Arrange: create a repo + a user, following the existing UserRepository test helper.
        // var (repo, userId) = <existing helper that creates a temp DB and one user>;

        Assert.IsFalse(await repo.GetChallengesBlocked(userId));

        await repo.SetChallengesBlocked(userId, true);
        Assert.IsTrue(await repo.GetChallengesBlocked(userId));

        await repo.SetChallengesBlocked(userId, false);
        Assert.IsFalse(await repo.GetChallengesBlocked(userId));
    }
}
```

Replace the commented `Arrange` line with the concrete setup copied from the existing `UserRepository` test helper before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter ChallengesBlocked_DefaultsFalse_AndRoundTrips`
Expected: FAIL — `GetChallengesBlocked` / `SetChallengesBlocked` do not exist (compile error).

- [ ] **Step 3: Implement the methods**

In `src/Brmble.Server/Auth/UserRepository.cs`, after `SetCompanionId` (line 152), add:

```csharp
    public async Task<bool> GetChallengesBlocked(long userId)
    {
        using var conn = _db.CreateConnection();
        var blocked = await conn.QuerySingleOrDefaultAsync<long?>(
            "SELECT challenges_blocked FROM users WHERE id = @Id",
            new { Id = userId });
        return blocked == 1;
    }

    public async Task SetChallengesBlocked(long userId, bool blocked)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            "UPDATE users SET challenges_blocked = @Blocked WHERE id = @Id",
            new { Blocked = blocked ? 1 : 0, Id = userId });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter ChallengesBlocked_DefaultsFalse_AndRoundTrips`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryChallengesBlockedTests.cs
git commit -m "feat: UserRepository get/set challenges_blocked"
```

---

## Task 3: Add block check to `IGamePresence` + `InviteResult.Reason`, reject blocked invites

**Files:**
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs` (`IGamePresence` ~16-26, `InviteResult` line 28, `InviteAsync` ~80-142)
- Modify: `src/Brmble.Server/Games/SessionMappingGamePresence.cs`
- Test: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs` (extend `FakePresence` + add test)

- [ ] **Step 1: Extend `IGamePresence` and `InviteResult`**

In `src/Brmble.Server/Games/GameSessionManager.cs`, add to the `IGamePresence` interface (after `GetDisplayName`, line 25):

```csharp
    // Returns true if the given live session's user has blocked all game challenges.
    // Read live (per-invite) so runtime toggles take effect immediately.
    Task<bool> AreChallengesBlockedAsync(long sessionId);
```

Change the `InviteResult` record (line 28) to carry a machine-readable reason:

```csharp
public enum InviteRejectReason { None, Blocked, Other }

public record InviteResult(bool Success, long MatchId, string? Error, InviteRejectReason Reason = InviteRejectReason.None);
```

- [ ] **Step 2: Update every existing `InviteResult(false, ...)` return**

In `InviteAsync` (lines 82-131) there are several `return new InviteResult(false, 0, "...")` statements. Leave their `Reason` as the default (`None`/`Other`) EXCEPT add the new block check. Add the block check immediately after the target-Brmble check (after line 92, before the same-channel check at line 94):

```csharp
        if (await _presence.AreChallengesBlockedAsync(targetSession))
            return new InviteResult(false, 0, "This player isn't accepting challenges.", InviteRejectReason.Blocked);
```

(The remaining `false` returns keep the two-arg message form; they default to `Reason.None`, which the endpoint treats as a generic error.)

- [ ] **Step 3: Implement the real presence method**

In `src/Brmble.Server/Games/SessionMappingGamePresence.cs`, inject `UserRepository` and implement the method. Update the constructor and add the method:

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.Games;

public sealed class SessionMappingGamePresence : IGamePresence
{
    private readonly ISessionMappingService _sessions;
    private readonly IChannelMembershipService _membership;
    private readonly UserRepository _users;

    public SessionMappingGamePresence(ISessionMappingService sessions, IChannelMembershipService membership, UserRepository users)
    {
        _sessions = sessions;
        _membership = membership;
        _users = users;
    }

    public bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)
    {
        channelId = 0;
        isBrmble = false;
        userId = 0;
        if (!_sessions.GetSnapshot().TryGetValue((int)sessionId, out var mapping) || mapping is null)
            return false;
        isBrmble = mapping.IsBrmbleClient;
        userId = mapping.UserId;
        return _membership.TryGetChannel((int)sessionId, out channelId);
    }

    public string? GetDisplayName(long sessionId)
        => _sessions.GetSnapshot().TryGetValue((int)sessionId, out var mapping) && mapping is not null
            ? mapping.MumbleName
            : null;

    public async Task<bool> AreChallengesBlockedAsync(long sessionId)
    {
        if (!_sessions.GetSnapshot().TryGetValue((int)sessionId, out var mapping) || mapping is null)
            return false;
        return await _users.GetChallengesBlocked(mapping.UserId);
    }
}
```

Note: `UserRepository` is already registered in DI (used by other endpoints), so no `Program.cs`/`GamesExtensions` registration change is needed for this constructor param. If the build reports the DI cannot resolve it, verify `UserRepository` is registered where `SessionMappingGamePresence` is registered and add it if missing.

- [ ] **Step 4: Extend `FakePresence` and add the failing test**

In `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`, update `FakePresence` (lines 8-17) to support a blocked set:

```csharp
file sealed class FakePresence : IGamePresence
{
    public Dictionary<long, (int ch, bool brmble, long userId)> Users = new();
    public HashSet<long> Blocked = new();
    public bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)
    {
        if (Users.TryGetValue(sessionId, out var v)) { channelId = v.ch; isBrmble = v.brmble; userId = v.userId; return true; }
        channelId = 0; isBrmble = false; userId = 0; return false;
    }
    public string? GetDisplayName(long sessionId) => $"user{sessionId}";
    public Task<bool> AreChallengesBlockedAsync(long sessionId) => Task.FromResult(Blocked.Contains(sessionId));
}
```

Add a new test method inside `GameSessionManagerTests`:

```csharp
    [TestMethod]
    public async Task Invite_RejectsBlockedTarget_WithBlockedReason()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        presence.Blocked.Add(20);
        var mgr = NewManager(presence, new FakePublisher(), new FakeAnnouncer(), GameTestHelpers.NewRepo());

        var result = await mgr.InviteAsync(10, 20, "deathroll");

        Assert.IsFalse(result.Success);
        Assert.AreEqual(InviteRejectReason.Blocked, result.Reason);
    }
```

- [ ] **Step 5: Run tests to verify (fail then pass)**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter Games`
Expected: All Games tests PASS (including the new one). The `FakePresence` change makes the file compile; the new test asserts the block reason.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/GameSessionManager.cs src/Brmble.Server/Games/SessionMappingGamePresence.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs
git commit -m "feat: reject invites to users blocking challenges"
```

---

## Task 4: Split decline vs expiry (`game.expired` event)

**Files:**
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs` (`OnInviteExpired` ~149-152, `RespondAsync` else-branch ~183-186, `DeclineOrExpireAsync` ~189-204)
- Test: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`

- [ ] **Step 1: Write the failing tests**

Add two test methods to `GameSessionManagerTests`. They assert the emitted event `type`. `FakePublisher.Sent` stores `(kind, object msg)`; read the `type` property off the anonymous object via reflection with this local helper — add it as a `private static` method in the test class:

```csharp
    private static bool SentType(FakePublisher pub, string type) =>
        pub.Sent.Any(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == type);
```

Then the tests:

```csharp
    [TestMethod]
    public async Task ExplicitDecline_EmitsGameDeclined()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, new FakeAnnouncer(), GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: false);

        Assert.IsTrue(SentType(pub, "game.declined"));
        Assert.IsFalse(SentType(pub, "game.expired"));
    }

    [TestMethod]
    public async Task InviteExpiry_EmitsGameExpired()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, new FakeAnnouncer(), GameTestHelpers.NewRepo());

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.ExpireInviteForTestAsync(invite.MatchId);

        Assert.IsTrue(SentType(pub, "game.expired"));
        Assert.IsFalse(SentType(pub, "game.declined"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter Games`
Expected: FAIL — `ExpireInviteForTestAsync` doesn't exist (compile error) and expiry currently emits `game.declined`.

- [ ] **Step 3: Refactor `DeclineOrExpireAsync` into an event-typed core**

In `src/Brmble.Server/Games/GameSessionManager.cs`, replace `OnInviteExpired` (149-152) and `DeclineOrExpireAsync` (189-204) with:

```csharp
    private void OnInviteExpired(long matchId)
    {
        _ = EndPendingAsync(matchId, "game.expired");
    }

    // Test hook: simulate the 30s invite timer firing.
    internal Task ExpireInviteForTestAsync(long matchId) => EndPendingAsync(matchId, "game.expired");

    private async Task EndPendingAsync(long matchId, string eventType)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return;
        lock (match.Lock)
        {
            if (match.Status != "pending") return;
            match.Status = "done";
            match.InviteTimer?.Dispose();
            match.InviteTimer = null;
        }
        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new { type = eventType, matchId });
        foreach (var p in match.Players) _userToMatch.TryRemove(p, out _);
        _matches.TryRemove(matchId, out _);
    }
```

In `RespondAsync`, change the else-branch (line 185) from `await DeclineOrExpireAsync(matchId);` to:

```csharp
            await EndPendingAsync(matchId, "game.declined");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter Games`
Expected: PASS (including the two new tests and the existing invite tests).

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/GameSessionManager.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs
git commit -m "feat: distinguish invite decline from expiry via game.expired"
```

---

## Task 5: `GET/POST /games/settings` endpoints

**Files:**
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs` (add two routes after the stats route, ~line 73)

- [ ] **Step 1: Add the endpoints**

In `src/Brmble.Server/Games/GameEndpoints.cs`, add a DTO near the other records (after line 12):

```csharp
    public record GameSettingsDto(bool ChallengesBlocked);
```

Add these two routes inside `MapGameEndpoints`, immediately before `return app;` (line 75):

```csharp
        app.MapGet("/games/settings", async (HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            var blocked = await users.GetChallengesBlocked(user.UserId);
            return Results.Ok(new GameSettingsDto(blocked));
        });

        app.MapPost("/games/settings", async (GameSettingsDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await users.SetChallengesBlocked(user.UserId, dto.ChallengesBlocked);
            return Results.Ok(new GameSettingsDto(dto.ChallengesBlocked));
        });
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Run the full server test suite (regression)**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: PASS (330+ tests).

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Server/Games/GameEndpoints.cs
git commit -m "feat: add GET/POST /games/settings for challenge block"
```

---

## Task 6: Client `GameService` — pass through `game.expired` + settings

**Files:**
- Modify: `src/Brmble.Client/Services/Games/GameService.cs`

- [ ] **Step 1: Locate the `/ws` event forwarding + REST forwarding**

Read `src/Brmble.Client/Services/Games/GameService.cs`. Find (a) the list/switch of `game.*` event types it re-emits over the bridge (it already forwards `game.declined`, `game.ended`, etc.) and (b) how it forwards REST intents (the `games.request` / action forwarding pattern, mirroring stats).

- [ ] **Step 2: Forward `game.expired`**

Wherever the client whitelists/relays inbound `/ws` `game.*` events to the bridge, add `game.expired` alongside `game.declined` (identical handling — it carries `{ matchId }`). If the client relays all `game.*` events generically, no change is needed here; verify by reading the code.

- [ ] **Step 3: Ensure `/games/settings` is reachable**

The web `getGameSettings`/`setGameSettings` (Task 7) use `bridge.send('games.request', { action: 'settings-get' | 'settings-set', ... })` with a browser `fetch` fallback. In `GameService.cs`, extend the `games.request` handler so `action: 'settings-get'` does an authenticated GET `/games/settings` and `action: 'settings-set'` does a POST with `{ challengesBlocked }`, returning the JSON body over `games.response` (mirror the existing `stats` action exactly). If the client instead tunnels arbitrary paths generically, follow that pattern instead.

- [ ] **Step 4: Build the client**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Games/GameService.cs
git commit -m "feat: client passthrough for game.expired and game settings"
```

---

## Task 7: Web API — settings calls in `api/games.ts`

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts`

- [ ] **Step 1: Add the settings interface + calls**

In `src/Brmble.Web/src/api/games.ts`, after the `GameStats` interface (line 10) add:

```typescript
export interface GameSettings {
  challengesBlocked: boolean;
}
```

At the end of the file (after `getStats`, line 133) add `getGameSettings` and `setGameSettings`, following the exact bridge-request/`fetch`-fallback pattern used by `getStats` for the bridge branch and by `invite` for the fallback branch:

```typescript
export async function getGameSettings(): Promise<GameSettings> {
  if (isWebViewBridgeAvailable()) {
    const requestId = nextRequestId++;
    return new Promise<GameSettings>((resolve, reject) => {
      const cleanup = () => bridge.off('games.response', handleResponse);
      const handleResponse = (data: unknown) => {
        const response = data as { requestId?: number; success?: boolean; body?: string; statusCode?: number; error?: string };
        if (response.requestId !== requestId) return;
        cleanup();
        if (response.success && response.body) {
          resolve(JSON.parse(response.body) as GameSettings);
          return;
        }
        reject(new Error(response.error || (response.statusCode ? `Request failed (${response.statusCode}).` : 'Request failed.')));
      };
      bridge.on('games.response', handleResponse);
      bridge.send('games.request', { action: 'settings-get', requestId });
    });
  }

  const response = await fetch('/games/settings');
  if (!response.ok) {
    throw new Error(response.statusText || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<GameSettings>;
}

export async function setGameSettings(settings: GameSettings): Promise<GameSettings> {
  if (isWebViewBridgeAvailable()) {
    const requestId = nextRequestId++;
    return new Promise<GameSettings>((resolve, reject) => {
      const cleanup = () => bridge.off('games.response', handleResponse);
      const handleResponse = (data: unknown) => {
        const response = data as { requestId?: number; success?: boolean; body?: string; statusCode?: number; error?: string };
        if (response.requestId !== requestId) return;
        cleanup();
        if (response.success && response.body) {
          resolve(JSON.parse(response.body) as GameSettings);
          return;
        }
        reject(new Error(response.error || (response.statusCode ? `Request failed (${response.statusCode}).` : 'Request failed.')));
      };
      bridge.on('games.response', handleResponse);
      bridge.send('games.request', { action: 'settings-set', requestId, challengesBlocked: settings.challengesBlocked });
    });
  }

  const response = await fetch('/games/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(response.statusText || `Request failed (${response.status}).`);
  }
  return response.json() as Promise<GameSettings>;
}
```

- [ ] **Step 2: Type-check**

Run: `cd src/Brmble.Web ; npm run build`
Expected: build succeeds (no TS errors).

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/api/games.ts
git commit -m "feat: web api for game settings (challenge block)"
```

---

## Task 8: `useGameState` — outgoing invite tracking + role-aware outcomes

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/useGameState.ts`

This adds a challenger-facing `inviteOutcome` (`'declined' | 'expired' | 'blocked'` + the target's session id) that `App.tsx` renders as a notification. Only the challenger sees it (the recipient just clears state).

- [ ] **Step 1: Add outcome types and state**

In `src/Brmble.Web/src/components/Games/useGameState.ts`:

Add an exported type after `EndedMatch` (line 34):

```typescript
export type InviteOutcomeKind = 'declined' | 'expired' | 'blocked';

export interface InviteOutcome {
  kind: InviteOutcomeKind;
  targetSession: number | null;
}
```

Add to the `GameState` interface (after `penalty`, line 46):

```typescript
  /** Challenger-facing result of the last outgoing invite; null when none. */
  inviteOutcome: InviteOutcome | null;
  clearInviteOutcome: () => void;
```

Inside the hook, add state + a ref for the outgoing invite (after line 82):

```typescript
  const [inviteOutcome, setInviteOutcome] = useState<InviteOutcome | null>(null);
  const outgoingInviteRef = useRef<{ targetSession: number } | null>(null);
```

- [ ] **Step 2: Set the outgoing invite when we send one**

The `game.invited` event only reaches the *target*. The challenger knows its target from the `invite()` call. Change `invite` (lines 179-183) to record the target session:

```typescript
  const invite = useCallback((targetUserId: number) => {
    outgoingInviteRef.current = { targetSession: targetUserId };
    setInviteOutcome(null);
    gamesApi.invite(targetUserId, 'deathroll').catch(e => {
      // A blocked target comes back as a rejected invite; surface it as an outcome.
      const msg = e instanceof Error ? e.message : 'Failed to send invite.';
      if (/isn't accepting challenges/i.test(msg)) {
        setInviteOutcome({ kind: 'blocked', targetSession: outgoingInviteRef.current?.targetSession ?? null });
        outgoingInviteRef.current = null;
      } else {
        setLastError(msg);
        outgoingInviteRef.current = null;
      }
    });
  }, []);
```

Note: the blocked message text must match the server string in Task 3 Step 2 (`"This player isn't accepting challenges."`). The regex matches the distinctive `"isn't accepting challenges"` substring.

- [ ] **Step 3: Handle `game.declined` / `game.expired` role-aware**

Replace `handleDeclined` (lines 143-148) with two handlers. The recipient (who has an `incomingInvite`) just clears; the challenger (who has an `outgoingInvite`, no `incomingInvite`) gets the outcome:

```typescript
    const resolveOutgoing = (kind: InviteOutcomeKind) => {
      const out = outgoingInviteRef.current;
      // Recipient side: an incoming invite was open -> just clear it, no outcome.
      if (incomingInviteRef.current) {
        setIncomingInvite(null);
      }
      // Challenger side: we had an outgoing invite -> show the outcome.
      if (out) {
        setInviteOutcome({ kind, targetSession: out.targetSession });
        outgoingInviteRef.current = null;
      }
      setActiveMatch(null);
      setTurnDeadline(null);
      setPenalty(false);
    };

    const handleDeclined = () => resolveOutgoing('declined');
    const handleExpired = () => resolveOutgoing('expired');
```

When the challenger's own invite is *accepted*, clear the pending outgoing ref. In `handleStarted` (after line 105 `setIncomingInvite(null);`) add:

```typescript
      outgoingInviteRef.current = null;
```

- [ ] **Step 4: Register/unregister the `game.expired` bridge handler**

In the `useEffect`, add registration next to `game.declined` (line 164) and cleanup next to line 173:

```typescript
    bridge.on('game.expired', handleExpired);
```
```typescript
      bridge.off('game.expired', handleExpired);
```

- [ ] **Step 5: Expose the new state + clearer, and add `clearInviteOutcome`**

Add near `clearError` (line 219):

```typescript
  const clearInviteOutcome = useCallback(() => setInviteOutcome(null), []);
```

Add both to the returned object (in the `return { ... }` block, lines 221-237):

```typescript
    inviteOutcome,
    clearInviteOutcome,
```

- [ ] **Step 6: Type-check**

Run: `cd src/Brmble.Web ; npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Games/useGameState.ts
git commit -m "feat: challenger-facing invite outcome (declined/expired/blocked)"
```

---

## Task 9: `App.tsx` — fixed-duration invite + outcome notification

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (invite `<Notification>` ~4340-4358; queue registration ~940-943; add outcome notification + registration)

- [ ] **Step 1: Make the invite notification fixed-duration (no client timer)**

In `src/Brmble.Web/src/App.tsx`, in the `game-invite` `<Notification>` (lines 4341-4357), add `duration={null}` so there is no client auto-dismiss and nothing for hover to extend. The server removes it via `game.expired`. Change the opening props to:

```tsx
          <Notification
            status="info"
            position="top-right"
            duration={null}
            visible={!!gameState.incomingInvite}
            title="Deathroll challenge"
```

Leave `onDismiss={() => gameState.declineInvite()}` unchanged — `×` is still an explicit decline.

Verify `Notification` accepts `duration={null}` to mean "no auto-dismiss" by reading `src/Brmble.Web/src/components/Notification` (or wherever `<Notification>` is defined). If `null` is not already supported, add support: when `duration == null`, skip setting the auto-dismiss timer entirely (and do not pause/resume on hover). Keep existing numeric behavior unchanged.

- [ ] **Step 2: Register a replaceable `game-outcome` queue id**

After the existing `game-invite` registration effect (lines 940-943), add an effect that registers/unregisters the outcome notification and, per UI_GUIDE, unregisters the prior id before re-registering:

```tsx
  useEffect(() => {
    if (gameState.inviteOutcome) notifQueueRef.current.register('game-outcome', 'info');
    else notifQueueRef.current.unregister('game-outcome');
  }, [gameState.inviteOutcome]);
```

- [ ] **Step 3: Render the three-outcome notification**

In the `.notification-stack` (after the `game-invite` block ends at line 4358), add:

```tsx
        {gameState.inviteOutcome && notifQueue.isVisible('game-outcome') && (() => {
          const o = gameState.inviteOutcome;
          const name = o.targetSession != null ? resolveGamePlayerName(o.targetSession) : 'The player';
          const copy = o.kind === 'declined'
            ? { title: 'Challenge declined', detail: `${name} declined your Deathroll challenge.` }
            : o.kind === 'expired'
              ? { title: 'No response', detail: `${name} didn't respond to your challenge.` }
              : { title: 'Challenge blocked', detail: `${name} isn't accepting challenges.` };
          return (
            <Notification
              status="info"
              position="top-right"
              visible={!!gameState.inviteOutcome}
              title={copy.title}
              detail={copy.detail}
              onDismiss={() => gameState.clearInviteOutcome()}
              onExited={() => notifQueue.unregister('game-outcome')}
            />
          );
        })()}
```

This uses the default `info` 5s auto-dismiss + `role=status` (correct for an outcome message, unlike the invite which needed a fixed window).

- [ ] **Step 4: Type-check + build**

Run: `cd src/Brmble.Web ; npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: fixed-duration invite + challenger outcome notification"
```

---

## Task 10: New "Games" settings tab (block toggle + moved stats)

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx` (3 sites: union types ~47 & ~118; tab buttons ~434-486; content render ~488-542)
- Modify: `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx` (remove stats block 314-318 + `GameStats` import line 11)

- [ ] **Step 1: Read the current SettingsModal tab wiring and the toggle pattern**

Read `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx` around lines 40-55, 110-125, 430-545 to see the exact `initialTab`/`activeTab` union strings, the tab `<button>` markup, and the content render conditionals. Read `src/Brmble.Web/src/components/SettingsModal/MessagesSettingsTab.tsx:120-140` for the `settings-toggle` row markup. Read `ProfileSettingsTab.tsx:11` and `:314-318` for the stats block to move.

- [ ] **Step 2: Create the Games tab**

Create `src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.tsx`. Use the toggle-row structure from `MessagesSettingsTab` verbatim (classes `settings-item settings-toggle`, `label`, `label.brmble-toggle > input[type=checkbox] + span.brmble-toggle-slider`), and the section wrapper used by the current Profile stats block (`div.settings-section > h3.heading-section.settings-section-title`). No hardcoded colors/spacing/fonts.

```tsx
import { useEffect, useState } from 'react';
import GameStats from '../Profile/GameStats';
import { getGameSettings, setGameSettings } from '../../api/games';

export default function GamesSettingsTab() {
  const [challengesBlocked, setChallengesBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGameSettings()
      .then(s => { if (!cancelled) { setChallengesBlocked(s.challengesBlocked); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const toggle = (next: boolean) => {
    setChallengesBlocked(next); // optimistic
    setGameSettings({ challengesBlocked: next }).catch(() => setChallengesBlocked(!next));
  };

  return (
    <div>
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Challenges</h3>
        <div className="settings-item settings-toggle">
          <label htmlFor="games-block-challenges">Block all challenges</label>
          <label className="brmble-toggle">
            <input
              id="games-block-challenges"
              type="checkbox"
              checked={challengesBlocked}
              disabled={!loaded}
              onChange={e => toggle(e.target.checked)}
            />
            <span className="brmble-toggle-slider" />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Deathroll Stats</h3>
        <GameStats gameType="deathroll" />
      </div>
    </div>
  );
}
```

Confirm the exact toggle markup against `MessagesSettingsTab` (the `htmlFor`/`id` pairing and slider class names must match the existing pattern; adjust if the codebase uses a shared `Toggle` component instead of raw markup — prefer the shared component if one exists).

- [ ] **Step 3: Wire the tab into SettingsModal (3 edits)**

In `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`:

1. Import at top with the other tab imports: `import GamesSettingsTab from './GamesSettingsTab';`
2. Add `'games'` to the `initialTab` prop union type (~line 47) and the `activeTab` `useState` union type (~line 118).
3. Add a tab `<button>` in the tab list (~434-486), copying the exact markup/classes of a neighboring tab button (e.g. Profile), with label `Games` and `activeTab === 'games'` active logic and `onClick={() => setActiveTab('games')}`.
4. Add the content render next to the others (~488-542): `{activeTab === 'games' && <GamesSettingsTab />}`.

Match sibling markup exactly (order the tab wherever is logical — e.g. right after Profile).

- [ ] **Step 4: Remove the Deathroll stats from Profile**

In `src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx`, delete the stats block at lines 314-318:

```tsx
        <div className="settings-section">
          <h3 className="heading-section settings-section-title">Deathroll Stats</h3>
          <GameStats gameType="deathroll" />
        </div>
```

Then delete the now-unused `GameStats` import at line 11. Verify `GameStats` is not referenced elsewhere in the file before removing the import (grep the file).

- [ ] **Step 5: Type-check + build**

Run: `cd src/Brmble.Web ; npm run build`
Expected: build succeeds with no unused-import errors.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx src/Brmble.Web/src/components/SettingsModal/ProfileSettingsTab.tsx
git commit -m "feat: add Games settings tab with block toggle and moved Deathroll stats"
```

---

## Task 11: Web repeated-event test for the outcome notification

**Files:**
- Test: locate the existing top-right notification queue test (search `tests`/`__tests__` under `src/Brmble.Web` for `useNotificationQueue` or `register(`), add a case there or create a sibling test file.

Per UI_GUIDE: generated-id top-right notifications need a ≥4-event repeated-event test proving the replaceable id unregisters the prior before registering the next.

- [ ] **Step 1: Find the notification-queue test setup**

Run: search `src/Brmble.Web` for existing `useNotificationQueue` tests (Grep `register\(` in `*.test.ts*`). Read one to copy the harness (how the hook is rendered/driven — likely `@testing-library/react` `renderHook`).

- [ ] **Step 2: Write the failing/あて test**

Add a test that fires the outcome notification 4 times in a row with the id `game-outcome` and asserts only one is registered/visible at a time and that each `register` after an `unregister` succeeds (mirroring the assertions in the existing repeated-event test for another generated-id notification). Copy the existing repeated-event test's structure exactly, substituting `'game-outcome'`. If no such harness/test exists yet, add a minimal one following the existing `useNotificationQueue` test patterns.

- [ ] **Step 3: Run the web tests**

Run: `cd src/Brmble.Web ; npm test`
Expected: PASS. (If the project has no configured test runner, skip this task and note it — do not invent one; instead rely on the manual smoke test in Task 13.)

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web
git commit -m "test: repeated-event test for game-outcome notification"
```

---

## Task 12: Update `docs/UI_GUIDE.md`

**Files:**
- Modify: `docs/UI_GUIDE.md` (Minigame Invite/Modal Pattern section)

- [ ] **Step 1: Document the new behaviors**

Read the existing Minigame pattern section in `docs/UI_GUIDE.md`. Add/adjust text to document:
- The incoming-invite notification uses `duration={null}` (no client timer, no hover-extend) and is removed server-side at the 30s invite timeout via `game.expired`.
- The challenger sees exactly one of three replaceable `info` notifications under queue id `game-outcome`: **"Challenge declined"**, **"No response"**, **"Challenge blocked"** — each unregisters the prior id before re-registering.
- A new **Games** settings tab holds the "Block all challenges" server-backed toggle and the (relocated) Deathroll stats; Deathroll stats are no longer in the Profile tab.

- [ ] **Step 2: Commit**

```bash
git add docs/UI_GUIDE.md
git commit -m "docs: UI_GUIDE for fixed invite, outcome notifications, Games tab"
```

---

## Task 13: Full verification + multi-client smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full server test suite**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: all PASS (was 330; now +4 new server tests).

- [ ] **Step 2: Full solution build**

Run: `dotnet build`
Expected: Build succeeded.

- [ ] **Step 3: Web build**

Run: `cd src/Brmble.Web ; npm run build`
Expected: build succeeds.

- [ ] **Step 4: Rebuild + restart server (server changes shipped)**

Run: `docker compose -f docker-local/docker-compose.yml up -d --build brmble`
Then: `docker compose -f docker-local/docker-compose.yml logs -f brmble` (confirm it starts cleanly and the migration runs once).

- [ ] **Step 5: Sync the second worktree and run two clients**

After the final commit on this branch, capture the commit hash (`git rev-parse HEAD`), then:
```bash
git -C .worktrees/multi-share-test checkout <commit>
cd .worktrees/multi-share-test/src/Brmble.Web ; npm run build
```
Run two clients (main + worktree) per CLAUDE.md (`dotnet run --project src/Brmble.Client`, second with `-- --allow-multiple` if needed).

- [ ] **Step 6: Manual smoke checklist**

Verify all four flows between the two clients:
1. **Declined:** A challenges B; B presses ×. A sees "Challenge declined" (with B's name). B's invite disappears.
2. **No response:** A challenges B; B does nothing for 30s. The invite notification on B disappears at ~30s (not 5s, and hovering it does NOT keep it open). A sees "No response".
3. **Blocked:** B enables Settings → Games → "Block all challenges". A challenges B. A sees "Challenge blocked"; B gets no invite notification.
4. **Stats moved:** Settings → Games shows Deathroll Stats; Profile no longer shows them.

- [ ] **Step 7: Report**

Summarize results. Do NOT push or open a PR — ask the user first (per CLAUDE.md).

---

## Self-Review Notes

- **Spec coverage:** Feature 1 (declined/no-response/blocked) → Tasks 3,4,8,9. Feature 2 (fixed 30s invite) → Task 9 Step 1 + Task 4 (`game.expired` removal). Feature 3 (block setting, server-authoritative, Games tab, moved stats) → Tasks 1,2,3,5,7,10. Tests → Tasks 2,3,4,11,13. UI_GUIDE → Task 12.
- **Type consistency:** `InviteRejectReason` (Task 3) used identically in endpoint/tests; `InviteOutcomeKind`/`InviteOutcome` (Task 8) consumed unchanged in Task 9; `GameSettings.challengesBlocked` consistent across Tasks 5/7/10; blocked message string `"...isn't accepting challenges..."` matched between server (Task 3) and client regex (Task 8) — noted explicitly in both.
- **Deviation flagged:** live DB read via `IGamePresence.AreChallengesBlockedAsync` instead of `SessionMapping` caching (documented at top; approved rationale: correctness under runtime toggle + smaller surface).
