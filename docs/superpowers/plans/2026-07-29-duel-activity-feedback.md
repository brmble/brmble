# Duel Activity Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear accepted challenge notifications immediately, highlight the channel duel badge while the local player waits in a queue or ready check, and show per-duel estimated duration plus a live elapsed/over-estimate timer in the duel activity panel.

**Architecture:** The server adds an `estimatedDuration` (full-duration median) to every active, ready, and queued snapshot entry, computing each distinct game configuration once per snapshot and reusing it for cumulative ETAs. The web adds a `game.accepted` handler that clears only the matching offer, derives personal duel channels from complete snapshots, and renders duration/elapsed text from server values with a one-second display tick.

**Tech Stack:** C# / ASP.NET Core (`Brmble.Server`), MSTest, React + TypeScript (`Brmble.Web`), Vitest + Testing Library, CSS modules with design tokens.

**Source spec:** `docs/superpowers/specs/2026-07-26-queued-duel-feedback-design.md`

**Branch:** `feature/minigame-framework-expansion`. Do not create branches or worktrees. Never stage the pre-existing untracked files under `.opencode/plans/` and `docs/superpowers/`.

---

### Task 1: Estimate cache for snapshot construction

**Files:**
- Modify: `src/Brmble.Server/Games/Duels/DuelDurationEstimator.cs`
- Test: `tests/Brmble.Server.Tests/Games/Duels/DuelDurationEstimatorTests.cs`

Today `BuildEtasAsync` calls `EstimateDurationAsync` once per queued reservation, so a queue with three Deathroll pairs issues three identical repository queries. Task 2 adds one more per-entry estimate, so cache full-duration estimates per configuration group first.

- [ ] **Step 1: Write the failing test**

Add to `tests/Brmble.Server.Tests/Games/Duels/DuelDurationEstimatorTests.cs`:

```csharp
    [TestMethod]
    public async Task BuildEtas_QueriesEachConfigurationGroupOnce()
    {
        var repository = new FakeDurationSampleRepository();
        repository.SetSamples("deathroll", "1v1", 1, Enumerable.Repeat(10_000L, 10));
        var estimator = new DuelDurationEstimator(repository);
        var now = new DateTimeOffset(2026, 7, 29, 0, 0, 0, TimeSpan.Zero);
        var config = new DuelConfiguration("deathroll", "1v1", 1,
            new Dictionary<string, object?>(), "discrete");
        var input = new ChannelSnapshotInput(
            7, 1, 1, now, null, null,
            [Reservation(1, config, now), Reservation(2, config, now), Reservation(3, config, now)]);

        await estimator.BuildEtasAsync(input);

        Assert.AreEqual(1, repository.FullQueryCount("deathroll", "1v1", 1));
    }
```

