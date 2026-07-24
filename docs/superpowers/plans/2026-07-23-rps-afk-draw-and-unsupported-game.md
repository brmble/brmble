# RPS AFK Draw + Unsupported-Game Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End RPS matches as a real draw after two consecutive both-idle rounds, and make clients auto-decline invites for game types they don't support.

**Architecture:** Server-authoritative RPS engine gains a consecutive-double-timeout counter that flips a match-level `Drawn` flag; `CompleteMatchAsync` derives `Outcome`/`winner` from participant results so draws persist through the existing pipeline and emit `game.ended { draw: true }`. The web client renders a draw end-state and auto-declines unknown game types in `handleInvited`.

**Tech Stack:** C# / ASP.NET Core (MSTest), React + TypeScript (Vite).

Spec: `docs/superpowers/specs/2026-07-23-rps-afk-draw-and-unsupported-game-design.md`

---

## File Structure

- `src/Brmble.Server/Games/Engines/RpsEngine.cs` — add `ConsecutiveDoubleTimeouts` + `Drawn` state, draw outcome, draw feed line.
- `src/Brmble.Server/Games/GameSessionManager.cs` — derive draw `Outcome`/`winner` in `CompleteMatchAsync`; add `draw` to `game.ended`; add internal test hook to fire a turn timeout.
- `tests/Brmble.Server.Tests/Games/RpsEngineTests.cs` — engine-level draw + streak-reset tests.
- `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs` — manager-level draw persistence + `game.ended` draw flag.
- `src/Brmble.Web/src/components/Games/useGameState.ts` — `EndedMatch.draw`, `handleEnded` reads `draw`, `handleInvited` auto-declines unknown games, `SUPPORTED_GAMES` const.
- `src/Brmble.Web/src/components/Games/RpsModal.tsx` — draw branch in `renderResult`.

---

## Task 1: RPS engine — draw state fields

**Files:**
- Modify: `src/Brmble.Server/Games/Engines/RpsEngine.cs`

- [ ] **Step 1: Add state fields**

In the `private sealed class State` block (after `public long? WinnerId;`), add:

```csharp
        public long? WinnerId;
        public int ConsecutiveDoubleTimeouts;   // back-to-back rounds where both idle
        public bool Drawn;                        // match ended in a mutual-AFK draw
```

- [ ] **Step 2: Update `ResolveRound` to track the streak and flip Drawn**

Replace the both-idle branch and add a reset in the decisive/other branches. Change the branch cascade in `ResolveRound`:

```csharp
        if (p0 is null && p1 is null)
        {
            // Both idle on timeout: draw, replay the same round number. After two
            // consecutive idle rounds, end the whole match as a draw (anti-grief).
            roundWinner = null;
            tie = true;
            s.ConsecutiveDoubleTimeouts++;
            if (s.ConsecutiveDoubleTimeouts >= 2) s.Drawn = true;
        }
        else if (p0 is null)
        {
            roundWinner = s.Players[1];
            tie = false;
            s.ConsecutiveDoubleTimeouts = 0;
        }
        else if (p1 is null)
        {
            roundWinner = s.Players[0];
            tie = false;
            s.ConsecutiveDoubleTimeouts = 0;
        }
        else if (p0 == p1)
        {
            roundWinner = null;
            tie = true;
            s.ConsecutiveDoubleTimeouts = 0;
        }
        else
        {
            var zeroBeatsOne = Beats(p0.Value, p1.Value);
            roundWinner = zeroBeatsOne ? s.Players[0] : s.Players[1];
            tie = false;
            s.ConsecutiveDoubleTimeouts = 0;
        }
```

- [ ] **Step 3: Update `GetOutcome` to return a draw**

Replace the body of `GetOutcome`:

