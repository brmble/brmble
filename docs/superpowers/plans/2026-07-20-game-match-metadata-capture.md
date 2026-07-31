# Game Match Metadata Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the already-existing-but-unused `metadata_json` columns on `game_matches`/`game_match_participants` with a versioned envelope containing participant display-name snapshots and Deathroll summary + per-player luck stats, so future stats panels have complete, non-recoverable data.

**Architecture:** The `DeathrollEngine` accumulates luck counters in its match `State` during play and exposes them via two new `IGameEngine` methods (`MatchSummary`, `ParticipantStats`) with `null`-returning default interface implementations. `GameSessionManager` composes a versioned JSON envelope (adding the identity snapshot it alone knows) and sets `MetadataJson` on the `CompletedMatch`/`CompletedParticipant` records it already builds. `GameRepository` is unchanged — it already persists `MetadataJson`. Per-channel stats need no new data: `game_matches.channel_id` is already stored.

**Tech Stack:** C# / .NET, MSTest, Dapper + SQLite, `System.Text.Json`.

**Reference spec:** `docs/superpowers/specs/2026-07-20-game-match-metadata-capture-design.md`

**Scope guard (Non-Goals):** No UI, no read endpoints/services, no new tables, no new index, no `game_head_to_head.channel_id`, no avatar snapshot, no channel-name snapshot, no full roll-by-roll sequence.

---

## File Structure

- `src/Brmble.Server/Games/IGameEngine.cs` — add two default-null interface methods.
- `src/Brmble.Server/Games/Engines/DeathrollEngine.cs` — add luck counters to `State`; implement the two methods.
- `src/Brmble.Server/Games/GameSessionManager.cs` — compose + serialize the metadata envelope on complete + forfeit.
- `tests/Brmble.Server.Tests/Games/DeathrollEngineTests.cs` — luck-stat tests.
- `tests/Brmble.Server.Tests/Games/GameTestHelpers.cs` — add `NewRepoWithDb()`.
- `tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs` — metadata round-trip test.
- `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs` — composed-envelope tests.
- `docs/games-metadata.md` — new doc for the versioned convention.

---

## Task 1: Deathroll engine — luck counters + metadata methods

**Files:**
- Modify: `src/Brmble.Server/Games/IGameEngine.cs`
- Modify: `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`
- Test: `tests/Brmble.Server.Tests/Games/DeathrollEngineTests.cs`

- [ ] **Step 1: Write the failing tests**

Add these two methods to the existing `DeathrollEngineTests` class in `tests/Brmble.Server.Tests/Games/DeathrollEngineTests.cs` (the `QueueRandom` helper and `Players` field already exist in that file):

