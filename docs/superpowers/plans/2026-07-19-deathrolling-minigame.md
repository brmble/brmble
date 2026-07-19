# Deathrolling Mini-Game (Server-Authoritative) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a server-authoritative 1v1 Deathrolling duel between two Brmble clients in the same voice channel, with persisted match history, per-user and head-to-head stats, and an escalating turn-timeout penalty.

**Architecture:** Game rules, state, RNG, and timers live in `Brmble.Server` (`Games/`). Web sends `game.*` intents over the NativeBridge; the client `GameService` forwards them to the server over mTLS REST; the server pushes game events over the existing `/ws` + `IBrmbleEventBus`, which the client re-emits over the bridge to React. Completed matches persist to SQLite (Dapper) using a format-agnostic match + participants schema.

**Tech Stack:** ASP.NET Core minimal API, Dapper + SQLite, ZeroC/existing event bus, C# xUnit (`Brmble.Server.Tests`), React + TypeScript + Vite, WebView2 NativeBridge.

**Reference spec:** `docs/superpowers/specs/2026-07-19-minigame-framework-design.md`

**Scope:** Deathrolling only (build-order phases 1–5). RPS (phase 6) is a follow-up plan once the `IGameEngine` abstraction is proven.

---

## File Structure

**Server (`src/Brmble.Server/Games/`)**
- `IRandomSource.cs` — RNG abstraction (`Roll(int maxInclusive)` → `1..max`).
- `CryptoRandomSource.cs` — crypto-backed production impl.
- `IGameEngine.cs` — engine contract + shared types (`GameOutcome`, `GamePlayer`, `GameActionResult`, `InteractionModel`).
- `Engines/DeathrollEngine.cs` — Deathroll rules, ceiling, penalty math.
- `GameMatchModels.cs` — DB records (`GameMatch`, `GameParticipant`) + stats DTOs.
- `GameRepository.cs` — Dapper persistence + aggregate-cache updates (one transaction).
- `GameStatsService.cs` — on-demand windowed/streak/head-to-head queries.
- `GameSessionManager.cs` — in-memory live matches, invite/turn lifecycle, timers, enforcement, persistence + announcement on finish.
- `GameEndpoints.cs` — REST endpoints (`/games/*`).
- `GamesExtensions.cs` — DI registration.
- Schema added in `src/Brmble.Server/Data/Database.cs` `Initialize()`.

**Client (`src/Brmble.Client/Services/Games/`)**
- `GameService.cs` — `IService` (`ServiceName = "games"`); forwards `game.*` intents to server over mTLS, re-emits `/ws` game events over bridge.

**Web (`src/Brmble.Web/src/`)**
- `api/games.ts` — bridge-tunneled game API with browser `fetch` fallback.
- `components/Games/DeathrollModal.tsx` + `.module.css` — board/roll UI + countdown.
- `components/Games/useGameState.ts` — subscribes to `game.*` bridge events.
- Invite entry wired into existing user row/tooltip; invite prompt via existing `<Notification>` + `useNotificationQueue`.
- `components/Profile/GameStats.tsx` — per-user stats view.

**Tests (`tests/Brmble.Server.Tests/Games/`)**
- `DeathrollEngineTests.cs`, `GameRepositoryTests.cs`, `GameStatsServiceTests.cs`, `GameSessionManagerTests.cs`.

---

## Phase 1 — Schema, Models, Repository

### Task 1: Add game tables to the schema

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs` (inside `Initialize()`, after the existing `conn.Execute(...)` blocks)

- [ ] **Step 1: Add the schema block**

Add a new `conn.Execute` call in `Initialize()`:

```csharp
conn.Execute("""
    CREATE TABLE IF NOT EXISTS game_matches (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        game_type       TEXT NOT NULL,
        channel_id      INTEGER NOT NULL,
        format          TEXT NOT NULL DEFAULT '1v1',
        outcome         TEXT NOT NULL,
        abandon_reason  TEXT,
        started_at      TEXT NOT NULL,
        ended_at        TEXT NOT NULL,
        duration_ms     INTEGER NOT NULL DEFAULT 0,
        metadata_json   TEXT
    );
    CREATE TABLE IF NOT EXISTS game_match_participants (
        match_id        INTEGER NOT NULL,
        user_id         INTEGER NOT NULL,
        placement       INTEGER NOT NULL,
        score           INTEGER,
        result          TEXT NOT NULL,
        metadata_json   TEXT,
        PRIMARY KEY (match_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS game_user_stats (
        user_id         INTEGER NOT NULL,
        game_type       TEXT NOT NULL,
        wins            INTEGER NOT NULL DEFAULT 0,
        losses          INTEGER NOT NULL DEFAULT 0,
        draws           INTEGER NOT NULL DEFAULT 0,
        abandons        INTEGER NOT NULL DEFAULT 0,
        games_played    INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (user_id, game_type)
    );
    CREATE TABLE IF NOT EXISTS game_head_to_head (
        player_low_id   INTEGER NOT NULL,
        player_high_id  INTEGER NOT NULL,
        game_type       TEXT NOT NULL,
        low_wins        INTEGER NOT NULL DEFAULT 0,
        high_wins       INTEGER NOT NULL DEFAULT 0,
        draws           INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (player_low_id, player_high_id, game_type),
        CHECK (player_low_id < player_high_id)
    );
    CREATE INDEX IF NOT EXISTS ix_game_matches_ended_at ON game_matches(ended_at);
    CREATE INDEX IF NOT EXISTS ix_game_matches_game_type ON game_matches(game_type);
    CREATE INDEX IF NOT EXISTS ix_gmp_user_id ON game_match_participants(user_id);
    CREATE INDEX IF NOT EXISTS ix_gmp_match_id ON game_match_participants(match_id);
    """);
```

- [ ] **Step 2: Build the server project to verify schema compiles**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Data/Database.cs
git commit -m "feat: add game match, participant, and stats tables"
```

### Task 2: Define DB record models

**Files:**
- Create: `src/Brmble.Server/Games/GameMatchModels.cs`

- [ ] **Step 1: Write the models**

```csharp
namespace Brmble.Server.Games;

public record GameMatch(
    long Id,
    string GameType,
    int ChannelId,
    string Format,
    string Outcome,
    string? AbandonReason,
    string StartedAt,
    string EndedAt,
    long DurationMs,
    string? MetadataJson);

public record GameParticipant(
    long MatchId,
    long UserId,
    int Placement,
    int? Score,
    string Result,
    string? MetadataJson);

// Value passed from GameSessionManager to GameRepository on match completion.
public record CompletedMatch(
    string GameType,
    int ChannelId,
    string Format,
    string Outcome,               // "decided" | "draw" | "abandoned"
    string? AbandonReason,        // null unless abandoned
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    IReadOnlyList<CompletedParticipant> Participants,
    string? MetadataJson = null);

public record CompletedParticipant(
    long UserId,
    int Placement,                // 1 = winner
    int? Score,
    string Result,                // "win" | "loss" | "draw" | "abandoned"
    string? MetadataJson = null);

public record UserGameStats(
    long UserId,
    string GameType,
    int Wins,
    int Losses,
    int Draws,
    int Abandons,
    int GamesPlayed)
{
    public double WinRatio => GamesPlayed == 0 ? 0 : (double)Wins / GamesPlayed;
}
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Games/GameMatchModels.cs
git commit -m "feat: add game match domain models"
```