```csharp
    public GameOutcome GetOutcome(object state)
    {
        var s = (State)state;
        if (s.Drawn)
        {
            return new GameOutcome.Finished(new[]
            {
                new CompletedParticipant(s.Players[0], Placement: 1, Score: s.RoundWins[0], Result: "draw"),
                new CompletedParticipant(s.Players[1], Placement: 1, Score: s.RoundWins[1], Result: "draw"),
            });
        }
        if (s.WinnerId is null) return new GameOutcome.InProgress();
        var winnerId = s.WinnerId.Value;
        var loserId = s.Players[0] == winnerId ? s.Players[1] : s.Players[0];
        var wIdx = IndexOf(s, winnerId);
        var lIdx = IndexOf(s, loserId);
        return new GameOutcome.Finished(new[]
        {
            new CompletedParticipant(winnerId, Placement: 1, Score: s.RoundWins[wIdx], Result: "win"),
            new CompletedParticipant(loserId, Placement: 2, Score: s.RoundWins[lIdx], Result: "loss"),
        });
    }
```

- [ ] **Step 4: Add a draw branch to `EndFeedLine`**

Replace `EndFeedLine`:

```csharp
    public string? EndFeedLine(object state, Func<long, string> nameOf)
    {
        var s = (State)state;
        if (s.Drawn)
            return $"✊✋✌️ {nameOf(s.Players[0])} vs {nameOf(s.Players[1])} — Rock Paper Scissors ended in a draw (both idle)";
        if (s.WinnerId is null) return null;
        var winner = s.WinnerId.Value;
        var wIdx = IndexOf(s, winner);
        return $"🏆 {nameOf(winner)} wins Rock Paper Scissors {s.RoundWins[wIdx]}–{s.RoundWins[wIdx ^ 1]}!";
    }
```

- [ ] **Step 5: Build to confirm it compiles**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/Engines/RpsEngine.cs
git commit -m "feat: RPS draws after two consecutive both-idle rounds"
```

---

## Task 2: RPS engine draw tests

**Files:**
- Modify: `tests/Brmble.Server.Tests/Games/RpsEngineTests.cs`

- [ ] **Step 1: Add the failing tests**

Add these three methods before the private helpers at the end of the class:

```csharp
    [TestMethod]
    public void TwoConsecutiveBothIdleTimeoutsEndsInDraw()
    {
        var engine = new RpsEngine();
        var state = NewState();

        engine.ApplyTimeoutPenalty(state, Rng); // 1st both-idle: replay
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress));

        engine.ApplyTimeoutPenalty(state, Rng); // 2nd consecutive both-idle: draw
        var raw = engine.GetOutcome(state);
        Assert.IsInstanceOfType(raw, typeof(GameOutcome.Finished));
        var outcome = (GameOutcome.Finished)raw;
        Assert.IsTrue(outcome.Participants.All(p => p.Result == "draw"));
        Assert.AreEqual(2, outcome.Participants.Count);
    }

    [TestMethod]
    public void APickBetweenIdleTimeoutsResetsTheDrawStreak()
    {
        var engine = new RpsEngine();
        var state = NewState();

        engine.ApplyTimeoutPenalty(state, Rng); // 1st both-idle

        // A decisive round happens (10 beats 20) — resets the streak.
        engine.ApplyAction(state, 10, Pick("rock"), Rng);
        engine.ApplyAction(state, 20, Pick("scissors"), Rng);

        engine.ApplyTimeoutPenalty(state, Rng); // both-idle again, but streak was reset
        Assert.IsInstanceOfType(engine.GetOutcome(state), typeof(GameOutcome.InProgress),
            "a pick between idle rounds must reset the streak so no premature draw");
    }

    [TestMethod]
    public void DrawEmitsEndFeedLine()
    {
        var engine = new RpsEngine();
        var state = NewState();
        engine.ApplyTimeoutPenalty(state, Rng);
        engine.ApplyTimeoutPenalty(state, Rng);
        var line = engine.EndFeedLine(state, id => $"user{id}");
        Assert.IsNotNull(line);
        StringAssert.Contains(line, "draw");
    }
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "TestCategory=none|FullyQualifiedName~RpsEngineTests"`
Expected: PASS (all RpsEngineTests pass, including the 3 new ones).

If the filter above is awkward, run the whole file's class:
Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RpsEngineTests"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Games/RpsEngineTests.cs
git commit -m "test: RPS draw after two consecutive idle rounds + streak reset"
```