Add these helpers to the same test class if they do not already exist (match the file's existing fake/reservation helpers instead of duplicating them if equivalents are present):

```csharp
    private static DuelReservation Reservation(long id, DuelConfiguration config, DateTimeOffset at) =>
        new(id, 7,
            new DuelPlayer(id * 10, id * 100, $"P{id}a"),
            new DuelPlayer(id * 10 + 1, id * 100 + 1, $"P{id}b"),
            config, at, id, null);
```

`FakeDurationSampleRepository` must count calls where `elapsedGreaterThanMs` is null, keyed by `(gameType, format, rulesetVersion)`, and expose `FullQueryCount`. If the existing fake lacks counting, add it there rather than creating a second fake.

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~BuildEtas_QueriesEachConfigurationGroupOnce`
Expected: FAIL — `Assert.AreEqual failed. Expected:<1>. Actual:<3>`

- [ ] **Step 3: Add the per-call cache**

In `DuelDurationEstimator`, add a private cache helper and use it for every full-duration lookup inside `BuildEtasAsync`:

```csharp
    private async Task<DurationEstimate> CachedDurationAsync(
        Dictionary<(string, string, int), DurationEstimate> cache, DuelConfiguration config)
    {
        var key = (config.GameType, config.Format, config.RulesetVersion);
        if (cache.TryGetValue(key, out var cached)) return cached;
        var estimate = await EstimateDurationAsync(config);
        cache[key] = estimate;
        return estimate;
    }
```

In `BuildEtasAsync`, create `var cache = new Dictionary<(string, string, int), DurationEstimate>();` as the first statement, then replace the two `await EstimateDurationAsync(...)` calls (the ready-check duration and the per-queue-entry duration) with `await CachedDurationAsync(cache, <config>)`. Leave `EstimateRemainingAsync` for the active duel unchanged — it is a different, elapsed-conditional query.

- [ ] **Step 4: Run the estimator tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~DuelDurationEstimatorTests`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/Duels/DuelDurationEstimator.cs tests/Brmble.Server.Tests/Games/Duels/DuelDurationEstimatorTests.cs
git commit -m "perf: reuse duel duration estimates per snapshot"
```

---

### Task 2: Expose estimated duration on snapshot models

**Files:**
- Modify: `src/Brmble.Server/Games/Duels/DuelModels.cs:114-139`
- Modify: `src/Brmble.Server/Games/Duels/DuelDurationEstimator.cs`
- Modify: `src/Brmble.Server/Games/Duels/DuelOrchestrator.cs:1015-1060`
- Test: `tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs`

`ActiveDuelSnapshot` carries only `Remaining`; ready and queued entries carry no duration at all. Add `EstimatedDuration` to all three, and expose the per-entry estimates the estimator already computes so the orchestrator does not re-query.

- [ ] **Step 1: Write the failing test**

Add to `tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs`:

```csharp
    [TestMethod]
    public async Task Snapshot_ExposesEstimatedDurationForActiveReadyAndQueued()
    {
        var time = new TestTimeProvider(new DateTimeOffset(2026, 7, 29, 0, 0, 0, TimeSpan.Zero));
        var (sut, presence, _, router) = Create(time);
        Add(presence, 10, 100); Add(presence, 20, 200);
        Add(presence, 30, 300); Add(presence, 40, 400);
        Add(presence, 50, 500); Add(presence, 60, 600);
        var active = await Challenge(sut, 100, 200);
        await sut.RespondToOfferAsync(active.OfferId!.Value, 200, true);
        var ready = await Challenge(sut, 300, 400);
        await sut.RespondToOfferAsync(ready.OfferId!.Value, 400, true);
        var queued = await Challenge(sut, 500, 600);
        await sut.RespondToOfferAsync(queued.OfferId!.Value, 600, true);

        var snapshot = await sut.GetSnapshotForSessionAsync(100);

        Assert.IsNotNull(snapshot.Active!.EstimatedDuration);
        Assert.IsNotNull(snapshot.Queue[0].EstimatedDuration);
        Assert.AreEqual(EstimateStatus.Unknown, snapshot.Queue[0].EstimatedDuration.Status);
    }
```

Reuse the file's existing `Create`, `Add`, and challenge helpers; if the helper that creates a challenge has a different name than `Challenge`, use that name and keep the same accept sequence.

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~Snapshot_ExposesEstimatedDurationForActiveReadyAndQueued`
Expected: FAIL — compile error `'ActiveDuelSnapshot' does not contain a definition for 'EstimatedDuration'`.

- [ ] **Step 3: Add the model fields**

In `src/Brmble.Server/Games/Duels/DuelModels.cs` replace the three snapshot records:

```csharp
public sealed record ActiveDuelSnapshot(
    long MatchId,
    string Status,
    DateTimeOffset StartedAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    DurationEstimate Remaining,
    DurationEstimate EstimatedDuration);

public sealed record ReadyCheckSnapshot(
    long ReservationId,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    DurationEstimate EstimatedDuration);

public sealed record QueuedDuelSnapshot(
    long ReservationId,
    int Position,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    QueueEtaSnapshot Eta,
    DurationEstimate EstimatedDuration);
```

- [ ] **Step 4: Return the computed estimates from the estimator**

In `DuelDurationEstimator`, add a result record next to the class:

```csharp
public sealed record DuelEtaResult(
    IReadOnlyList<QueueEtaSnapshot> QueueEtas,
    DurationEstimate? ReadyDuration,
    IReadOnlyList<DurationEstimate> QueueDurations,
    DurationEstimate? ActiveDuration);
```

Change `BuildEtasAsync` to return `Task<DuelEtaResult>`. Keep the existing accumulation logic exactly as-is, and additionally:
- capture `readyDuration` when the ready-check duration is computed (null when `input.ReadyCheck` is null),
- append each queued reservation's cached duration to a `queueDurations` list in queue order,
- capture the active full duration with `input.Active is null ? null : await CachedDurationAsync(cache, input.Active.Configuration)`,
- return `new DuelEtaResult(result, readyDuration, queueDurations, activeDuration)`.

The cumulative ETA math, segment metadata, and unknown propagation must not change.

- [ ] **Step 5: Populate the fields in the orchestrator**

In `src/Brmble.Server/Games/Duels/DuelOrchestrator.cs` `BuildSnapshotAsync`, replace the `etas` assignment and the three snapshot constructions:

```csharp
        var estimates = _estimator is null
            ? new DuelEtaResult(
                input.Queue.Select(_ => new QueueEtaSnapshot(EstimateStatus.Unknown, null, null, true, [])).ToArray(),
                input.ReadyCheck is null ? null : DurationEstimate.Unknown(0),
                input.Queue.Select(_ => DurationEstimate.Unknown(0)).ToArray(),
                input.Active is null ? null : DurationEstimate.Unknown(0))
            : await _estimator.BuildEtasAsync(input, remaining);
        var etas = estimates.QueueEtas;
```

Then pass `estimates.ActiveDuration!` as the new `ActiveDuelSnapshot` argument, `estimates.ReadyDuration!` as the new `ReadyCheckSnapshot` argument, and `estimates.QueueDurations[index]` as the new `QueuedDuelSnapshot` argument. Everything else in the method stays the same.

- [ ] **Step 6: Run the server duel tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~DuelDurationEstimatorTests|FullyQualifiedName~DuelSerializationTests"`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Games/Duels/DuelModels.cs src/Brmble.Server/Games/Duels/DuelDurationEstimator.cs src/Brmble.Server/Games/Duels/DuelOrchestrator.cs tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs tests/Brmble.Server.Tests/Games/Duels/DuelDurationEstimatorTests.cs
git commit -m "feat: add estimated duration to duel snapshots"
```

---

### Task 3: Serialize estimated duration on the wire

**Files:**
- Modify: `src/Brmble.Server/Games/Duels/DuelWire.cs:71-173`
- Test: `tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs`

- [ ] **Step 1: Write the failing test**

Add to `tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs`:

```csharp
    [TestMethod]
    public void Snapshot_SerializesEstimatedDurationForEveryEntry()
    {
        var json = JsonSerializer.Serialize(
            DuelWire.ToSnapshot(SnapshotWithAllSections()), DuelWire.JsonOptions);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        Assert.AreEqual("known",
            root.GetProperty("active").GetProperty("estimatedDuration").GetProperty("status").GetString());
        Assert.AreEqual("unknown",
            root.GetProperty("readyCheck").GetProperty("estimatedDuration").GetProperty("status").GetString());
        Assert.AreEqual(25000,
            root.GetProperty("queue")[0].GetProperty("estimatedDuration").GetProperty("milliseconds").GetInt64());
    }
```

Add a helper to the same file that builds a snapshot containing an active duel with `DurationEstimate.Known(30000, 12, EstimateMethod.FullMedian)` as `EstimatedDuration`, a ready check with `DurationEstimate.Unknown(3)`, and one queued entry with `DurationEstimate.Known(25000, 11, EstimateMethod.FullMedian)`. If the file already has a full-snapshot factory, extend it with the new arguments instead of adding a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~Snapshot_SerializesEstimatedDurationForEveryEntry`
Expected: FAIL — `System.Collections.Generic.KeyNotFoundException` / property `estimatedDuration` not found.

- [ ] **Step 3: Add the wire fields**

In `src/Brmble.Server/Games/Duels/DuelWire.cs`:

```csharp
public sealed record ActiveDuelWire(
    long MatchId,
    string Status,
    DateTimeOffset StartedAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    DurationEstimateWire Remaining,
    DurationEstimateWire EstimatedDuration);

public sealed record ReadyCheckWire(
    long ReservationId,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    DurationEstimateWire EstimatedDuration);

public sealed record QueuedDuelWire(
    long ReservationId,
    int Position,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    QueueEtaWire Eta,
    DurationEstimateWire EstimatedDuration);
```

Add a shared mapper inside `DuelQueueSnapshotWire` and use it for `Remaining` and all three `EstimatedDuration` values:

```csharp
    private static DurationEstimateWire MapEstimate(
        DurationEstimate estimate,
        Func<EstimateStatus, string> status,
        Func<EstimateMethod, string> method) =>
        new(status(estimate.Status), estimate.Milliseconds, estimate.SampleCount,
            method(estimate.Method), estimate.Approximate);
```

`MapReady` now needs the `status` and `method` delegates; pass them through from `From`. Do not add a `JsonStringEnumConverter` — enum text stays explicit.

- [ ] **Step 4: Run the serialization and orchestrator tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelSerializationTests|FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~GameEndpointsTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/Duels/DuelWire.cs tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs
git commit -m "feat: serialize duel estimated duration"
```

---

### Task 4: Clear accepted challenges from `game.accepted`

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/useGameState.ts:198-401`
- Test: `src/Brmble.Web/src/components/Games/useGameState.test.tsx`

The server publishes `game.accepted` with the accepted `offerId` (`DuelOrchestrator.cs:830`), but no web listener exists, so an accepted challenge notification stays on screen with live buttons.

- [ ] **Step 1: Write the failing test**

Add to `src/Brmble.Web/src/components/Games/useGameState.test.tsx` (follow the file's existing `emit` / `renderHook` helpers):

```tsx
  it('clears the matching incoming challenge when the server accepts it', () => {
    const { result } = renderHook(() => useGameState(100));

    act(() => emit('game.invited', { offerId: 5, from: 22, gameType: 'deathroll' }));
    expect(result.current.incomingInvite).not.toBeNull();

    act(() => emit('game.accepted', { offerId: 5 }));

    expect(result.current.incomingInvite).toBeNull();
    expect(result.current.accepting).toBe(false);
  });

  it('clears the matching outgoing challenge when the server accepts it', () => {
    const { result } = renderHook(() => useGameState(100));

    act(() => emit('game.invitePending', { offerId: 9, target: 22, gameType: 'deathroll' }));
    expect(result.current.outgoingInvite).not.toBeNull();

    act(() => emit('game.accepted', { offerId: 9 }));

    expect(result.current.outgoingInvite).toBeNull();
    expect(result.current.inviteOutcome).toBeNull();
  });

  it('ignores an accepted event for a different offer', () => {
    const { result } = renderHook(() => useGameState(100));

    act(() => emit('game.invited', { offerId: 5, from: 22, gameType: 'deathroll' }));
    act(() => emit('game.accepted', { offerId: 4 }));

    expect(result.current.incomingInvite?.offerId).toBe(5);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/components/Games/useGameState.test.tsx` (from `src/Brmble.Web`)
Expected: FAIL — `expected { offerId: 5, … } to be null`.

- [ ] **Step 3: Handle the event**

In `useGameState.ts`, add inside the existing `useEffect` that registers bridge handlers, next to `handleDeclined`:

```ts
    // The offer became a reservation (queued or starting). Clear only the matching
    // challenge so its buttons can't send commands for an offer that no longer
    // exists. No outcome notification: the queue snapshot is the ongoing status.
    const handleAccepted = (data: unknown) => {
      const { offerId } = data as { offerId?: number };
      if (offerId == null) return;
      if (incomingInviteRef.current?.offerId === offerId) {
        setIncomingInvite(null);
        setAccepting(false);
      }
      if (outgoingInviteRef.current?.offerId === offerId) {
        selfCanceledRef.current = false;
        pendingCancelRef.current = false;
        setOutgoing(null);
      }
    };
```

Register and unregister it alongside the others:

```ts
    bridge.on('game.accepted', handleAccepted);
```

```ts
      bridge.off('game.accepted', handleAccepted);
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- --run src/components/Games/useGameState.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/useGameState.ts src/Brmble.Web/src/components/Games/useGameState.test.tsx
git commit -m "fix: clear accepted duel challenges"
```

---

### Task 5: Highlight the badge for your queued or ready duel

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:1013-1017`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:44,83,453`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx:62,95,390-404`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css:115`
- Test: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
- Test: `src/Brmble.Web/src/App.duelOrchestration.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`:

```tsx
  it('marks the duel badge active when the local player is waiting in that channel', () => {
    render(
      <ChannelTree
        channels={channels}
        users={[]}
        duelChannelIds={new Set([1])}
        personalDuelChannelIds={new Set([1])}
        onJoinChannel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Open duel activity for General')).toHaveClass('active');
  });

  it('leaves the duel badge unstyled for duels the local player is not waiting in', () => {
    render(
      <ChannelTree
        channels={channels}
        users={[]}
        duelChannelIds={new Set([1])}
        personalDuelChannelIds={new Set()}
        onJoinChannel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Open duel activity for General')).not.toHaveClass('active');
  });
```

Add to `src/Brmble.Web/src/App.duelOrchestration.test.tsx`, following that file's existing snapshot-emitting helpers and `mocks.sidebarProps` pattern:

```tsx
  it('marks only channels where the local player is queued or ready as personal', async () => {
    renderApp();

    await emitSnapshot({
      channelId: 7,
      queue: [queuedEntry({ reservationId: 41, players: [player(selfSession), player(999)] })],
    });
    await emitSnapshot({ channelId: 8, queue: [queuedEntry({ reservationId: 42 })] });

    expect(mocks.sidebarProps.current?.duelChannelIds).toEqual(new Set([7, 8]));
    expect(mocks.sidebarProps.current?.personalDuelChannelIds).toEqual(new Set([7]));
  });

  it('does not mark a channel personal for an active-only local match', async () => {
    renderApp();

    await emitSnapshot({
      channelId: 7,
      active: activeEntry({ players: [player(selfSession), player(999)] }),
    });

    expect(mocks.sidebarProps.current?.personalDuelChannelIds).toEqual(new Set());
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/components/Sidebar/ChannelTree.test.tsx src/App.duelOrchestration.test.tsx`
Expected: FAIL — badge has no `active` class; `personalDuelChannelIds` is `undefined`.

- [ ] **Step 3: Derive the personal channel set**

In `src/Brmble.Web/src/App.tsx`, directly after the existing `duelChannelIds` memo:

```tsx
  // Personal = you are waiting (queued or ready). An active match already shows
  // its own participant modal, so it does not highlight the badge.
  const personalDuelChannelIds = useMemo(() => new Set(
    [...duelQueue.byChannel.values()]
      .filter(snapshot =>
        snapshot.readyCheck?.players.some(player => player.sessionId === selfSession)
        || snapshot.queue.some(entry => entry.players.some(player => player.sessionId === selfSession)))
      .map(snapshot => snapshot.channelId),
  ), [duelQueue.byChannel, selfSession]);
```

Pass it to the sidebar next to `duelChannelIds={duelChannelIds}`:

```tsx
          personalDuelChannelIds={personalDuelChannelIds}
```

- [ ] **Step 4: Thread the prop through the sidebar**

In `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`, add `personalDuelChannelIds?: Set<number>;` to `SidebarProps` beside `duelChannelIds`, add `personalDuelChannelIds,` to the destructured parameters, and pass `personalDuelChannelIds={personalDuelChannelIds}` to `<ChannelTree>`.

In `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`, add `personalDuelChannelIds?: Set<number>;` to `ChannelTreeProps`, add `personalDuelChannelIds` to the destructured props, and set the button class:

```tsx
                className={`channel-duel-icon${personalDuelChannelIds?.has(channel.id) ? ' active' : ''}`}
```

- [ ] **Step 5: Add the active treatment**

In `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`, after the `.channel-duel-icon` rule:

```css
/* Same active treatment as the top-bar mute control (UserPanel.css). */
.channel-duel-icon.active {
  color: var(--accent-primary);
  background: var(--accent-primary-wash);
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- --run src/components/Sidebar/ChannelTree.test.tsx src/components/Sidebar/Sidebar.test.tsx src/App.duelOrchestration.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.css src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx src/Brmble.Web/src/App.duelOrchestration.test.tsx
git commit -m "feat: highlight your queued duel channel"
```

---

### Task 6: Type the estimated duration in the web contract

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts:78-106`
- Test: `src/Brmble.Web/src/components/Games/useDuelQueueState.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/Brmble.Web/src/components/Games/useDuelQueueState.test.tsx`, using that file's existing `snapshot(...)` helper and emit pattern:

```tsx
  it('keeps the estimated duration from an applied snapshot', async () => {
    const { result } = await connectedHook(2);

    emit('game.queueSnapshot', {
      ...snapshot(2, 1, 1, queued),
      queue: [{
        ...queued[0],
        estimatedDuration: {
          status: 'known', milliseconds: 25000, sampleCount: 11,
          method: 'fullMedian', approximate: true,
        },
      }],
    });

    expect(result.current.byChannel.get(2)?.queue[0].estimatedDuration.milliseconds).toBe(25000);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run type-check` (from `src/Brmble.Web`)
Expected: FAIL — `Property 'estimatedDuration' does not exist on type 'QueuedDuel'`.

- [ ] **Step 3: Add the fields**

In `src/Brmble.Web/src/api/games.ts` add `estimatedDuration: DurationEstimate;` as the last property of `ActiveDuel`, `ReadyCheck`, and `QueuedDuel`. Do not change `DurationEstimate` itself.

- [ ] **Step 4: Verify types and hook tests**

Run: `npm run type-check`
Expected: exit 0.

Run: `npm test -- --run src/components/Games/useDuelQueueState.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/api/games.ts src/Brmble.Web/src/components/Games/useDuelQueueState.test.tsx
git commit -m "feat: type duel estimated duration"
```

---

### Task 7: Show estimated duration and live elapsed time

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx`
- Modify: `src/Brmble.Web/src/components/Games/DuelQueueModal.module.css`
- Modify: `docs/UI_GUIDE.md:254-280`
- Test: `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx`

Read `docs/UI_GUIDE.md` §"Project 1 Duel Queue Pattern" before editing. Use only existing tokens; no literal colors, sizes, or spacing.

- [ ] **Step 1: Document the pattern**

In `docs/UI_GUIDE.md`, inside the Project 1 Duel Queue Pattern section, add:

```markdown
Duel activity cards show two distinct server-owned values. `Estimated duration: ~25s` is that duel's
own expected length (server full-duration median; `Unknown` when the server has too few samples).
The live card additionally shows `Elapsed: 12s` and either `Ends in about 13s` or, past the estimate,
`6s over estimate` in `--accent-danger`. Queued cards show `Starts in about 50s` (cumulative, excludes
their own duration) or `Starts in: Unknown` when any earlier segment is unknown — showing each duel's
own estimate is what makes that propagation legible, so never invent a partial ETA. Elapsed and
over-estimate values tick once per second from the server `startedAt`; they are display-only and never
end, delay, or otherwise control a match.
```

- [ ] **Step 2: Write the failing tests**

Add to `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx` (reuse the file's existing snapshot factory; add `estimatedDuration` to its entries):

```tsx
  it('shows estimated duration, elapsed time, and remaining time for a live duel', () => {
    vi.setSystemTime(new Date('2026-07-29T00:00:12Z'));
    render(
      <DuelQueueModal
        snapshot={snapshotWith({
          active: activeEntry({
            startedAt: '2026-07-29T00:00:00Z',
            estimatedDuration: known(25000),
          }),
        })}
        resolveName={() => 'P'}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Estimated duration: ~25s/)).toBeInTheDocument();
    expect(screen.getByText(/Elapsed: 12s/)).toBeInTheDocument();
    expect(screen.getByText(/Ends in about 13s/)).toBeInTheDocument();
  });

  it('shows time over estimate once a live duel passes its estimate', () => {
    vi.setSystemTime(new Date('2026-07-29T00:00:31Z'));
    render(
      <DuelQueueModal
        snapshot={snapshotWith({
          active: activeEntry({
            startedAt: '2026-07-29T00:00:00Z',
            estimatedDuration: known(25000),
          }),
        })}
        resolveName={() => 'P'}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/6s over estimate/)).toBeInTheDocument();
  });

  it('ticks the elapsed time every second', () => {
    vi.setSystemTime(new Date('2026-07-29T00:00:05Z'));
    render(
      <DuelQueueModal
        snapshot={snapshotWith({
          active: activeEntry({
            startedAt: '2026-07-29T00:00:00Z',
            estimatedDuration: known(25000),
          }),
        })}
        resolveName={() => 'P'}
        onClose={vi.fn()}
      />,
    );

    act(() => { vi.advanceTimersByTime(2000); });

    expect(screen.getByText(/Elapsed: 7s/)).toBeInTheDocument();
  });

  it('shows each queued duel its own estimate and an unknown start when blocked', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWith({
          queue: [queuedEntry({
            estimatedDuration: known(25000),
            eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
          })],
        })}
        resolveName={() => 'P'}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Estimated duration: ~25s/)).toBeInTheDocument();
    expect(screen.getByText(/Starts in: Unknown/)).toBeInTheDocument();
  });

  it('shows elapsed time without a prediction when the duration is unknown', () => {
    vi.setSystemTime(new Date('2026-07-29T00:00:09Z'));
    render(
      <DuelQueueModal
        snapshot={snapshotWith({
          active: activeEntry({
            startedAt: '2026-07-29T00:00:00Z',
            estimatedDuration: unknownEstimate(),
          }),
        })}
        resolveName={() => 'P'}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Estimated duration: Unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Elapsed: 9s/)).toBeInTheDocument();
    expect(screen.queryByText(/over estimate/)).toBeNull();
    expect(screen.queryByText(/Ends in/)).toBeNull();
  });

  it('formats minute durations', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWith({ queue: [queuedEntry({ estimatedDuration: known(65000) })] })}
        resolveName={() => 'P'}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Estimated duration: ~1m 5s/)).toBeInTheDocument();
  });
```

Add local helpers `known(ms)` returning `{ status: 'known', milliseconds: ms, sampleCount: 11, method: 'fullMedian', approximate: true }` and `unknownEstimate()` returning `{ status: 'unknown', milliseconds: null, sampleCount: 2, method: 'insufficient', approximate: true }`. Enable fake timers for this file with `beforeEach(() => vi.useFakeTimers())` and `afterEach(() => vi.useRealTimers())` if it does not already do so.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --run src/components/Games/DuelQueueModal.test.tsx`
Expected: FAIL — `Unable to find an element with text: /Estimated duration: ~25s/`.

- [ ] **Step 4: Render the new timing**

In `DuelQueueModal.tsx`, add a one-second tick and helpers:

```tsx
function estimateText(estimate: DurationEstimate): string {
  return estimate.status === 'known' && estimate.milliseconds != null
    ? `Estimated duration: ~${formatDuration(estimate.milliseconds)}`
    : 'Estimated duration: Unknown';
}

function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
```

Import `useState` alongside the existing React imports and import `DurationEstimate` from `../../api/games`.

Inside the component, before the return:

```tsx
  const now = useSecondTick(!!snapshot.active);
  const active = snapshot.active;
  const elapsedMs = active ? Math.max(0, now - Date.parse(active.startedAt)) : 0;
  const estimatedMs = active?.estimatedDuration.status === 'known'
    ? active.estimatedDuration.milliseconds
    : null;
  const overMs = estimatedMs != null ? elapsedMs - estimatedMs : null;
```

Replace the active card's `<span className={styles.eta}>…</span>` with:

```tsx
              <span className={styles.meta}>{estimateText(active!.estimatedDuration)}</span>
              <span className={styles.eta}>Elapsed: {formatDuration(elapsedMs)}</span>
              {overMs != null && (
                overMs > 0
                  ? <span className={styles.over}>{formatDuration(overMs)} over estimate</span>
                  : <span className={styles.eta}>Ends in about {formatDuration(-overMs)}</span>
              )}
```

Add to the ready-check card, after its `.meta` line:

```tsx
              <span className={styles.meta}>{estimateText(snapshot.readyCheck.estimatedDuration)}</span>
```

Replace the queued card's ETA span with:

```tsx
                    <span className={styles.meta}>{estimateText(entry.estimatedDuration)}</span>
                    <span className={styles.eta}>
                      {entry.eta.status === 'known' && entry.eta.milliseconds != null
                        ? `Starts in about ${formatDuration(entry.eta.milliseconds)}`
                        : 'Starts in: Unknown'}
                    </span>
```

- [ ] **Step 5: Add the over-estimate style**

In `DuelQueueModal.module.css`, after `.eta`:

```css
.over {
  font-family: var(--font-mono);
  color: var(--accent-danger);
}
```

- [ ] **Step 6: Run the tests and checks**

Run: `npm test -- --run src/components/Games/DuelQueueModal.test.tsx src/uiGuideCompliance.test.ts`
Expected: PASS.

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add docs/UI_GUIDE.md src/Brmble.Web/src/components/Games/DuelQueueModal.tsx src/Brmble.Web/src/components/Games/DuelQueueModal.module.css src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx
git commit -m "feat: show duel duration and elapsed time"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the server suite**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: 0 failures.

- [ ] **Step 2: Run the client suite**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: 0 failures.

- [ ] **Step 3: Run the web suite**

Run: `npm test` (from `src/Brmble.Web`)
Expected: 0 failures.

- [ ] **Step 4: Build everything**

Run: `dotnet build`
Expected: `Build succeeded`, 0 errors.

Run: `npm run build` (from `src/Brmble.Web`)
Expected: `built in …`, exit 0.

- [ ] **Step 5: Report**

Report the four suite/build results verbatim. Manual checks that automation cannot cover: two clients with a queued pair (badge highlight and accepted-notification dismissal), a live duel running past its estimate (danger-styled `over estimate`), and the panel in Classic and Retro Terminal themes.