### Task 3: GameRepository — persist match + participants + aggregates (TDD)

**Files:**
- Create: `src/Brmble.Server/Games/GameRepository.cs`
- Test: `tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs`

- [ ] **Step 1: Write the failing test**

```csharp
using Brmble.Server.Data;
using Brmble.Server.Games;
using Dapper;
using Xunit;

namespace Brmble.Server.Tests.Games;

public class GameRepositoryTests
{
    private static Database NewDb()
    {
        // Shared in-memory DB kept alive by an open connection is complex with Dapper here;
        // use a temp file DB for isolation.
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return db;
    }

    [Fact]
    public async Task SaveCompletedMatch_WritesMatchParticipantsAndAggregates()
    {
        var db = NewDb();
        var repo = new GameRepository(db);
        var now = DateTimeOffset.UtcNow;

        var completed = new CompletedMatch(
            GameType: "deathroll",
            ChannelId: 5,
            Format: "1v1",
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: now,
            EndedAt: now.AddSeconds(30),
            Participants: new[]
            {
                new CompletedParticipant(UserId: 10, Placement: 1, Score: 4, Result: "win"),
                new CompletedParticipant(UserId: 20, Placement: 2, Score: 1, Result: "loss"),
            });

        var matchId = await repo.SaveCompletedMatchAsync(completed);
        Assert.True(matchId > 0);

        var winnerStats = await repo.GetUserStatsAsync(10, "deathroll");
        Assert.Equal(1, winnerStats.Wins);
        Assert.Equal(0, winnerStats.Losses);
        Assert.Equal(1, winnerStats.GamesPlayed);

        var loserStats = await repo.GetUserStatsAsync(20, "deathroll");
        Assert.Equal(1, loserStats.Losses);

        using var conn = db.CreateConnection();
        var h2h = conn.QuerySingle<(int low_wins, int high_wins, int draws)>(
            "SELECT low_wins, high_wins, draws FROM game_head_to_head WHERE player_low_id=10 AND player_high_id=20 AND game_type='deathroll'");
        Assert.Equal(1, h2h.low_wins);
        Assert.Equal(0, h2h.high_wins);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameRepositoryTests`
Expected: FAIL (compile error — `GameRepository` does not exist).

- [ ] **Step 3: Implement GameRepository**

```csharp
using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Games;

public class GameRepository
{
    private readonly Database _db;

    public GameRepository(Database db) => _db = db;

    public async Task<long> SaveCompletedMatchAsync(CompletedMatch match)
    {
        using var conn = _db.CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction();

        var matchId = await conn.QuerySingleAsync<long>("""
            INSERT INTO game_matches
                (game_type, channel_id, format, outcome, abandon_reason, started_at, ended_at, duration_ms, metadata_json)
            VALUES
                (@GameType, @ChannelId, @Format, @Outcome, @AbandonReason, @StartedAt, @EndedAt, @DurationMs, @MetadataJson);
            SELECT last_insert_rowid();
            """,
            new
            {
                match.GameType,
                match.ChannelId,
                match.Format,
                match.Outcome,
                match.AbandonReason,
                StartedAt = match.StartedAt.ToString("o"),
                EndedAt = match.EndedAt.ToString("o"),
                DurationMs = (long)(match.EndedAt - match.StartedAt).TotalMilliseconds,
                match.MetadataJson,
            }, tx);

        foreach (var p in match.Participants)
        {
            await conn.ExecuteAsync("""
                INSERT INTO game_match_participants (match_id, user_id, placement, score, result, metadata_json)
                VALUES (@MatchId, @UserId, @Placement, @Score, @Result, @MetadataJson);
                """,
                new { MatchId = matchId, p.UserId, p.Placement, p.Score, p.Result, p.MetadataJson }, tx);

            await UpsertUserStatsAsync(conn, tx, p.UserId, match.GameType, p.Result);
        }

        if (match.Participants.Count == 2)
        {
            await UpsertHeadToHeadAsync(conn, tx, match.GameType, match.Participants[0], match.Participants[1]);
        }

        tx.Commit();
        return matchId;
    }

    private static async Task UpsertUserStatsAsync(System.Data.IDbConnection conn, System.Data.IDbTransaction tx,
        long userId, string gameType, string result)
    {
        var now = DateTimeOffset.UtcNow.ToString("o");
        await conn.ExecuteAsync("""
            INSERT INTO game_user_stats (user_id, game_type, wins, losses, draws, abandons, games_played, updated_at)
            VALUES (@UserId, @GameType,
                    @Win, @Loss, @Draw, @Abandon, 1, @Now)
            ON CONFLICT(user_id, game_type) DO UPDATE SET
                wins = wins + @Win,
                losses = losses + @Loss,
                draws = draws + @Draw,
                abandons = abandons + @Abandon,
                games_played = games_played + 1,
                updated_at = @Now;
            """,
            new
            {
                UserId = userId,
                GameType = gameType,
                Win = result == "win" ? 1 : 0,
                Loss = result == "loss" ? 1 : 0,
                Draw = result == "draw" ? 1 : 0,
                Abandon = result == "abandoned" ? 1 : 0,
                Now = now,
            }, tx);
    }

    private static async Task UpsertHeadToHeadAsync(System.Data.IDbConnection conn, System.Data.IDbTransaction tx,
        string gameType, CompletedParticipant a, CompletedParticipant b)
    {
        var (low, high) = a.UserId < b.UserId ? (a, b) : (b, a);
        var lowWin = low.Result == "win" ? 1 : 0;
        var highWin = high.Result == "win" ? 1 : 0;
        var draw = low.Result == "draw" ? 1 : 0;
        var now = DateTimeOffset.UtcNow.ToString("o");

        await conn.ExecuteAsync("""
            INSERT INTO game_head_to_head (player_low_id, player_high_id, game_type, low_wins, high_wins, draws, updated_at)
            VALUES (@Low, @High, @GameType, @LowWin, @HighWin, @Draw, @Now)
            ON CONFLICT(player_low_id, player_high_id, game_type) DO UPDATE SET
                low_wins = low_wins + @LowWin,
                high_wins = high_wins + @HighWin,
                draws = draws + @Draw,
                updated_at = @Now;
            """,
            new { Low = low.UserId, High = high.UserId, GameType = gameType, LowWin = lowWin, HighWin = highWin, Draw = draw, Now = now }, tx);
    }

    public async Task<UserGameStats> GetUserStatsAsync(long userId, string gameType)
    {
        using var conn = _db.CreateConnection();
        var row = await conn.QuerySingleOrDefaultAsync<UserGameStats>("""
            SELECT user_id AS UserId, game_type AS GameType, wins AS Wins, losses AS Losses,
                   draws AS Draws, abandons AS Abandons, games_played AS GamesPlayed
            FROM game_user_stats WHERE user_id = @userId AND game_type = @gameType;
            """, new { userId, gameType });
        return row ?? new UserGameStats(userId, gameType, 0, 0, 0, 0, 0);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameRepositoryTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/GameRepository.cs tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs
git commit -m "feat: persist completed matches with aggregate and head-to-head caches"
```