---

## Task 3: Manager derives draw outcome + emits draw flag

**Files:**
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs`

- [ ] **Step 1: Derive draw in `CompleteMatchAsync`**

In `CompleteMatchAsync`, replace the block that builds `completed` and computes `winner`. Currently (around lines 382-402):

```csharp
        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: match.Engine.MatchFormat(match.State),
            Outcome: "decided",
            AbandonReason: null,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: persistedParticipants,
            MetadataJson: BuildMatchMetadata(match));

        await _repository.SaveCompletedMatchAsync(completed);

        var winner = outcome.Participants.FirstOrDefault(p => p.Placement == 1);

        // winner.UserId is still a Mumble session id here (translation to db ids
        // happens in persistedParticipants above), which is what the client compares
        // against its own session id — so emit it directly as winnerId.
        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new { type = "game.ended", matchId = match.MatchId, gameType = match.GameType, winnerId = winner?.UserId });
```

Replace with:

```csharp
        // A match with no single winner (all participants "draw") is a real draw:
        // persist Outcome "draw" and emit no winnerId.
        var isDraw = outcome.Participants.All(p => p.Result == "draw");

        var completed = new CompletedMatch(
            GameType: match.GameType,
            ChannelId: match.ChannelId,
            Format: match.Engine.MatchFormat(match.State),
            Outcome: isDraw ? "draw" : "decided",
            AbandonReason: null,
            StartedAt: match.StartedAt,
            EndedAt: DateTimeOffset.UtcNow,
            Participants: persistedParticipants,
            MetadataJson: BuildMatchMetadata(match));

        await _repository.SaveCompletedMatchAsync(completed);

        var winner = isDraw ? null : outcome.Participants.FirstOrDefault(p => p.Placement == 1);

        // winner.UserId is still a Mumble session id here (translation to db ids
        // happens in persistedParticipants above), which is what the client compares
        // against its own session id — so emit it directly as winnerId.
        await _publisher.PublishToUsersAsync(
            RouteSet(match),
            new { type = "game.ended", matchId = match.MatchId, gameType = match.GameType, winnerId = winner?.UserId, draw = isDraw });
```

- [ ] **Step 2: Add an internal test hook to fire a turn timeout**

Directly after the existing `ExpireInviteForTestAsync` line (line 181):

```csharp
    internal Task ExpireInviteForTestAsync(long matchId) => EndPendingAsync(matchId, "game.expired");

    // Test-only: synchronously drive a turn-timeout for the current turn generation,
    // mirroring what the real TurnTimer callback does. Lets tests exercise AFK paths
    // without waiting on wall-clock timers.
    internal Task FireTurnTimeoutForTestAsync(long matchId)
    {
        if (!_matches.TryGetValue(matchId, out var match)) return Task.CompletedTask;
        var generation = Interlocked.Read(ref match.TurnGeneration);
        return HandleTurnTimeoutAsync(matchId, generation);
    }
```

- [ ] **Step 3: Build to confirm it compiles**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Server/Games/GameSessionManager.cs
git commit -m "feat: persist RPS draw outcome and emit game.ended draw flag"
```

---

## Task 4: Manager-level draw persistence test

**Files:**
- Modify: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`

- [ ] **Step 1: Add a helper to read the draw flag and the failing test**

Add this helper next to the other private helpers (after `DuelStates`):

```csharp
    // The `draw` flag of a game.ended message, or null if none was sent.
    private static bool? EndedDraw(IEnumerable<(string kind, object msg)> sent)
    {
        var ended = sent.LastOrDefault(s => s.msg.GetType().GetProperty("type")?.GetValue(s.msg) as string == "game.ended");
        if (ended.msg is null) return null;
        return ended.msg.GetType().GetProperty("draw")?.GetValue(ended.msg) as bool?;
    }