```csharp
    [TestMethod]
    public void CapturesMatchSummaryAndPerPlayerLuckStats()
    {
        var engine = new DeathrollEngine();
        // ceiling starts 100. 10 rolls 80 (top100), 20 rolls 40 (top80), 10 rolls 1 (top40 -> loss).
        var rng = new QueueRandom(80, 40, 1);
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);

        var summary = engine.MatchSummary(state)!;
        Assert.AreEqual(100, GetInt(summary, "startingCeiling"));
        Assert.AreEqual(3, GetInt(summary, "totalRolls"));
        Assert.AreEqual(1, GetInt(summary, "finalRoll"));

        var p10 = engine.ParticipantStats(state, 10)!;
        Assert.AreEqual(2, GetInt(p10, "rolls"));
        Assert.AreEqual(1, GetInt(p10, "rollsAboveMid")); // 80>50
        Assert.AreEqual(1, GetInt(p10, "rollsBelowMid")); // 1<=20
        Assert.AreEqual(0.4125, GetDouble(p10, "avgRollRatio"), 1e-9); // (0.8 + 0.025)/2

        var p20 = engine.ParticipantStats(state, 20)!;
        Assert.AreEqual(1, GetInt(p20, "rolls"));
        Assert.AreEqual(0, GetInt(p20, "rollsAboveMid")); // 40 !> 40
        Assert.AreEqual(1, GetInt(p20, "rollsBelowMid"));
        Assert.AreEqual(0.5, GetDouble(p20, "avgRollRatio"), 1e-9); // 40/80
    }

    [TestMethod]
    public void ForcedLossExcludedFromLuckCountersButSetsFinalRoll()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(2); // 10 rolls 2 (top100 -> ceiling 2), then 20 times out to forced loss
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        engine.ApplyTimeoutPenalty(state, rng); // floor(2*0.8)=1 -> forced loss for 20

        var summary = engine.MatchSummary(state)!;
        Assert.AreEqual(1, GetInt(summary, "totalRolls")); // only the real roll counts
        Assert.AreEqual(1, GetInt(summary, "finalRoll"));

        var p10 = engine.ParticipantStats(state, 10)!;
        Assert.AreEqual(1, GetInt(p10, "rolls"));
        Assert.AreEqual(0, GetInt(p10, "rollsAboveMid")); // 2 !> 50
        Assert.AreEqual(1, GetInt(p10, "rollsBelowMid"));

        var p20 = engine.ParticipantStats(state, 20)!;
        Assert.AreEqual(0, GetInt(p20, "rolls"));
        Assert.AreEqual(0.0, GetDouble(p20, "avgRollRatio"), 1e-9);
    }

    // Reflection helpers: the engine returns anonymous objects.
    private static int GetInt(object o, string name)
        => Convert.ToInt32(o.GetType().GetProperty(name)!.GetValue(o));
    private static double GetDouble(object o, string name)
        => Convert.ToDouble(o.GetType().GetProperty(name)!.GetValue(o));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "CapturesMatchSummaryAndPerPlayerLuckStats|ForcedLossExcludedFromLuckCountersButSetsFinalRoll"`
Expected: FAIL — `IGameEngine` has no `MatchSummary` / `ParticipantStats`.

- [ ] **Step 3: Add the two methods to `IGameEngine`**

In `src/Brmble.Server/Games/IGameEngine.cs`, inside the `interface IGameEngine` block, after the `PublicView` method, add default-null implementations so other engines need no change:

```csharp
    // Game-specific match-level summary for persistence (metadata_json.summary).
    // Returns null when the game has no summary. Default: none.
    object? MatchSummary(object state) => null;

    // Game-specific per-player stats for persistence (metadata_json[gameType]).
    // Returns null when the game has none. Default: none.
    object? ParticipantStats(object state, long userId) => null;
```

- [ ] **Step 4: Add counters to `DeathrollEngine.State`**

In `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`, extend the private `State` class (currently has `Players`, `CurrentIndex`, `Ceiling`, `LastRoll`, `LoserId`) with:

```csharp
        public int StartingCeiling = StartCeiling;
        public int TotalRolls;
        public readonly Dictionary<long, PlayerLuck> Luck = new();
```

And add this nested class inside `DeathrollEngine` (next to `State`):

```csharp
    private sealed class PlayerLuck
    {
        public int Rolls;
        public int AboveMid;
        public int BelowMid;
        public double RatioSum;
    }
```

- [ ] **Step 5: Initialize per-player luck in `InitialState`**

In `DeathrollEngine.InitialState`, replace the `return new State { ... }` with one that seeds the luck dictionary:

```csharp
        return new State
        {
            Players = new[] { players[0].UserId, players[1].UserId },
            Luck =
            {
                [players[0].UserId] = new PlayerLuck(),
                [players[1].UserId] = new PlayerLuck(),
            },
        };
```

- [ ] **Step 6: Accumulate counters in `DoRoll`**

In `DeathrollEngine.DoRoll`, immediately after `var value = rng.Roll(s.Ceiling);` and before `s.LastRoll = value;`, insert counter updates using the pre-roll ceiling (`s.Ceiling`):