### Task 4: GameStatsService — windowed + head-to-head reads (TDD)

**Files:**
- Create: `src/Brmble.Server/Games/GameStatsService.cs`
- Test: `tests/Brmble.Server.Tests/Games/GameStatsServiceTests.cs`

- [ ] **Step 1: Write the failing test**

```csharp
using Brmble.Server.Data;
using Brmble.Server.Games;
using Xunit;

namespace Brmble.Server.Tests.Games;

public class GameStatsServiceTests
{
    private static Database NewDb()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return db;
    }

    [Fact]
    public async Task WindowedStats_CountsOnlyMatchesInRange()
    {
        var db = NewDb();
        var repo = new GameRepository(db);
        var stats = new GameStatsService(db);
        var now = DateTimeOffset.UtcNow;

        // Old match (40 days ago) — user 10 wins
        await repo.SaveCompletedMatchAsync(new CompletedMatch("deathroll", 1, "1v1", "decided", null,
            now.AddDays(-40), now.AddDays(-40).AddSeconds(10),
            new[] { new CompletedParticipant(10, 1, 3, "win"), new CompletedParticipant(20, 2, 1, "loss") }));

        // Recent match (2 days ago) — user 10 loses
        await repo.SaveCompletedMatchAsync(new CompletedMatch("deathroll", 1, "1v1", "decided", null,
            now.AddDays(-2), now.AddDays(-2).AddSeconds(10),
            new[] { new CompletedParticipant(10, 2, 1, "loss"), new CompletedParticipant(20, 1, 5, "win") }));

        var week = await stats.GetWindowedStatsAsync(10, "deathroll", now.AddDays(-7), now);
        Assert.Equal(0, week.Wins);
        Assert.Equal(1, week.Losses);

        var all = await stats.GetWindowedStatsAsync(10, "deathroll", now.AddDays(-365), now);
        Assert.Equal(1, all.Wins);
        Assert.Equal(1, all.Losses);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameStatsServiceTests`
Expected: FAIL (compile error — `GameStatsService` missing).

- [ ] **Step 3: Implement GameStatsService**

```csharp
using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Games;

public record WindowedStats(int Wins, int Losses, int Draws, int Abandons, int GamesPlayed)
{
    public double WinRatio => GamesPlayed == 0 ? 0 : (double)Wins / GamesPlayed;
}

public class GameStatsService
{
    private readonly Database _db;

    public GameStatsService(Database db) => _db = db;

    public async Task<WindowedStats> GetWindowedStatsAsync(long userId, string gameType, DateTimeOffset from, DateTimeOffset to)
    {
        using var conn = _db.CreateConnection();
        var row = await conn.QuerySingleAsync<(int wins, int losses, int draws, int abandons, int played)>("""
            SELECT
                SUM(CASE WHEN p.result = 'win' THEN 1 ELSE 0 END)       AS wins,
                SUM(CASE WHEN p.result = 'loss' THEN 1 ELSE 0 END)      AS losses,
                SUM(CASE WHEN p.result = 'draw' THEN 1 ELSE 0 END)      AS draws,
                SUM(CASE WHEN p.result = 'abandoned' THEN 1 ELSE 0 END) AS abandons,
                COUNT(*)                                                AS played
            FROM game_match_participants p
            JOIN game_matches m ON m.id = p.match_id
            WHERE p.user_id = @userId
              AND m.game_type = @gameType
              AND m.ended_at >= @from AND m.ended_at <= @to;
            """,
            new { userId, gameType, from = from.ToString("o"), to = to.ToString("o") });

        return new WindowedStats(row.wins, row.losses, row.draws, row.abandons, row.played);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameStatsServiceTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/GameStatsService.cs tests/Brmble.Server.Tests/Games/GameStatsServiceTests.cs
git commit -m "feat: on-demand windowed game stats queries"
```

---

## Phase 2 — RNG + Deathroll Engine (pure rules)

### Task 5: IRandomSource + CryptoRandomSource

**Files:**
- Create: `src/Brmble.Server/Games/IRandomSource.cs`
- Create: `src/Brmble.Server/Games/CryptoRandomSource.cs`

- [ ] **Step 1: Write the interface + impl**

`IRandomSource.cs`:

```csharp
namespace Brmble.Server.Games;

public interface IRandomSource
{
    /// <summary>Uniform integer in [1, maxInclusive].</summary>
    int Roll(int maxInclusive);
}
```

`CryptoRandomSource.cs`:

```csharp
using System.Security.Cryptography;

namespace Brmble.Server.Games;

public sealed class CryptoRandomSource : IRandomSource
{
    public int Roll(int maxInclusive)
    {
        if (maxInclusive < 1) throw new ArgumentOutOfRangeException(nameof(maxInclusive));
        return RandomNumberGenerator.GetInt32(1, maxInclusive + 1);
    }
}
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Games/IRandomSource.cs src/Brmble.Server/Games/CryptoRandomSource.cs
git commit -m "feat: add server-authoritative random source"
```

### Task 6: IGameEngine contract + shared types

**Files:**
- Create: `src/Brmble.Server/Games/IGameEngine.cs`

- [ ] **Step 1: Write the contract**

```csharp
namespace Brmble.Server.Games;

public enum InteractionModel { AlternatingTurns, SimultaneousCommit }

public record GamePlayer(long UserId);

// Result of applying an action: new state is mutated in place on the engine's
// state object; the engine reports what happened for broadcasting.
public record GameEvent(string Kind, IReadOnlyDictionary<string, object> Data);

public abstract record GameOutcome
{
    public sealed record InProgress : GameOutcome;
    // Placements: index 0 = 1st place. Score/metadata parallel arrays keyed by UserId.
    public sealed record Finished(
        IReadOnlyList<CompletedParticipant> Participants) : GameOutcome;
}

public interface IGameEngine
{
    string GameType { get; }
    InteractionModel InteractionModel { get; }

    // Creates the initial opaque state for a match with the given ordered players.
    object InitialState(IReadOnlyList<GamePlayer> players, IRandomSource rng);

    // Returns true if it is this user's turn (alternating games).
    bool IsUsersTurn(object state, long userId);

    // Validates + applies the action; returns emitted events. Throws InvalidGameActionException on illegal move.
    IReadOnlyList<GameEvent> ApplyAction(object state, long userId, IReadOnlyDictionary<string, object?> action, IRandomSource rng);

    // Applies the escalating timeout penalty for the current turn's player; returns emitted events.
    IReadOnlyList<GameEvent> ApplyTimeoutPenalty(object state, IRandomSource rng);

    GameOutcome GetOutcome(object state);

    // Per-player public view (hide opponent secrets). For Deathroll everything is public.
    object PublicView(object state, long forUserId);
}

public sealed class InvalidGameActionException : Exception
{
    public InvalidGameActionException(string message) : base(message) { }
}
```