```

Add this test method to the class:

```csharp
    [TestMethod]
    public async Task Rps_BothIdleTwice_EndsAsDraw_PersistsAndFlags()
    {
        var presence = new FakePresence();
        presence.Users[10] = (1, true, 10);
        presence.Users[20] = (1, true, 20);
        var repo = GameTestHelpers.NewRepo();
        var pub = new FakePublisher();
        var mgr = NewManager(presence, pub, repo);

        var invite = await mgr.InviteAsync(10, 20, "rps",
            new Dictionary<string, object?> { ["bestOf"] = 3 });
        await mgr.RespondAsync(invite.MatchId, targetSession: 20, accept: true);

        // Both players go AFK for two consecutive rounds.
        await mgr.FireTurnTimeoutForTestAsync(invite.MatchId);
        await mgr.FireTurnTimeoutForTestAsync(invite.MatchId);

        Assert.IsTrue(SentType(pub.Sent, "game.ended"), "match should end");
        Assert.AreEqual(true, EndedDraw(pub.Sent), "game.ended should carry draw: true");

        var s10 = await repo.GetUserStatsAsync(10, "rps");
        var s20 = await repo.GetUserStatsAsync(20, "rps");
        Assert.AreEqual(1, s10.Draws, "player 10 records a draw");
        Assert.AreEqual(1, s20.Draws, "player 20 records a draw");
        Assert.AreEqual(0, s10.Wins);
        Assert.AreEqual(0, s20.Wins);
    }
```

Note: `InviteAsync` overload with options and `RespondAsync` are already exercised at
`GameSessionManagerTests.cs:347` and `:80`. `GetUserStatsAsync` returns `UserGameStats`
with a `Draws` property (`GameMatchModels.cs:42-49`).

- [ ] **Step 2: Run the test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Rps_BothIdleTwice"`
Expected: PASS.

- [ ] **Step 3: Run the full server suite to check for regressions**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: PASS (all tests, 371+).

- [ ] **Step 4: Commit**

```bash
git add tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs
git commit -m "test: RPS mutual-AFK match ends as a persisted draw"
```

---

## Task 5: Client — draw end-state

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/useGameState.ts`
- Modify: `src/Brmble.Web/src/components/Games/RpsModal.tsx`

- [ ] **Step 1: Add `draw` to the `EndedMatch` interface**

In `useGameState.ts`, update the interface (currently lines 73-79):

```typescript
export interface EndedMatch {
  matchId: number;
  gameType: string;
  abandoned?: boolean;
  reason?: string;
  winnerId?: number;
  draw?: boolean;
}
```

- [ ] **Step 2: Read the `draw` flag in `handleEnded`**

In `handleEnded`, update the destructure type and the `setEnded` call:

```typescript
    const handleEnded = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; abandoned?: boolean; reason?: string; winnerId?: number; draw?: boolean };
      // Prefer the server-supplied winnerId (authoritative, and correct even for
      // forfeits where the local view has no loserId). Fall back to deriving it
      // from the local view for older servers that omit it.
      let winnerId: number | undefined = d.winnerId;
      if (winnerId == null && !d.draw) {
        const currentView = viewRef.current;
        if (currentView && !isRpsView(currentView) && currentView.loserId != null) {
          winnerId = currentView.players.find(p => p !== currentView.loserId);
        }
      }
      setEnded({
        matchId: d.matchId ?? activeMatchRef.current?.matchId ?? 0,
        gameType: d.gameType ?? activeMatchRef.current?.gameType ?? 'deathroll',
        abandoned: d.abandoned,
        reason: d.reason,
        winnerId,
        draw: d.draw,
      });
      setActiveMatch(null);
      setView(null);
      setTurnDeadline(null);
      setPenalty(false);
      setAccepting(false);
    };
```

- [ ] **Step 3: Add a draw branch to `RpsModal.renderResult`**

In `RpsModal.tsx`, update `renderResult` (lines 153-168):

```typescript
  const renderResult = () => {
    if (!showResult) return null;
    let message: string;
    if (ended.abandoned) {
      message = ended.reason ? `Match abandoned: ${ended.reason}` : 'The match was abandoned.';
    } else if (ended.draw) {
      message = 'Draw — both players idle.';
    } else if (ended.winnerId != null) {
      message = ended.winnerId === myUserId ? 'You win!' : `${resolveName(ended.winnerId)} wins!`;
    } else {
      message = 'The match has ended.';
    }
    return (
      <div className={styles.result}>
        <p className={styles.resultText}>{message}</p>
      </div>
    );
  };