```csharp
        var top = s.Ceiling;
        var luck = s.Luck[userId];
        luck.Rolls++;
        s.TotalRolls++;
        if (value > top / 2.0) luck.AboveMid++; else luck.BelowMid++;
        luck.RatioSum += (double)value / top;
```

(Do not modify the timeout-penalty path — forced losses must not count as rolls.)

- [ ] **Step 7: Implement `MatchSummary` and `ParticipantStats`**

In `DeathrollEngine`, add (e.g. after `GetOutcome`):

```csharp
    public object? MatchSummary(object state)
    {
        var s = (State)state;
        return new
        {
            startingCeiling = s.StartingCeiling,
            totalRolls = s.TotalRolls,
            finalRoll = s.LoserId is not null ? s.LastRoll : (int?)null,
        };
    }

    public object? ParticipantStats(object state, long userId)
    {
        var s = (State)state;
        if (!s.Luck.TryGetValue(userId, out var luck)) return null;
        return new
        {
            rolls = luck.Rolls,
            rollsAboveMid = luck.AboveMid,
            rollsBelowMid = luck.BelowMid,
            avgRollRatio = luck.Rolls == 0 ? 0.0 : luck.RatioSum / luck.Rolls,
        };
    }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "CapturesMatchSummaryAndPerPlayerLuckStats|ForcedLossExcludedFromLuckCountersButSetsFinalRoll"`
Expected: PASS (both).

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Server/Games/IGameEngine.cs src/Brmble.Server/Games/Engines/DeathrollEngine.cs tests/Brmble.Server.Tests/Games/DeathrollEngineTests.cs
git commit -m "feat: capture Deathroll summary + per-player luck stats in engine"
```

---

## Task 2: Repository metadata round-trip test + test helper

**Files:**
- Modify: `tests/Brmble.Server.Tests/Games/GameTestHelpers.cs`
- Test: `tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs`

This task adds no production code — it proves the existing repository persists `MetadataJson` (guards against regressions and gives later tasks a DB reader).

- [ ] **Step 1: Add a repo+db helper**

In `tests/Brmble.Server.Tests/Games/GameTestHelpers.cs`, add a method that also returns the `Database` (needed to read raw rows):

```csharp
    public static (GameRepository repo, Database db) NewRepoWithDb()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return (new GameRepository(db), db);
    }
```

- [ ] **Step 2: Write the failing test**

Add to `tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs` a test that saves a match with metadata and reads the raw columns back. Add `using Dapper;` and `using System;` at the top of the file if not already present.

```csharp
    [TestMethod]
    public async Task SaveCompletedMatch_PersistsMetadataJson_RoundTrips()
    {
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var match = new CompletedMatch(
            GameType: "deathroll",
            ChannelId: 7,
            Format: "1v1",
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: DateTimeOffset.UtcNow.AddMinutes(-1),
            EndedAt: DateTimeOffset.UtcNow,
            Participants: new[]
            {
                new CompletedParticipant(10, 1, null, "win",
                    MetadataJson: "{\"schemaVersion\":1,\"displayName\":\"Alice\"}"),
                new CompletedParticipant(20, 2, 1, "loss",
                    MetadataJson: "{\"schemaVersion\":1,\"displayName\":\"Bob\"}"),
            },
            MetadataJson: "{\"schemaVersion\":1,\"summary\":{\"totalRolls\":3}}");

        var matchId = await repo.SaveCompletedMatchAsync(match);

        using var conn = db.CreateConnection();
        var matchMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_matches WHERE id = @matchId", new { matchId });
        Assert.IsTrue(matchMeta.Contains("\"totalRolls\":3"));

        var aliceMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_match_participants WHERE match_id = @matchId AND user_id = 10",
            new { matchId });
        Assert.IsTrue(aliceMeta.Contains("Alice"));
    }