- [ ] **Step 2: Build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Games/IGameEngine.cs
git commit -m "feat: add game engine abstraction"
```

### Task 7: DeathrollEngine rules (TDD)

**Files:**
- Create: `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`
- Test: `tests/Brmble.Server.Tests/Games/DeathrollEngineTests.cs`

Rules: both players start; player A rolls `1..1000`, next player rolls `1..previous`, etc. First to roll `1` loses (the other wins). Turn timeout penalty reduces the current ceiling by 20% (floor), repeatable; if ceiling reaches 1 the player is forced to roll 1 and loses.

- [ ] **Step 1: Write the failing tests**

```csharp
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Xunit;

namespace Brmble.Server.Tests.Games;

// Deterministic RNG returning queued values (clamped to max).
file sealed class QueueRandom : IRandomSource
{
    private readonly Queue<int> _values;
    public QueueRandom(params int[] values) => _values = new Queue<int>(values);
    public int Roll(int maxInclusive) => Math.Min(_values.Dequeue(), maxInclusive);
}

public class DeathrollEngineTests
{
    private static readonly IReadOnlyList<GamePlayer> Players = new[] { new GamePlayer(10), new GamePlayer(20) };

    [Fact]
    public void FirstPlayerRollsUnderThousandFirst()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(500);
        var state = engine.InitialState(Players, rng);

        Assert.True(engine.IsUsersTurn(state, 10));
        Assert.False(engine.IsUsersTurn(state, 20));

        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);
        Assert.True(engine.IsUsersTurn(state, 20)); // turn passes
        Assert.IsType<GameOutcome.InProgress>(engine.GetOutcome(state));
    }

    [Fact]
    public void RollingOneLosesAndOpponentWins()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(1); // player 10 rolls a 1 immediately
        var state = engine.InitialState(Players, rng);

        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);

        var outcome = Assert.IsType<GameOutcome.Finished>(engine.GetOutcome(state));
        var winner = outcome.Participants.Single(p => p.Result == "win");
        var loser = outcome.Participants.Single(p => p.Result == "loss");
        Assert.Equal(20, winner.UserId);
        Assert.Equal(1, winner.Placement);
        Assert.Equal(10, loser.UserId);
        Assert.Equal(1, loser.Score); // last roll was 1
    }

    [Fact]
    public void RollingOutOfTurnThrows()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(500);
        var state = engine.InitialState(Players, rng);

        Assert.Throws<InvalidGameActionException>(() =>
            engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, rng));
    }

    [Fact]
    public void TimeoutPenaltyLowersCeilingByTwentyPercent()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(500, 400);
        var state = engine.InitialState(Players, rng); // ceiling 1000, player 10's turn
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng); // rolled 500, now player 20 under 500

        // player 20 stalls: ceiling 500 -> 400
        var events = engine.ApplyTimeoutPenalty(state, rng);
        Assert.Contains(events, e => e.Kind == "penalty");
        // next roll (400) must be under the reduced ceiling
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, rng);
        Assert.IsType<GameOutcome.InProgress>(engine.GetOutcome(state));
    }

    [Fact]
    public void TimeoutPenaltyToOneForcesLoss()
    {
        var engine = new DeathrollEngine();
        var rng = new QueueRandom(2); // player 10 rolls 2, ceiling for player 20 becomes 2
        var state = engine.InitialState(Players, rng);
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, rng);

        // ceiling 2 -> floor(2*0.8)=1 => forced loss for player 20
        engine.ApplyTimeoutPenalty(state, rng);
        var outcome = Assert.IsType<GameOutcome.Finished>(engine.GetOutcome(state));
        Assert.Equal(10, outcome.Participants.Single(p => p.Result == "win").UserId);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter DeathrollEngineTests`
Expected: FAIL (compile error — `DeathrollEngine` missing).

- [ ] **Step 3: Implement DeathrollEngine**

```csharp
namespace Brmble.Server.Games.Engines;

public sealed class DeathrollEngine : IGameEngine
{
    private const int StartCeiling = 1000;
    private const double PenaltyFactor = 0.8; // -20% per timeout step

    public string GameType => "deathroll";
    public InteractionModel InteractionModel => InteractionModel.AlternatingTurns;

    private sealed class State
    {
        public required long[] Players;   // ordered; index toggles
        public int CurrentIndex;          // whose turn
        public int Ceiling = StartCeiling; // roll under/equal this
        public int? LastRoll;
        public long? LoserId;
    }

    public object InitialState(IReadOnlyList<GamePlayer> players, IRandomSource rng)
    {
        if (players.Count != 2) throw new InvalidGameActionException("Deathroll requires exactly 2 players.");
        return new State { Players = new[] { players[0].UserId, players[1].UserId } };
    }

    public bool IsUsersTurn(object state, long userId)
    {
        var s = (State)state;
        return s.LoserId is null && s.Players[s.CurrentIndex] == userId;
    }

    public IReadOnlyList<GameEvent> ApplyAction(object state, long userId, IReadOnlyDictionary<string, object?> action, IRandomSource rng)
    {
        var s = (State)state;
        if (s.LoserId is not null) throw new InvalidGameActionException("Game already finished.");
        if (s.Players[s.CurrentIndex] != userId) throw new InvalidGameActionException("Not your turn.");
        if (!action.TryGetValue("roll", out var roll) || roll is not true)
            throw new InvalidGameActionException("Unknown action.");

        return DoRoll(s, userId);
    }

    public IReadOnlyList<GameEvent> ApplyTimeoutPenalty(object state, IRandomSource rng)
    {
        var s = (State)state;
        if (s.LoserId is not null) return Array.Empty<GameEvent>();

        var reduced = (int)Math.Floor(s.Ceiling * PenaltyFactor);
        if (reduced < 1)
        {
            // forced loss for current player
            s.LastRoll = 1;
            s.LoserId = s.Players[s.CurrentIndex];
            return new[] { Event("penalty", ("ceiling", 1)), Event("forcedLoss", ("userId", s.LoserId!)) };
        }

        s.Ceiling = reduced;
        return new[] { Event("penalty", ("userId", s.Players[s.CurrentIndex]), ("ceiling", s.Ceiling)) };
    }