```

- [ ] **Step 4: Build the frontend to confirm it typechecks**

Run: `cd src/Brmble.Web; npm run build`
Expected: build succeeds (tsc + vite, no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/useGameState.ts src/Brmble.Web/src/components/Games/RpsModal.tsx
git commit -m "feat: show draw end-state for RPS mutual-AFK matches"
```

---

## Task 6: Client — auto-decline unsupported game types

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/useGameState.ts`

- [ ] **Step 1: Add the supported-games constant**

Near the top of `useGameState.ts` (after the imports, before the hook), add:

```typescript
// Game types this client build knows how to render. Invites for anything else are
// auto-declined so an outdated peer can't open the wrong modal. Forward-compat only.
const SUPPORTED_GAMES = ['deathroll', 'rps'];
```

- [ ] **Step 2: Auto-decline unknown game types in `handleInvited`**

Replace `handleInvited` (lines 176-180):

```typescript
    const handleInvited = (data: unknown) => {
      const d = data as { matchId?: number; gameType?: string; from?: number; inviteMs?: number };
      if (d.matchId == null || d.from == null) return;
      const gameType = d.gameType ?? 'deathroll';
      if (!SUPPORTED_GAMES.includes(gameType)) {
        // This client build doesn't know this game — decline instead of opening the
        // wrong modal. (Old clients that predate this check can't reach here.)
        void gamesApi.respond(d.matchId, false);
        return;
      }
      setIncomingInvite({ matchId: d.matchId, gameType, from: d.from, inviteMs: d.inviteMs });
    };
```

Confirm `gamesApi` is already imported at the top of the file (it is — `gamesApi.invite` is used in `invite()`). If the import alias differs, use the existing alias.

- [ ] **Step 3: Build the frontend to confirm it typechecks**

Run: `cd src/Brmble.Web; npm run build`
Expected: build succeeds.

- [ ] **Step 4: Run the UI-guide compliance test (no new emoji/glyphs in components)**

Run: `cd src/Brmble.Web; npm run test -- uiGuideCompliance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/useGameState.ts
git commit -m "feat: auto-decline game invites for unsupported game types"
```

---

## Task 7: Full verification + deploy for two-client test

**Files:** none (verification only)

- [ ] **Step 1: Run the full server suite**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: PASS.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd src/Brmble.Web; npm run test`
Expected: PASS (1051+ tests).

- [ ] **Step 3: Rebuild the docker server (draw logic is server-side)**

Run: `docker compose -f docker-local/docker-compose.yml up -d --build brmble`
Expected: container recreated; `docker compose -f docker-local/docker-compose.yml logs --tail 20 brmble` shows "Connected to Mumble" and "Now listening on: https://[::]:8080".

- [ ] **Step 4: Update the multi-client test worktree to the latest commit**

Run: `git rev-parse HEAD` then `git -C .worktrees/multi-share-test checkout <that-sha>`
Expected: worktree HEAD at the new commit.

- [ ] **Step 5: Manual two-client check**

- Start an RPS match between two clients; both stay idle. After two 15s round windows (~30s), the match ends showing "Draw — both players idle." in both modals and a draw feed line; the channel duel badge clears and a new game can start.
- Head-to-head between the two players shows the draw counted (`…D`).
- (Optional forward-compat) confirm no regression to normal RPS win/loss and Deathroll.

---

## Notes for the implementer

- Do NOT push or open a PR — commit to `feature/rps-minigame-and-stats` only (per `CLAUDE.md`).
- Server-generated feed text lives in `RpsEngine.cs` and requires the docker server rebuild to take effect; client changes require `npm run build` + client restart.
- WebView2 cannot render 🪨/📄; the draw line reuses the known-safe `✊✋✌️` set — do not introduce new emoji.