```

- [ ] **Step 3: Run the test**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "SaveCompletedMatch_PersistsMetadataJson_RoundTrips"`
Expected: PASS (the repository already writes `metadata_json`; this confirms it).

- [ ] **Step 4: Commit**

```bash
git add tests/Brmble.Server.Tests/Games/GameTestHelpers.cs tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs
git commit -m "test: verify game match metadata_json round-trips through repository"
```

---

## Task 3: GameSessionManager composes the versioned envelope

**Files:**
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs`
- Test: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`

- [ ] **Step 1: Write the failing tests**

Add to `GameSessionManagerTests` (the `FakePresence`, `FakePublisher`, `NewManager` helpers already exist; note `FakePresence.GetDisplayName` returns `"user{sessionId}"`). These play a full match / forfeit, then read the persisted metadata from the DB.

Add a helper at the top of the test class:

```csharp
    private static GameSessionManager NewManager(IGamePresence presence, IGameEventPublisher pub,
        GameRepository repo) // existing overload; keep it
        => new GameSessionManager(new IGameEngine[] { new DeathrollEngine() },
            new CryptoRandomSource(), presence, pub, repo);
```

(If that overload already exists, skip re-adding it.) Then the tests:

```csharp
    [TestMethod]
    public async Task CompletedMatch_PersistsVersionedMetadataEnvelope()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var mgr = NewManager(presence, new FakePublisher(), repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);
        for (var i = 0; i < 100000 && mgr.IsMatchLive(invite.MatchId); i++)
        {
            var current = mgr.GetCurrentPlayer(invite.MatchId);
            await mgr.ActionAsync(invite.MatchId, current, new Dictionary<string, object?> { ["roll"] = true });
        }

        using var conn = db.CreateConnection();
        var matchMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_matches ORDER BY id DESC LIMIT 1");
        Assert.IsTrue(matchMeta.Contains("\"schemaVersion\":1"));
        Assert.IsTrue(matchMeta.Contains("\"summary\""));
        Assert.IsTrue(matchMeta.Contains("startingCeiling"));

        var partMetas = (await conn.QueryAsync<string>(
            "SELECT metadata_json FROM game_match_participants")).ToList();
        Assert.AreEqual(2, partMetas.Count);
        foreach (var m in partMetas)
        {
            Assert.IsTrue(m.Contains("\"schemaVersion\":1"));
            Assert.IsTrue(m.Contains("displayName"));
            Assert.IsTrue(m.Contains("deathroll"));
        }
    }

    [TestMethod]
    public async Task ForfeitedMatch_PersistsVersionedMetadataEnvelope()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var (repo, db) = GameTestHelpers.NewRepoWithDb();
        var mgr = NewManager(presence, new FakePublisher(), repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);
        await mgr.ForfeitAsync(invite.MatchId, userId: mgr.GetCurrentPlayer(invite.MatchId), reason: "quit");

        using var conn = db.CreateConnection();
        var matchMeta = await conn.QuerySingleAsync<string>(
            "SELECT metadata_json FROM game_matches ORDER BY id DESC LIMIT 1");
        Assert.IsTrue(matchMeta.Contains("\"schemaVersion\":1"));
        Assert.IsTrue(matchMeta.Contains("\"summary\""));

        var partMetas = (await conn.QueryAsync<string>(
            "SELECT metadata_json FROM game_match_participants")).ToList();
        Assert.AreEqual(2, partMetas.Count);
        Assert.IsTrue(partMetas.All(m => m.Contains("displayName") && m.Contains("deathroll")));
    }
```