    private IReadOnlyList<GameEvent> DoRoll(State s, long userId)
    {
        var value = rngGuard(s, userId);
        s.LastRoll = value;
        var events = new List<GameEvent> { Event("roll", ("userId", userId), ("value", value), ("ceiling", s.Ceiling)) };

        if (value <= 1)
        {
            s.LoserId = userId;
            events.Add(Event("loss", ("userId", userId)));
        }
        else
        {
            s.Ceiling = value;
            s.CurrentIndex ^= 1; // toggle 0<->1
        }
        return events;
    }

    // Local helper so DoRoll can access rng captured per-call.
    private IRandomSource? _rng;
    private int rngGuard(State s, long userId)
    {
        // rng is set by ApplyAction/ApplyTimeoutPenalty callers via field injection below
        return _rng!.Roll(s.Ceiling);
    }

    // NOTE: engines are singletons but stateless except via `state`. To keep rng
    // threading simple, ApplyAction sets _rng for the duration of the call.
    // (Overrides above call DoRoll after setting _rng.)

    public GameOutcome GetOutcome(object state)
    {
        var s = (State)state;
        if (s.LoserId is null) return new GameOutcome.InProgress();

        var loserId = s.LoserId.Value;
        var winnerId = s.Players[0] == loserId ? s.Players[1] : s.Players[0];
        return new GameOutcome.Finished(new[]
        {
            new CompletedParticipant(winnerId, Placement: 1, Score: null, Result: "win"),
            new CompletedParticipant(loserId, Placement: 2, Score: s.LastRoll, Result: "loss"),
        });
    }

    public object PublicView(object state, long forUserId)
    {
        var s = (State)state;
        return new
        {
            players = s.Players,
            currentPlayer = s.LoserId is null ? s.Players[s.CurrentIndex] : (long?)null,
            ceiling = s.Ceiling,
            lastRoll = s.LastRoll,
            finished = s.LoserId is not null,
            loserId = s.LoserId,
        };
    }

    private static GameEvent Event(string kind, params (string, object)[] data)
        => new(kind, data.ToDictionary(d => d.Item1, d => d.Item2));
}
```

> **Implementer note:** The `_rng` field trick above is a smell. Prefer refactoring `DoRoll` to take `IRandomSource rng` as a parameter and have `ApplyAction`/`ApplyTimeoutPenalty` pass it directly (remove `_rng`/`rngGuard`). Do this refactor as part of Step 3 so the engine stays thread-safe and stateless; the tests already pass `rng` in.

- [ ] **Step 4: Refactor rng threading, then run tests**

Refactor `DoRoll(State s, long userId, IRandomSource rng)` and delete `_rng`/`rngGuard`. Then:

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter DeathrollEngineTests`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/Engines/DeathrollEngine.cs tests/Brmble.Server.Tests/Games/DeathrollEngineTests.cs
git commit -m "feat: implement deathroll engine rules and timeout penalty"
```

---

## Phase 3 — Session Manager, Endpoints, WebSocket Events

### Task 8: GameSessionManager lifecycle (TDD)

**Files:**
- Create: `src/Brmble.Server/Games/GameSessionManager.cs`
- Test: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`

Responsibilities: create invite (validate both Brmble + same channel via `ISessionMappingService` + `IChannelMembershipService`), accept/decline, one active match per user, apply actions via engine, run turn timers, persist via `GameRepository`, announce via an injected `IGameAnnouncer`, broadcast events via an injected `IGameEventPublisher`.

- [ ] **Step 1: Define collaborator interfaces (in the same file)**

```csharp
namespace Brmble.Server.Games;

public interface IGameEventPublisher
{
    Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message);
    Task PublishToChannelAsync(int channelId, object message);
}

public interface IGameAnnouncer
{
    Task AnnounceResultAsync(int channelId, string text);
}

public interface IGamePresence
{
    // Returns (channelId, isBrmble) if the user has a live Brmble session.
    bool TryGetChannel(long userId, out int channelId, out bool isBrmble);
}
```

- [ ] **Step 2: Write the failing test**

```csharp
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Xunit;

namespace Brmble.Server.Tests.Games;

file sealed class FakePresence : IGamePresence
{
    public Dictionary<long, (int ch, bool brmble)> Users = new();
    public bool TryGetChannel(long userId, out int channelId, out bool isBrmble)
    {
        if (Users.TryGetValue(userId, out var v)) { channelId = v.ch; isBrmble = v.brmble; return true; }
        channelId = 0; isBrmble = false; return false;
    }
}
file sealed class FakePublisher : IGameEventPublisher
{
    public List<(string kind, object msg)> Sent = new();
    public Task PublishToUsersAsync(IReadOnlySet<long> u, object m) { Sent.Add(("users", m)); return Task.CompletedTask; }
    public Task PublishToChannelAsync(int c, object m) { Sent.Add(("channel", m)); return Task.CompletedTask; }
}
file sealed class FakeAnnouncer : IGameAnnouncer
{
    public List<string> Announcements = new();
    public Task AnnounceResultAsync(int c, string t) { Announcements.Add(t); return Task.CompletedTask; }
}

public class GameSessionManagerTests
{
    private static GameSessionManager NewManager(FakePresence presence, out FakePublisher pub, out FakeAnnouncer ann, GameRepository repo)
    {
        pub = new FakePublisher();
        ann = new FakeAnnouncer();
        var engines = new IGameEngine[] { new DeathrollEngine() };
        return new GameSessionManager(engines, new CryptoRandomSource(), presence, pub, ann, repo);
    }

    [Fact]
    public async Task Invite_RejectsWhenTargetNotInSameChannel()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true);
        presence.Users[20] = (2, true); // different channel
        var repo = GameTestHelpers.NewRepo();
        var mgr = NewManager(presence, out _, out _, repo);

        var result = await mgr.InviteAsync(inviterUserId: 10, targetUserId: 20, gameType: "deathroll");
        Assert.False(result.Success);
        Assert.Contains("channel", result.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Invite_RejectsNonBrmbleTarget()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true);
        presence.Users[20] = (1, false);
        var mgr = NewManager(presence, out _, out _, GameTestHelpers.NewRepo());

        var result = await mgr.InviteAsync(10, 20, "deathroll");
        Assert.False(result.Success);
    }

    [Fact]
    public async Task AcceptedMatch_PlaysToCompletion_PersistsAndAnnounces()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true);
        presence.Users[20] = (1, true);
        var repo = GameTestHelpers.NewRepo();
        var mgr = NewManager(presence, out var pub, out var ann, repo);

        var invite = await mgr.InviteAsync(10, 20, "deathroll");
        Assert.True(invite.Success);
        await mgr.RespondAsync(invite.MatchId, targetUserId: 20, accept: true);

        // Roll until someone hits 1 (crypto rng; loop bounded).
        for (var i = 0; i < 100000 && mgr.IsMatchLive(invite.MatchId); i++)
        {
            var current = mgr.GetCurrentPlayer(invite.MatchId);
            await mgr.ActionAsync(invite.MatchId, current, new Dictionary<string, object?> { ["roll"] = true });
        }

        Assert.False(mgr.IsMatchLive(invite.MatchId));
        Assert.Single(ann.Announcements);

        var s10 = await repo.GetUserStatsAsync(10, "deathroll");
        var s20 = await repo.GetUserStatsAsync(20, "deathroll");
        Assert.Equal(1, s10.GamesPlayed);
        Assert.Equal(1, s20.GamesPlayed);
        Assert.Equal(1, s10.Wins + s20.Wins); // exactly one winner
    }
}
```

Add helper `tests/Brmble.Server.Tests/Games/GameTestHelpers.cs`:

```csharp
using Brmble.Server.Data;
using Brmble.Server.Games;

namespace Brmble.Server.Tests.Games;

internal static class GameTestHelpers
{
    public static GameRepository NewRepo()
    {
        var path = Path.Combine(Path.GetTempPath(), $"brmble-test-{Guid.NewGuid():N}.db");
        var db = new Database($"Data Source={path}");
        db.Initialize();
        return new GameRepository(db);
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameSessionManagerTests`
Expected: FAIL (compile error — `GameSessionManager` missing).

- [ ] **Step 4: Implement GameSessionManager**

Implement a class with a `ConcurrentDictionary<long, LiveMatch>` keyed by matchId (use an incrementing counter for pre-persist match ids, separate from DB ids), plus a `ConcurrentDictionary<long, long>` mapping userId → active matchId to enforce one-match-per-user. Public API used by tests + endpoints:

```csharp
public record InviteResult(bool Success, long MatchId, string? Error);

public sealed class GameSessionManager
{
    public GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGamePresence presence,
        IGameEventPublisher publisher,
        IGameAnnouncer announcer,
        GameRepository repository) { /* store, index engines by GameType */ }

    public Task<InviteResult> InviteAsync(long inviterUserId, long targetUserId, string gameType);
    public Task RespondAsync(long matchId, long targetUserId, bool accept);
    public Task ActionAsync(long matchId, long userId, IReadOnlyDictionary<string, object?> action);
    public Task ForfeitAsync(long matchId, long userId, string reason); // "forfeit" | "disconnect" | "left_channel"

    public bool IsMatchLive(long matchId);
    public long GetCurrentPlayer(long matchId);
}
```

Key behaviors to implement (all validated in tests + endpoints):
- `InviteAsync`: reject self-invite; both users must resolve via `IGamePresence` with `isBrmble == true` and the **same** `channelId`; neither already in an active match; unknown `gameType` rejected. Create a `pending` LiveMatch, publish `game.invited` to the target, start a 30s invite-expiry timer.
- `RespondAsync`: on decline/timeout publish `game.declined` and drop the match. On accept, build engine state via `engine.InitialState`, publish `game.started` with `firstTurn` + per-player `PublicView`, start the turn timer (15s).
- `ActionAsync`: forward to `engine.ApplyAction`; on `InvalidGameActionException` publish `game.actionRejected` to the caller only; otherwise publish `game.stateUpdated` (per-player views + emitted events) and, if `GetOutcome` is `Finished`, call `CompleteMatchAsync`. Reset the turn timer after a legal roll.
- Turn timer fires → `engine.ApplyTimeoutPenalty`; publish `game.stateUpdated`; if that produced a `Finished` outcome, complete; else restart a 5s penalty timer.
- `CompleteMatchAsync`: build `CompletedMatch` from the outcome (+ `channelId`, timestamps), `await repository.SaveCompletedMatchAsync`, publish `game.ended`, call `announcer.AnnounceResultAsync`, and clear the userId→match index for both players.
- `ForfeitAsync`: build a `CompletedMatch` with `Outcome = "abandoned"`, `AbandonReason = reason`; abandoning player `result = "abandoned"`, other player `result = "win"`, placements 2/1; persist + announce + publish `game.ended`.

Use `System.Threading.Timer` for invite/turn timers stored on the LiveMatch; dispose them on completion.

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameSessionManagerTests`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/GameSessionManager.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs tests/Brmble.Server.Tests/Games/GameTestHelpers.cs
git commit -m "feat: game session manager with invite/turn lifecycle and timeouts"
```

### Task 9: Wire IGamePresence, publisher, announcer to real services

**Files:**
- Create: `src/Brmble.Server/Games/SessionMappingGamePresence.cs`
- Create: `src/Brmble.Server/Games/EventBusGameEventPublisher.cs`
- Create: `src/Brmble.Server/Games/MatrixGameAnnouncer.cs`

- [ ] **Step 1: Implement adapters**

`SessionMappingGamePresence` wraps `ISessionMappingService` + `IChannelMembershipService`:

```csharp
using Brmble.Server.Events;

namespace Brmble.Server.Games;

public sealed class SessionMappingGamePresence : IGamePresence
{
    private readonly ISessionMappingService _sessions;
    private readonly IChannelMembershipService _membership;

    public SessionMappingGamePresence(ISessionMappingService sessions, IChannelMembershipService membership)
    {
        _sessions = sessions;
        _membership = membership;
    }

    public bool TryGetChannel(long userId, out int channelId, out bool isBrmble)
    {
        channelId = 0; isBrmble = false;
        if (!_sessions.TryGetMappingByUserId(userId, out var sessionId, out var mapping) || mapping is null)
            return false;
        isBrmble = mapping.IsBrmbleClient;
        return _membership.TryGetChannelForSession(sessionId, out channelId);
    }
}
```

> **Implementer note:** Confirm `IChannelMembershipService` exposes a session→channel lookup. If it only exposes `GetSessionsInChannel`, add a `TryGetChannelForSession(int sessionId, out int channelId)` method to that service (and its interface) in this step, following the existing membership tracking. Check `src/Brmble.Server/Events/` for the concrete implementation.

`EventBusGameEventPublisher` wraps `IBrmbleEventBus`:

```csharp
using Brmble.Server.Events;

namespace Brmble.Server.Games;

public sealed class EventBusGameEventPublisher : IGameEventPublisher
{
    private readonly IBrmbleEventBus _bus;
    public EventBusGameEventPublisher(IBrmbleEventBus bus) => _bus = bus;

    public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message) => _bus.BroadcastToUsersAsync(userIds, message);
    public Task PublishToChannelAsync(int channelId, object message) => _bus.BroadcastToChannelAsync(channelId, message);
}
```

`MatrixGameAnnouncer` posts a system message to the channel's Matrix room via the existing `MatrixService`:

```csharp
using Brmble.Server.Matrix;

namespace Brmble.Server.Games;

public sealed class MatrixGameAnnouncer : IGameAnnouncer
{
    private readonly MatrixService _matrix;
    public MatrixGameAnnouncer(MatrixService matrix) => _matrix = matrix;

    public Task AnnounceResultAsync(int channelId, string text) => _matrix.SendChannelSystemMessageAsync(channelId, text);
}
```