Add `using Dapper;` to the test file if not present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "CompletedMatch_PersistsVersionedMetadataEnvelope|ForfeitedMatch_PersistsVersionedMetadataEnvelope"`
Expected: FAIL — persisted `metadata_json` is currently `null` (assertions on content fail).

- [ ] **Step 3: Add metadata-builder helpers to `GameSessionManager`**

Ensure `using System.Text.Json;` is at the top of `src/Brmble.Server/Games/GameSessionManager.cs`. Add these private helpers near `NameOf` (around line 383):

```csharp
    private static string BuildMatchMetadata(LiveMatch match)
        => JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            summary = match.Engine.MatchSummary(match.State),
        });

    // Keyed by SESSION id (matches SessionToName and engine state keys).
    private string BuildParticipantMetadata(LiveMatch match, long sessionId)
    {
        var envelope = new Dictionary<string, object?>
        {
            ["schemaVersion"] = 1,
            ["displayName"] = NameOf(match, sessionId),
        };
        var stats = match.Engine.ParticipantStats(match.State, sessionId);
        if (stats is not null) envelope[match.GameType] = stats;
        return JsonSerializer.Serialize(envelope);
    }
```

- [ ] **Step 4: Populate metadata in `CompleteMatchAsync`**

In `CompleteMatchAsync`, replace the `persistedParticipants` projection and the `completed` construction (currently lines ~310-323) with versions that attach metadata. The engine `outcome.Participants` are keyed by **session id** — build metadata before translating to db ids:

```csharp
        var persistedParticipants = outcome.Participants
            .Select(p =>
            {
                var meta = BuildParticipantMetadata(match, p.UserId); // p.UserId = session id here
                var dbId = match.SessionToUser.TryGetValue(p.UserId, out var id) ? id : p.UserId;
                return p with { UserId = dbId, MetadataJson = meta };
            })
            .ToArray();
        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: "1v1",
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: persistedParticipants,
            MetadataJson: BuildMatchMetadata(match));
```

- [ ] **Step 5: Populate metadata in `ForfeitAsync`**

In `ForfeitAsync`, replace the `participants` array and `completed` construction (currently lines ~355-368). `otherId` is the winner's session id, `userId` is the quitter's session id:

```csharp
        var participants = new[]
        {
            new CompletedParticipant(winnerDbId, Placement: 1, Score: null, Result: "win",
                MetadataJson: BuildParticipantMetadata(match, otherId)),
            new CompletedParticipant(loserDbId, Placement: 2, Score: null, Result: "abandoned",
                MetadataJson: BuildParticipantMetadata(match, userId)),
        };
        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: "1v1",
            Outcome: "abandoned",
            AbandonReason: reason,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: participants,
            MetadataJson: BuildMatchMetadata(match));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "CompletedMatch_PersistsVersionedMetadataEnvelope|ForfeitedMatch_PersistsVersionedMetadataEnvelope"`
Expected: PASS (both).

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/GameSessionManager.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs
git commit -m "feat: persist versioned game match metadata envelope on complete and forfeit"
```

---

## Task 4: Document the metadata convention

**Files:**
- Create: `docs/games-metadata.md`

- [ ] **Step 1: Write the doc**

Create `docs/games-metadata.md`:

```markdown
# Game Match Metadata (`metadata_json`)

Every completed match writes a **versioned JSON envelope** to the `metadata_json`
columns of `game_matches` and `game_match_participants`. Future game engines must
follow this shape so no schema change is needed per game. Pre-existing rows may
have `metadata_json = NULL`; readers must treat all fields as optional.

## Match-level (`game_matches.metadata_json`)

    {
      "schemaVersion": 1,
      "summary": { /* game-specific, or null */ }
    }

Per-channel stats do NOT live here — group by the `game_matches.channel_id`
column (a duel can only start between users in the same channel).

## Participant-level (`game_match_participants.metadata_json`)

    {
      "schemaVersion": 1,
      "displayName": "Alice",        // snapshot at match time (survives rename/leave)
      "<gameType>": { /* per-player game-specific stats, optional */ }
    }

Avatars are NOT snapshotted — resolve them live from the server / default icon.

## Deathroll

`summary`:

    { "startingCeiling": 100, "totalRolls": 7, "finalRoll": 1 }

`finalRoll` is `null` for abandoned/forfeited matches.

Participant `deathroll`:

    { "rolls": 4, "rollsAboveMid": 1, "rollsBelowMid": 3, "avgRollRatio": 0.41 }

- `rollsAboveMid` / `rollsBelowMid`: each roll compared to the midpoint of its
  own range (`value > ceiling / 2` counts as above).
- `avgRollRatio`: mean of `value / ceiling` (0–1), a ceiling-normalized luck
  measure. Timeout forced-losses are excluded from all per-player counters.

## Adding a new game

Implement `IGameEngine.MatchSummary` and `IGameEngine.ParticipantStats`
(both default to `null`). `GameSessionManager` merges in `schemaVersion` and the
`displayName` snapshot automatically. Store the per-player object under the
engine's `GameType` key.
```