> **Implementer note:** Inspect `MatrixService` for the exact method to post a system message into a channel's room by Mumble channel id. If none exists, add a thin `SendChannelSystemMessageAsync(int channelId, string text)` that resolves the room via `ChannelRepository` and calls `MatrixAppService.SendMessage`. Follow the existing relay code in `Matrix/MatrixService.cs`.

- [ ] **Step 2: Build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Server/Games/SessionMappingGamePresence.cs src/Brmble.Server/Games/EventBusGameEventPublisher.cs src/Brmble.Server/Games/MatrixGameAnnouncer.cs
git commit -m "feat: adapt game session manager to session mapping, event bus, and matrix"
```

### Task 10: REST endpoints + DI registration

**Files:**
- Create: `src/Brmble.Server/Games/GameEndpoints.cs`
- Create: `src/Brmble.Server/Games/GamesExtensions.cs`
- Modify: `src/Brmble.Server/Program.cs` (add `builder.Services.AddGames();` near other `Add*` calls, and `app.MapGameEndpoints();` near other endpoint maps)

- [ ] **Step 1: Implement GamesExtensions (DI)**

```csharp
using Brmble.Server.Games.Engines;

namespace Brmble.Server.Games;

public static class GamesExtensions
{
    public static IServiceCollection AddGames(this IServiceCollection services)
    {
        services.AddSingleton<IRandomSource, CryptoRandomSource>();
        services.AddSingleton<IGameEngine, DeathrollEngine>();
        services.AddSingleton<GameRepository>();
        services.AddSingleton<GameStatsService>();
        services.AddSingleton<IGamePresence, SessionMappingGamePresence>();
        services.AddSingleton<IGameEventPublisher, EventBusGameEventPublisher>();
        services.AddSingleton<IGameAnnouncer, MatrixGameAnnouncer>();
        services.AddSingleton<GameSessionManager>();
        return services;
    }
}
```

- [ ] **Step 2: Implement endpoints**

Follow the `ChannelRequestEndpoints` pattern (resolve user from client cert via `ICertificateHashExtractor` + `UserRepository`; return `Results.Unauthorized()` if null).

```csharp
using Brmble.Server.Auth;

namespace Brmble.Server.Games;

public static class GameEndpoints
{
    public record InviteDto(long TargetUserId, string GameType);
    public record RespondDto(long MatchId, bool Accept);
    public record ActionDto(long MatchId, Dictionary<string, object?> Action);
    public record ForfeitDto(long MatchId);

    public static IEndpointRouteBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/games/invite", async (InviteDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            var r = await mgr.InviteAsync(user.UserId, dto.TargetUserId, dto.GameType);
            return r.Success ? Results.Ok(new { matchId = r.MatchId }) : Results.BadRequest(new { error = r.Error });
        });

        app.MapPost("/games/respond", async (RespondDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await mgr.RespondAsync(dto.MatchId, user.UserId, dto.Accept);
            return Results.Ok();
        });

        app.MapPost("/games/action", async (ActionDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await mgr.ActionAsync(dto.MatchId, user.UserId, dto.Action);
            return Results.Ok();
        });

        app.MapPost("/games/forfeit", async (ForfeitDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            await mgr.ForfeitAsync(dto.MatchId, user.UserId, "forfeit");
            return Results.Ok();
        });

        app.MapGet("/games/stats/{gameType}", async (string gameType, string? window, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameStatsService stats) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            var (from, to) = ResolveWindow(window);
            var s = await stats.GetWindowedStatsAsync(user.UserId, gameType, from, to);
            return Results.Ok(s);
        });

        return app;
    }

    private static (DateTimeOffset from, DateTimeOffset to) ResolveWindow(string? window)
    {
        var now = DateTimeOffset.UtcNow;
        return window switch
        {
            "week" => (now.AddDays(-7), now),
            "month" => (now.AddMonths(-1), now),
            _ => (DateTimeOffset.UnixEpoch, now),
        };
    }

    // Copy ResolveUserAsync from ChannelRequestEndpoints (same signature/logic).
    private static async Task<AuthenticatedUser?> ResolveUserAsync(
        HttpContext ctx, ICertificateHashExtractor certs, UserRepository users)
    {
        // Mirror ChannelRequestEndpoints.ResolveUserAsync exactly.
        throw new NotImplementedException("Copy from ChannelRequestEndpoints.ResolveUserAsync");
    }
}
```

> **Implementer note:** Open `ChannelRequestEndpoints.cs` and copy its private `ResolveUserAsync` (and the `AuthenticatedUser`/user type it returns — the report shows `user.UserId`) verbatim into `GameEndpoints`, replacing the `NotImplementedException` stub. Match the real return type used there.

- [ ] **Step 3: Register in Program.cs**

Add `builder.Services.AddGames();` alongside the other `Add*` service registrations, and `app.MapGameEndpoints();` alongside the other `Map*Endpoints()` calls.

- [ ] **Step 4: Build + run existing test suite**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Then: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: Build succeeded; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/Games/GamesExtensions.cs src/Brmble.Server/Program.cs
git commit -m "feat: expose game REST endpoints and register game services"
```

### Task 11: Forfeit on disconnect / channel leave

**Files:**
- Modify: the server component that already reacts to Brmble client disconnect / channel change (find via the existing `brmbleClientDeactivated` / user-left handling in `Auth/AuthService.cs` + session mapping handlers)

- [ ] **Step 1: Hook disconnect → forfeit**

When a user's Brmble session ends or they leave their voice channel, call `GameSessionManager.ForfeitAsync(activeMatchId, userId, reason)` with reason `"disconnect"` or `"left_channel"`. Add a `GameSessionManager.TryGetActiveMatch(long userId, out long matchId)` helper for this. Wire it into the existing deactivation path so no new event source is introduced.

- [ ] **Step 2: Build + test**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj; dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: Build + tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A src/Brmble.Server
git commit -m "feat: forfeit active game on disconnect or channel leave"
```

---

## Phase 4 — Client Bridge Service

### Task 12: Client GameService

**Files:**
- Create: `src/Brmble.Client/Services/Games/GameService.cs`
- Modify: `src/Brmble.Client/Program.cs` (instantiate + `Initialize`/`RegisterHandlers`, following the existing service wiring)
- Modify: the client `/ws` message pump (where `voice.sessionMappingSnapshot` etc. are re-emitted) to forward `game.*` server events to the bridge

- [ ] **Step 1: Implement GameService**

Mirror `ChannelRequestBridgeHandler`: register bridge handlers for `game.invite`, `game.respond`, `game.action`, `game.forfeit`, each serializing the payload and POSTing to the matching `/games/*` endpoint over mTLS using the client certificate (reuse the same `postJsonAsync` helper/injection used by channel requests). `ServiceName => "games"`.

```csharp
using System.Text.Json;
using Brmble.Client.Bridge;

namespace Brmble.Client.Services.Games;

internal sealed class GameService : IService
{
    public string ServiceName => "games";
    // Constructor takes the same mTLS POST helper + cert service + getApiUrl used by ChannelRequestBridgeHandler.

    public void Initialize(NativeBridge bridge) { /* store bridge */ }

    public void RegisterHandlers(NativeBridge bridge)
    {
        bridge.RegisterHandler("game.invite", d => PostAsync("games/invite", d));
        bridge.RegisterHandler("game.respond", d => PostAsync("games/respond", d));
        bridge.RegisterHandler("game.action", d => PostAsync("games/action", d));
        bridge.RegisterHandler("game.forfeit", d => PostAsync("games/forfeit", d));
    }

    private Task PostAsync(string path, JsonElement data) { /* mTLS POST; on failure Send("game.error", ...) */ return Task.CompletedTask; }
}
```

- [ ] **Step 2: Forward `/ws` game events to the bridge**

In the client's existing `/ws` receive loop, detect message `type` values beginning with `game.` (e.g. `game.invited`, `game.started`, `game.stateUpdated`, `game.ended`, `game.declined`, `game.actionRejected`, `game.error`) and re-emit them over the bridge with `bridge.Send(type, data); bridge.NotifyUiThread();`.

- [ ] **Step 3: Register in Program.cs**

Instantiate `GameService`, call `Initialize(_bridge)` + `RegisterHandlers(_bridge)` alongside the other services.

- [ ] **Step 4: Build the client**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Games/GameService.cs src/Brmble.Client/Program.cs
git commit -m "feat: client game bridge service forwarding intents and ws events"
```

---

## Phase 5 — Web UI + Stats

> **Before any UI work:** Read `docs/UI_GUIDE.md` (esp. the AI Agent UI Gate). Use existing design tokens/theme variables only — no hardcoded colors/spacing/radii. Use the existing `<Notification>` + `useNotificationQueue` for the invite prompt; do NOT create a toast system. If a needed pattern is missing from the guide, update the guide in this branch.

### Task 13: Web game API client

**Files:**
- Create: `src/Brmble.Web/src/api/games.ts`

- [ ] **Step 1: Implement bridge-tunneled API**

Mirror `src/Brmble.Web/src/api/channelRequests.ts`: if `isWebViewBridgeAvailable()`, send `game.*` via the bridge and (for stats) await a response; otherwise `fetch('/games/...')`. Export `invite(targetUserId, gameType)`, `respond(matchId, accept)`, `sendAction(matchId, action)`, `forfeit(matchId)`, `getStats(gameType, window)`.

- [ ] **Step 2: Type-check**

Run: `cd src/Brmble.Web; npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/api/games.ts
git commit -m "feat: web game api client"
```

### Task 14: useGameState hook + Deathroll modal

**Files:**
- Create: `src/Brmble.Web/src/components/Games/useGameState.ts`
- Create: `src/Brmble.Web/src/components/Games/DeathrollModal.tsx`
- Create: `src/Brmble.Web/src/components/Games/DeathrollModal.module.css`
- Modify: `src/Brmble.Web/src/App.tsx` (register `game.*` bridge listeners, render invite `<Notification>` + `<DeathrollModal>` when a match is active)

- [ ] **Step 1: Implement useGameState**

Subscribe (via the bridge `on`) to `game.invited`, `game.started`, `game.stateUpdated`, `game.ended`, `game.declined`, `game.actionRejected`, `game.error`. Expose `{ incomingInvite, activeMatch, view, ended }` and actions `invite/respond/roll/forfeit` calling `api/games.ts`. Track the countdown from the server-provided `ceiling`/turn timing in `game.started`/`game.stateUpdated`.

- [ ] **Step 2: Implement DeathrollModal**

Uses the existing modal pattern from `docs/UI_GUIDE.md`. Shows both players, current ceiling, last roll, whose turn, a visible 15s countdown that shrinks the ceiling on penalty, a Roll button (enabled only on your turn), and a Forfeit button. On `game.ended`, show the result and a close button. All styling via tokens in the `.module.css`.

- [ ] **Step 3: Wire invite entry + prompt in App.tsx**

Add a "Challenge to Deathroll" action to the existing user row/tooltip (only when the target `isBrmbleClient` and shares your channel — data already in `User`/session mappings). Show incoming invites via `useNotificationQueue` with Accept/Decline. Render `<DeathrollModal>` when `activeMatch` is set.

- [ ] **Step 4: Build**

Run: `cd src/Brmble.Web; npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games src/Brmble.Web/src/App.tsx
git commit -m "feat: deathroll web UI with invite flow and countdown"
```

### Task 15: Profile stats view

**Files:**
- Create: `src/Brmble.Web/src/components/Profile/GameStats.tsx`
- Modify: the existing profile/user-info surface to include `<GameStats>` (follow `docs/UI_GUIDE.md`)

- [ ] **Step 1: Implement GameStats**

Calls `getStats('deathroll', window)` for `week` / `month` / `all` (a small token-styled toggle) and renders wins/losses/draws/abandons + win ratio. No new toast/UI primitives.

- [ ] **Step 2: Build**

Run: `cd src/Brmble.Web; npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Profile/GameStats.tsx
git commit -m "feat: per-user deathroll stats view with time windows"
```

---

## Phase 6 — Full-stack verification

### Task 16: End-to-end manual verification + full build/test

- [ ] **Step 1: Full build + test**

Run:
```bash
dotnet build
dotnet test
cd src/Brmble.Web; npm run build
```
Expected: all succeed.

- [ ] **Step 2: Manual two-client smoke test**

Per `CLAUDE.md`, run two debug clients (`dotnet run --project src/Brmble.Client` twice). With both in the same voice channel: challenge → accept → roll to completion; verify the Matrix system message appears for spectators, `game.ended` shows a winner, and stats increment. Then test decline, forfeit, disconnect-mid-match (close one client), and turn-timeout penalty (don't roll for 15s+).

- [ ] **Step 3: Commit any fixes, then stop for review**

```bash
git add -A
git commit -m "fix: address issues found during deathroll e2e verification"
```

Do not push or open a PR — per `CLAUDE.md`, ask the user first.

---

## Self-Review Notes (for the plan author)

- **Spec coverage:** schema (T1–2), repo+aggregates (T3), windowed stats (T4), RNG (T5), engine+penalty (T6–7), session lifecycle/enforcement/timeouts (T8–9), endpoints+DI (T10), disconnect forfeit (T11), client bridge (T12), web UI+invite+countdown (T13–14), profile stats (T15), verification (T16). RPS is intentionally deferred to a follow-up plan (noted in Scope).
- **Known implementer follow-ups flagged inline:** copy `ResolveUserAsync` + user type from `ChannelRequestEndpoints`; confirm/add `IChannelMembershipService.TryGetChannelForSession`; confirm/add `MatrixService.SendChannelSystemMessageAsync`; remove the `_rng` field smell in the engine. These require reading real signatures at implementation time.
- **Type consistency:** `CompletedMatch`/`CompletedParticipant` used identically across repo, engine outcome, and session manager. Bridge/event `game.*` names consistent across server publish, client forward, and web listeners.