- [ ] **Step 2: Commit**

```bash
git add docs/games-metadata.md
git commit -m "docs: document versioned game match metadata_json convention"
```

---

## Task 5: Full verification, docker rebuild, worktree sync

**Files:** none (verification + environment sync only).

- [ ] **Step 1: Build the server**

Run: `dotnet build`
Expected: Build succeeded, 0 errors. (Ignore any editor/LSP restore-noise like "Dapper/Ice/TestClass not found" — only `dotnet build` output is authoritative.)

- [ ] **Step 2: Run the full server test suite**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: All tests pass (existing count + the 5 new tests added here).

- [ ] **Step 3: Rebuild the local server container**

This is a server change, so the running container must be rebuilt:

Run: `docker compose -f docker-local/docker-compose.yml up -d --build brmble`
Expected: `brmble` container builds and starts without error.

- [ ] **Step 4: Sync the second worktree**

No web files changed, so no `npm run build` is required. Only sync if the worktree tracks server code for parallel testing; otherwise skip. If syncing:

Run: `git -C .worktrees/multi-share-test checkout <current-commit-hash>`
Expected: worktree HEAD moves to the new commit. (Git prints "Previous HEAD position ..." to stderr — that is normal, not an error.)

- [ ] **Step 5: Final review**

Confirm on branch `feature/minigame-framework`, all five task commits present:

Run: `git log --oneline -6`
Expected: the metadata commits from Tasks 1–4 are listed. Do NOT push or open a PR — ask the user first (per CLAUDE.md branch rules).
```

---

## Self-Review

**Spec coverage:**
- Versioned `metadata_json` convention → Tasks 1, 3, 4. ✓
- Participant `displayName` snapshot → Task 3 (`BuildParticipantMetadata`). ✓
- Deathroll `summary` (startingCeiling/totalRolls/finalRoll) → Task 1. ✓
- Deathroll per-player luck (rolls/aboveMid/belowMid/avgRollRatio) → Task 1. ✓
- Forced-loss excluded from luck counters → Task 1 Step 6 + test. ✓
- Engine owns game shape via `MatchSummary`/`ParticipantStats` (Option A) → Task 1. ✓
- Session layer merges identity → Task 3. ✓
- Repository unchanged, round-trip verified → Task 2. ✓
- Per-channel via existing `channel_id`, no channel-name snapshot → honored (no code added). ✓
- Dedicated `docs/games-metadata.md`, no UI_GUIDE change → Task 4. ✓
- Server change → docker rebuild + worktree sync → Task 5. ✓
- Non-goals (no UI/endpoints/tables/index/H2H column/avatar) → nothing in plan violates these. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — all code shown inline. ✓

**Type consistency:** `MatchSummary(object)`/`ParticipantStats(object,long)` signatures identical across IGameEngine, DeathrollEngine, and GameSessionManager callers. `BuildMatchMetadata`/`BuildParticipantMetadata` names consistent between Task 3 steps and their call sites. `NewRepoWithDb()` defined in Task 2, used in Tasks 2 & 3. `CompletedParticipant`/`CompletedMatch` `MetadataJson` param names match `GameMatchModels.cs`. ✓
