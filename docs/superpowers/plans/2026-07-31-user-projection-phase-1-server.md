# User Projection — Phase 1: Server Wire Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Brmble server's session-mapping payloads self-describing and orderable — an `instanceId` to detect restarts, a monotonic `revision` to detect gaps, tri-state `isBrmbleClient` so "unknown" stops being sent as `false`, and a `requestSnapshot` message so a client can repair itself.

**Architecture:** The revision counter lives inside `SessionMappingService`, which already owns every mutation. A new `MappingEventPublisher` performs "mutate, then enqueue the broadcast" under a single lock, so revision order always matches delivery order. All changes are additive on the wire; older clients ignore the new fields.

**Tech Stack:** C# / .NET 10, ASP.NET Core minimal APIs, MSTest + Moq.

**Spec:** `docs/superpowers/specs/2026-07-31-user-projection-design.md` §4.1, §4.2, §4.5.

**Scope note:** This is Phase 1 of three. Phase 2 builds the client-side `UserProjectionStore`; Phase 3 rewires `MumbleAdapter` and `App.tsx`. Phase 1 ships and is useful on its own — no client changes are required for it to be safe.

**Dependencies:**

1. **PR #617 (`fix/companion-broadcast-scope`) — MERGED** as `a4c993fa`. Gap detection requires every client to observe every mutation; the channel-scoped `companionChanged` it removed would have caused phantom gaps.
2. **`fix/companion-update-race` (`cd7b48fa`) must land first.** It adds `TryUpdateCompanionIdIfOwnedBy` and restructures the deletion endpoint. This plan is written against the post-`cd7b48fa` code. Verify both with:

```bash
git log --oneline origin/main | Select-String "broadcast companion changes"
Select-String -Path src/Brmble.Server/Events/ISessionMappingService.cs -Pattern TryUpdateCompanionIdIfOwnedBy
```

If the second returns nothing, stop — Task 1 and Task 4 reference a method that does not exist yet.

---

## Background you need

`SessionMappingService` (`src/Brmble.Server/Events/SessionMappingService.cs`) is an in-memory store of four `ConcurrentDictionary` indexes. It is a singleton (`Mumble/MumbleExtensions.cs:12`) and holds no persistence — a process restart empties it, which is exactly why `instanceId` is needed.

`BrmbleEventBus.BroadcastCoreAsync` is deliberately **not** an `async` method: it serialises the payload and enqueues to every client's per-socket queue synchronously, then returns a `Task` that completes when delivery finishes. The distinction matters enormously here:

- **Calling** `BroadcastAsync` does no socket I/O — it only enqueues.
- **Awaiting** the returned task waits for actual delivery.

So holding a lock across the *call* is cheap and safe; holding it across the *await* is not. `MappingEventPublisher` (Task 3) enqueues under its lock and awaits outside it, which is what gives ordering without serialising I/O.

**This is also why the publisher does not regress `cd7b48fa`.** That commit moved deletion broadcasts outside the event-coordinator lock because `await eventBus.BroadcastAsync(...)` was waiting on a full-server fan-out while holding it. Using the publisher inside that lock is fine — `PublishAsync` returns before any I/O — provided you collect the tasks and `await Task.WhenAll(...)` after releasing. Task 4 shows the shape.

There are seven mutation methods: `TryAddMatrixUser`, `RemoveSession`, `TryUpdateCompanionId`, `TryUpdateCompanionIdIfCurrent`, `TryUpdateCompanionIdIfOwnedBy`, `TryUpdateBrmbleStatus`, `TryUpdateCertHash`.

**JSON naming — read this before writing any payload.** `BrmbleEventBus` serialises with `PropertyNamingPolicy = JsonNamingPolicy.CamelCase` (`BrmbleEventBus.cs:17`), but the tests in this plan call `JsonSerializer.Serialize` with default options. The codebase convention sidesteps the mismatch by naming anonymous-type properties in camelCase directly (`sessionId = ...`, never `SessionId`). Follow it: always write `instanceId = envelope.InstanceId`, never the `envelope.InstanceId` property shorthand — the shorthand emits `InstanceId` under default options and every assertion in this plan would fail.

**Deliberately not in Phase 1.** Spec §4.1 also makes `companionId` tri-state, with `"floppy"` becoming a render-time fallback. That is *not* done here, because §4.4 ties it to client version negotiation: the server must keep sending the legacy `companionId` / `customCompanionId` split for clients that predate the projection. `CompanionWireSelection.FromPersisted` is therefore unchanged in Phase 1 and revisited in Phase 3. `isBrmbleClient` carries no such constraint — no existing client distinguishes `false` from absent — so widening it now is safe.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/Brmble.Server/Events/ISessionMappingService.cs` | *Modify* — `SessionMapping.IsBrmbleClient` becomes `bool?`; interface gains `InstanceId`, `Revision` |
| `src/Brmble.Server/Events/SessionMappingService.cs` | *Modify* — revision increment on every successful mutation |
| `src/Brmble.Server/Events/MappingEnvelope.cs` | *Create* — the `(instanceId, revision)` stamp |
| `src/Brmble.Server/Events/IMappingEventPublisher.cs` | *Create* — interface for ordered mutate-then-broadcast |
| `src/Brmble.Server/Events/MappingEventPublisher.cs` | *Create* — implementation holding the ordering lock |
| `src/Brmble.Server/Events/SessionMappingHandler.cs` | *Modify* — publish `null` not `false`; route through publisher |
| `src/Brmble.Server/Auth/AuthService.cs` | *Modify* — activation/deactivation through publisher |
| `src/Brmble.Server/Auth/AuthEndpoints.cs` | *Modify* — companion change through publisher; stamp `/auth/token` snapshot |
| `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs` | *Modify* — deletion broadcast through publisher |
| `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs` | *Modify* — stamp snapshot, fix read loop, handle `requestSnapshot` |
| `src/Brmble.Server/Mumble/MumbleExtensions.cs` | *Modify* — register `IMappingEventPublisher` |

---

## Task 1: Revision counter and instance id

**Files:**
- Modify: `src/Brmble.Server/Events/ISessionMappingService.cs`
- Modify: `src/Brmble.Server/Events/SessionMappingService.cs`
- Test: `tests/Brmble.Server.Tests/Events/SessionMappingServiceTests.cs`

- [ ] **Step 1: Write the failing tests**

Append these to `SessionMappingServiceTests.cs`, inside the existing `SessionMappingServiceTests` class:

```csharp
    [TestMethod]
    public void Revision_StartsAtZeroAndIncrementsOnEverySuccessfulMutation()
    {
        Assert.AreEqual(0L, _svc.Revision);

        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        Assert.AreEqual(1L, _svc.Revision);

        _svc.TryUpdateCompanionId(1, "retro");
        Assert.AreEqual(2L, _svc.Revision);

        _svc.TryUpdateBrmbleStatus(1, true);
        Assert.AreEqual(3L, _svc.Revision);

        _svc.TryUpdateCertHash(1, "abc");
        Assert.AreEqual(4L, _svc.Revision);

        _svc.TryUpdateCompanionIdIfOwnedBy(1, 1L, "pip");
        Assert.AreEqual(5L, _svc.Revision);

        _svc.RemoveSession(1);
        Assert.AreEqual(6L, _svc.Revision);
    }

    [TestMethod]
    public void Revision_DoesNotIncrementWhenMutationDoesNotApply()
    {
        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        var before = _svc.Revision;

        // Session 99 has no mapping, so none of these change anything.
        Assert.IsFalse(_svc.TryUpdateCompanionId(99, "retro"));
        Assert.IsFalse(_svc.TryUpdateBrmbleStatus(99, true));
        Assert.IsFalse(_svc.TryUpdateCertHash(99, "abc"));
        _svc.RemoveSession(99);

        // A CAS whose expected value does not match must not bump either.
        Assert.IsFalse(_svc.TryUpdateCompanionIdIfCurrent(1, "notthecurrentone", "pip"));

        // Nor one whose owning userId does not match.
        Assert.IsFalse(_svc.TryUpdateCompanionIdIfOwnedBy(1, 999L, "pip"));

        Assert.AreEqual(before, _svc.Revision);
    }

    [TestMethod]
    public void InstanceId_IsStableWithinAnInstanceAndDiffersAcrossInstances()
    {
        var first = _svc.InstanceId;

        _svc.TryAddMatrixUser(1, "@1:server", "Alice", 1L, "bee");
        Assert.AreEqual(first, _svc.InstanceId, "InstanceId must not change while the process lives");
        Assert.IsFalse(string.IsNullOrWhiteSpace(first));

        var replacement = new SessionMappingService();
        Assert.AreNotEqual(first, replacement.InstanceId, "a restart must be observable");
        Assert.AreEqual(0L, replacement.Revision);
    }

    [TestMethod]
    public void Revision_IsMonotonicUnderConcurrentMutations()
    {
        for (var i = 0; i < 200; i++)
            _svc.TryAddMatrixUser(i, $"@{i}:server", $"U{i}", i, "bee");

        Parallel.For(0, 200, i => _svc.TryUpdateCompanionId(i, "retro"));

        // 200 adds + 200 updates, none of them lost to a read-modify-write race.
        Assert.AreEqual(400L, _svc.Revision);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SessionMappingServiceTests"`

Expected: FAIL — compile error, `'ISessionMappingService' does not contain a definition for 'Revision'`.

- [ ] **Step 3: Add the members to the interface**

In `src/Brmble.Server/Events/ISessionMappingService.cs`, add to the `ISessionMappingService` interface, above `SetNameForSession`:

```csharp
    /// <summary>
    /// Identifies this process's mapping table. Regenerated on every start, so a client that
    /// sees a different value knows the server restarted and its cached server-owned fields
    /// are worthless.
    /// </summary>
    string InstanceId { get; }

    /// <summary>
    /// Monotonic counter, incremented once per successful mutation. Stamped on every payload so
    /// a client can detect a gap (revision > last + 1) and request a snapshot.
    /// </summary>
    long Revision { get; }
```

- [ ] **Step 4: Implement in the service**

In `src/Brmble.Server/Events/SessionMappingService.cs`, add these fields directly below the existing `_userIdToSession` field:

```csharp
    private readonly string _instanceId = Guid.NewGuid().ToString("N");
    private long _revision;

    public string InstanceId => _instanceId;

    public long Revision => Interlocked.Read(ref _revision);

    private void Bump() => Interlocked.Increment(ref _revision);
```

Now call `Bump()` from each mutation, **only on the path that actually changed something**:

In `TryAddMatrixUser`, inside the `if (_sessionToMapping.TryAdd(...))` block, before `return true;`:

```csharp
            _userIdToSession[userId] = sessionId;
            Bump();
            return true;
```

In `RemoveSession`, replace the body with:

```csharp
    public void RemoveSession(int sessionId)
    {
        var changed = false;
        if (_sessionToMapping.TryRemove(sessionId, out var mapping))
        {
            // Only remove userId→session if it still points to this session
            ((ICollection<KeyValuePair<long, int>>)_userIdToSession)
                .Remove(new KeyValuePair<long, int>(mapping.UserId, sessionId));
            changed = true;
        }
        if (_sessionToName.TryRemove(sessionId, out var name))
        {
            // Only remove name→session if it still points to this session
            // (a newer session may have claimed the same name)
            ((ICollection<KeyValuePair<string, int>>)_nameToSession)
                .Remove(new KeyValuePair<string, int>(name, sessionId));
        }
        if (changed) Bump();
    }
```

In `TryUpdateBrmbleStatus`, `TryUpdateCompanionId` and `TryUpdateCertHash`, add `Bump();` immediately before each `return true;`.

`TryUpdateCompanionId` and `TryUpdateBrmbleStatus` currently use a non-atomic read-modify-write (`_sessionToMapping[sessionId] = existing with {...}`), which the concurrency test in Step 1 would expose. Replace both bodies with a CAS loop. `TryUpdateCompanionId` becomes:

```csharp
    public bool TryUpdateCompanionId(int sessionId, string companionId)
    {
        while (_sessionToMapping.TryGetValue(sessionId, out var existing))
        {
            var updated = existing with { CompanionId = companionId };
            if (_sessionToMapping.TryUpdate(sessionId, updated, existing))
            {
                Bump();
                return true;
            }
        }

        return false;
    }
```

`TryUpdateBrmbleStatus` becomes the same shape with `IsBrmbleClient = isBrmbleClient`, and `TryUpdateCertHash` the same shape with `CertHash = certHash`.

In `TryUpdateCompanionIdIfCurrent` and `TryUpdateCompanionIdIfOwnedBy`, add `Bump();` immediately before each existing `return true;` inside the `if (_sessionToMapping.TryUpdate(...))` block. Both are already CAS loops, so they need no other change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SessionMappingServiceTests"`

Expected: PASS, all tests in the class.

- [ ] **Step 6: Run the whole server suite for regressions**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS. If a test double implements `ISessionMappingService` by hand it will now fail to compile — add `public string InstanceId => "test";` and `public long Revision => 0;` to it. Moq-generated mocks need no change.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Events/ tests/Brmble.Server.Tests/Events/
git commit -m "feat: add instance id and revision counter to session mappings"
```

---

## Task 2: Tri-state isBrmbleClient

**Files:**
- Modify: `src/Brmble.Server/Events/ISessionMappingService.cs`
- Modify: `src/Brmble.Server/Events/SessionMappingHandler.cs`
- Test: `tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs`

**Why:** `SessionMappingHandler` reads the flag from `IActiveBrmbleSessions`, which is in-memory and wiped by a restart. It currently publishes `false` — a positive assertion of the wrong value — when the truthful answer is "not known yet". Only a WebSocket registration proves `true`, and only an observed deactivation proves `false`.

- [ ] **Step 1: Write the failing test**

Append to the existing test class in `tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs`:

```csharp
    [TestMethod]
    public async Task OnUserConnected_PublishesUnknownBrmbleStatusWhenNoActiveSession()
    {
        // No WebSocket has registered for this cert, so IActiveBrmbleSessions returns false.
        // That is absence of evidence, not evidence of absence: it must go out as null.
        await _handler.OnUserConnected(new MumbleUser
        {
            SessionId = 42,
            Name = "Alice",
            CertHash = "cert-alice"
        });

        var payload = _eventBus.Broadcasts.Single(p =>
            JsonSerializer.Serialize(p).Contains("\"type\":\"userMappingAdded\""));
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.AreEqual(JsonValueKind.Null,
            doc.RootElement.GetProperty("isBrmbleClient").ValueKind);
    }

    [TestMethod]
    public async Task OnUserConnected_PublishesTrueWhenSessionIsKnownActive()
    {
        _activeSessions.Activate("cert-alice");

        await _handler.OnUserConnected(new MumbleUser
        {
            SessionId = 42,
            Name = "Alice",
            CertHash = "cert-alice"
        });

        var payload = _eventBus.Broadcasts.Single(p =>
            JsonSerializer.Serialize(p).Contains("\"type\":\"userMappingAdded\""));
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));

        Assert.IsTrue(doc.RootElement.GetProperty("isBrmbleClient").GetBoolean());
    }
```

Read the top of the existing file first and reuse whatever fixture fields it already defines for the handler, event bus and active sessions. If the existing fixture names differ from `_handler`, `_eventBus.Broadcasts` and `_activeSessions`, adapt these two tests to match rather than introducing a second fixture. Add `using System.Text.Json;` if absent.

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SessionMappingHandlerTests"`

Expected: FAIL — `Assert.AreEqual failed. Expected:<Null>. Actual:<False>`.

- [ ] **Step 3: Widen the record**

In `src/Brmble.Server/Events/ISessionMappingService.cs`, change the record and the mutation signature:

```csharp
public record SessionMapping(string MatrixUserId, string MumbleName, long UserId, string CompanionId, bool? IsBrmbleClient = null, string? CertHash = null);
```

and in the interface:

```csharp
    bool TryUpdateBrmbleStatus(int sessionId, bool? isBrmbleClient);
```

Update the implementation signature in `SessionMappingService.cs` to match (`bool? isBrmbleClient`). The CAS body from Task 1 needs no other change.

- [ ] **Step 4: Publish unknown instead of false**

In `src/Brmble.Server/Events/SessionMappingHandler.cs`, replace line 38:

```csharp
        // A registered WebSocket proves true. Nothing proves false here: after a restart
        // _activeSessions is empty, so "not active" only means "not known yet". Publishing
        // false would assert something we cannot know, and clients would believe it.
        bool? isBrmbleClient = _activeSessions.IsBrmbleClient(user.CertHash) ? true : null;
```

The rest of the method needs no change: `TryUpdateBrmbleStatus` now takes `bool?`, and the anonymous payload picks up `isBrmbleClient` as `bool?`, which `System.Text.Json` serialises as `null`.

- [ ] **Step 5: Run to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SessionMappingHandlerTests"`

Expected: PASS.

- [ ] **Step 6: Fix the fallout and run everything**

Run: `dotnet build`

`BrmbleWebSocketHandler.CreateUserMappingAddedPayload` hardcodes `isBrmbleClient = true`, which stays correct — that path runs only when a socket has registered. Any test asserting `isBrmbleClient = false` in a `userMappingAdded` payload must be updated to expect `null`; that is the intended behaviour change.

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/ tests/Brmble.Server.Tests/
git commit -m "fix: publish unknown brmble status instead of asserting false"
```

---

## Task 3: Ordered mutate-then-broadcast publisher

**Files:**
- Create: `src/Brmble.Server/Events/MappingEnvelope.cs`
- Create: `src/Brmble.Server/Events/IMappingEventPublisher.cs`
- Create: `src/Brmble.Server/Events/MappingEventPublisher.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`
- Test: `tests/Brmble.Server.Tests/Events/MappingEventPublisherTests.cs` (create)

**Why:** Revision order must match delivery order, or a client will discard a newer payload as a duplicate. Mutations and broadcasts currently happen as two separate statements in five different files, so two threads can interleave them. `BroadcastCoreAsync` enqueues synchronously and does no socket I/O, so holding a short lock across the call is safe and sufficient.

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Server.Tests/Events/MappingEventPublisherTests.cs`:

```csharp
using System.Text.Json;
using Brmble.Server.Events;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class MappingEventPublisherTests
{
    private SessionMappingService _mappings = null!;
    private RecordingEventBus _bus = null!;
    private MappingEventPublisher _publisher = null!;

    [TestInitialize]
    public void Setup()
    {
        _mappings = new SessionMappingService();
        _bus = new RecordingEventBus();
        _publisher = new MappingEventPublisher(_mappings, _bus);
        _mappings.TryAddMatrixUser(1, "@alice:test", "Alice", 1L, "floppy");
    }

    [TestMethod]
    public async Task PublishAsync_StampsPayloadWithInstanceIdAndPostMutationRevision()
    {
        await _publisher.PublishAsync(
            () => _mappings.TryUpdateCompanionId(1, "retro"),
            envelope => new { type = "companionChanged", instanceId = envelope.InstanceId, revision = envelope.Revision });

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(_bus.Broadcasts.Single()));
        Assert.AreEqual(_mappings.InstanceId, doc.RootElement.GetProperty("instanceId").GetString());
        Assert.AreEqual(_mappings.Revision, doc.RootElement.GetProperty("revision").GetInt64());
    }

    [TestMethod]
    public async Task PublishAsync_DoesNotBroadcastWhenMutationReportsNoChange()
    {
        await _publisher.PublishAsync(
            () => _mappings.TryUpdateCompanionId(999, "retro"),
            envelope => new { type = "companionChanged", instanceId = envelope.InstanceId, revision = envelope.Revision });

        Assert.AreEqual(0, _bus.Broadcasts.Count);
    }

    [TestMethod]
    public async Task PublishAsync_DeliversInRevisionOrderUnderConcurrency()
    {
        await Task.WhenAll(Enumerable.Range(0, 100).Select(i => Task.Run(() =>
            _publisher.PublishAsync(
                () => _mappings.TryUpdateCompanionId(1, $"c{i}"),
                envelope => new { type = "companionChanged", instanceId = envelope.InstanceId, revision = envelope.Revision }))));

        var revisions = _bus.Broadcasts
            .Select(p => JsonDocument.Parse(JsonSerializer.Serialize(p))
                .RootElement.GetProperty("revision").GetInt64())
            .ToList();

        Assert.AreEqual(100, revisions.Count);
        CollectionAssert.AreEqual(revisions.OrderBy(r => r).ToList(), revisions,
            "enqueue order must match revision order, or clients discard newer payloads as duplicates");
    }

    private sealed class RecordingEventBus : IBrmbleEventBus
    {
        private readonly object _gate = new();
        public List<object> Broadcasts { get; } = new();

        public Task BroadcastAsync(object message)
        {
            // Mirrors BrmbleEventBus: admission happens synchronously on the calling thread.
            lock (_gate) Broadcasts.Add(message);
            return Task.CompletedTask;
        }

        public Task BroadcastToChannelAsync(int channelId, object message) => BroadcastAsync(message);
        public Task BroadcastExceptAsync(System.Net.WebSockets.WebSocket excluded, object message) => BroadcastAsync(message);
        public Task AddClientAsync(System.Net.WebSockets.WebSocket socket, long userId, Func<Task<IReadOnlyList<object>>> initialPayloads) => Task.CompletedTask;
        public void RemoveClient(System.Net.WebSockets.WebSocket socket) { }
        public bool HasConnectedClient(long userId) => false;
    }
}
```

`RecordingEventBus` must implement every member of `IBrmbleEventBus`. Open `src/Brmble.Server/Events/IBrmbleEventBus.cs` and add stubs for any member not listed above.

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MappingEventPublisherTests"`

Expected: FAIL — compile error, `The type or namespace name 'MappingEventPublisher' could not be found`.

- [ ] **Step 3: Create the envelope**

Create `src/Brmble.Server/Events/MappingEnvelope.cs`:

```csharp
namespace Brmble.Server.Events;

/// <summary>
/// Stamped on every session-mapping payload so a client can tell a restart from a gap.
/// </summary>
/// <param name="InstanceId">Identifies the server's mapping table; changes on restart.</param>
/// <param name="Revision">The table revision produced by the mutation being announced.</param>
public readonly record struct MappingEnvelope(string InstanceId, long Revision);
```

- [ ] **Step 4: Create the interface**

Create `src/Brmble.Server/Events/IMappingEventPublisher.cs`:

```csharp
namespace Brmble.Server.Events;

public interface IMappingEventPublisher
{
    /// <summary>
    /// Runs <paramref name="mutate"/> and, only if it reports a change, broadcasts the payload
    /// built from the resulting envelope. Mutation and broadcast admission happen under one
    /// lock, so revision order always matches delivery order.
    /// </summary>
    /// <param name="mutate">Performs the mutation; returns false if nothing changed.</param>
    /// <param name="payload">Builds the payload from the post-mutation envelope.</param>
    Task PublishAsync(Func<bool> mutate, Func<MappingEnvelope, object> payload);
}
```

- [ ] **Step 5: Create the implementation**

Create `src/Brmble.Server/Events/MappingEventPublisher.cs`:

```csharp
namespace Brmble.Server.Events;

public sealed class MappingEventPublisher(
    ISessionMappingService mappings,
    IBrmbleEventBus eventBus) : IMappingEventPublisher
{
    private readonly object _gate = new();

    public Task PublishAsync(Func<bool> mutate, Func<MappingEnvelope, object> payload)
    {
        Task send;
        lock (_gate)
        {
            if (!mutate()) return Task.CompletedTask;

            var envelope = new MappingEnvelope(mappings.InstanceId, mappings.Revision);

            // Safe under the lock: BrmbleEventBus.BroadcastCoreAsync is deliberately not async
            // and enqueues to every per-socket queue before returning, so no socket I/O happens
            // here. Awaiting inside the lock would be wrong; capturing the task is not.
            send = eventBus.BroadcastAsync(payload(envelope));
        }

        return send;
    }
}
```

- [ ] **Step 6: Register it**

In `src/Brmble.Server/Mumble/MumbleExtensions.cs`, beside the existing `IChannelMembershipService` registration:

```csharp
        services.AddSingleton<IMappingEventPublisher, MappingEventPublisher>();
```

Add `using Brmble.Server.Events;` if it is not already present.

- [ ] **Step 7: Run to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MappingEventPublisherTests"`

Expected: PASS, three tests.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Server/Events/ src/Brmble.Server/Mumble/MumbleExtensions.cs tests/Brmble.Server.Tests/Events/MappingEventPublisherTests.cs
git commit -m "feat: add ordered mutate-then-broadcast publisher for session mappings"
```

---

## Task 4: Route every mapping broadcast through the publisher

**Files:**
- Modify: `src/Brmble.Server/Events/SessionMappingHandler.cs`
- Modify: `src/Brmble.Server/Auth/AuthService.cs:259-268` and `:282-290`
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs` (`PersistCompanionSelectionAsync`)
- Modify: `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs:68-82`
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs:197` (`userMappingRemoved`)
- Test: `tests/Brmble.Server.Tests/Events/MappingPayloadEnvelopeTests.cs` (create)

**Why:** A client applies `revision == last + 1` and treats anything higher as a gap. If even one producer omits the envelope, every client resyncs on it forever.

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Server.Tests/Events/MappingPayloadEnvelopeTests.cs`:

```csharp
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Events;

/// <summary>
/// Every session-mapping payload must carry the envelope. A producer that forgets it makes
/// every connected client detect a permanent gap and resync in a loop.
/// </summary>
[TestClass]
public class MappingPayloadEnvelopeTests
{
    private static readonly string[] MappingEventTypes =
    {
        "userMappingAdded",
        "userMappingRemoved",
        "brmbleClientActivated",
        "brmbleClientDeactivated",
        "companionChanged",
        "sessionMappingSnapshot"
    };

    [TestMethod]
    public void EveryMappingEventTypeIsCoveredByAnEnvelopeAssertion()
    {
        // Guards against a new mapping event being added without an envelope test.
        // Update this list and add a matching assertion in the suites listed in the plan.
        Assert.AreEqual(6, MappingEventTypes.Length);
    }

    internal static void AssertHasEnvelope(object payload, string expectedType)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        Assert.AreEqual(expectedType, doc.RootElement.GetProperty("type").GetString());
        Assert.IsTrue(doc.RootElement.TryGetProperty("instanceId", out var instanceId),
            $"{expectedType} is missing instanceId");
        Assert.IsFalse(string.IsNullOrWhiteSpace(instanceId.GetString()),
            $"{expectedType} has a blank instanceId");
        Assert.IsTrue(doc.RootElement.TryGetProperty("revision", out var revision),
            $"{expectedType} is missing revision");
        Assert.IsTrue(revision.GetInt64() > 0,
            $"{expectedType} must carry the post-mutation revision");
    }
}
```

Then add an envelope assertion to each existing suite that already captures a broadcast:

- In `SessionMappingHandlerTests`, in the `userMappingAdded` test from Task 2, add:
  `MappingPayloadEnvelopeTests.AssertHasEnvelope(payload, "userMappingAdded");`
- In `AuthEndpointsCompanionTests.PostAuthCompanion_PersistsAndBroadcastsToAllClients`, capture the broadcast argument and assert the same for `"companionChanged"`.
- In `CustomCompanionDeletionTests.Delete_ActiveRecordBroadcastsFloppyChangeToAllClients`, likewise.

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MappingPayloadEnvelopeTests|FullyQualifiedName~SessionMappingHandlerTests"`

Expected: FAIL — `userMappingAdded is missing instanceId`.

- [ ] **Step 3: Convert SessionMappingHandler**

Inject `IMappingEventPublisher publisher` into the constructor and store it as `_publisher`. Then replace the broadcast block in `OnUserConnected` (currently lines 47-67) with:

```csharp
        var wire = CompanionWireSelection.FromPersisted(companionId);
        await _publisher.PublishAsync(
            // The mapping mutations above already happened; this announcement is unconditional.
            () => true,
            envelope => new
            {
                type = "userMappingAdded",
                instanceId = envelope.InstanceId,
                revision = envelope.Revision,
                sessionId = user.SessionId,
                matrixUserId = dbUser.MatrixUserId,
                mumbleName = user.Name,
                companionId = wire.CompanionId,
                customCompanionId = wire.CustomCompanionId,
                certHash = user.CertHash,
                isBrmbleClient
            });

        if (!mappingAdded && isBrmbleClient == true)
        {
            await _publisher.PublishAsync(
                () => true,
                envelope => new
                {
                    type = "brmbleClientActivated",
                    instanceId = envelope.InstanceId,
                    revision = envelope.Revision,
                    sessionId = user.SessionId
                });
        }
```

- [ ] **Step 4: Convert the other four producers**

Apply the same shape in each place. The `mutate` lambda is the existing mutation call, so the broadcast is skipped when nothing changed:

`AuthService.cs:260-268` becomes:

```csharp
        _ = _publisher.PublishAsync(
            () => _sessionMapping.TryGetSessionByUserId(user!.Id, out activatedSessionId)
                  && _sessionMapping.TryUpdateBrmbleStatus(activatedSessionId, true),
            envelope => new
            {
                type = "brmbleClientActivated",
                instanceId = envelope.InstanceId,
                revision = envelope.Revision,
                sessionId = activatedSessionId
            });
```

Declare `var activatedSessionId = 0;` above the call, since it is now assigned inside the lambda.

`AuthService.cs:282-290` becomes the same shape with `TryGetSessionId(name, out deactivatedSessionId)`, `TryUpdateBrmbleStatus(deactivatedSessionId, false)` — note `false` here is *knowledge*, not a default — and `type = "brmbleClientDeactivated"`.

`AuthEndpoints.PersistCompanionSelectionAsync` becomes:

```csharp
        var sessionId = 0;
        await publisher.PublishAsync(
            () => sessionMapping.TryGetMappingByUserId(user.Id, out sessionId, out _)
                  && sessionMapping.TryUpdateCompanionIdIfOwnedBy(sessionId, user.Id, companionId),
            envelope =>
            {
                var wire = CompanionWireSelection.FromPersisted(companionId);
                return new
                {
                    type = "companionChanged",
                    instanceId = envelope.InstanceId,
                    revision = envelope.Revision,
                    sessionId,
                    matrixUserId = user.MatrixUserId,
                    companionId = wire.CompanionId,
                    customCompanionId = wire.CustomCompanionId
                };
            });
```

Keep `TryUpdateCompanionIdIfOwnedBy` — do not revert it to `TryUpdateCompanionId`. It is a CAS on the owning userId that stops a session recycled between the lookup and the write from having the new owner's companion overwritten.

Add `IMappingEventPublisher publisher` to the `/auth/companion` endpoint's DI parameters and to `PersistCompanionSelectionAsync`'s signature, replacing `IBrmbleEventBus eventBus` if it becomes unused.

`CustomCompanionEndpoints` deletion. `cd7b48fa` restructured this into "mutate inside the coordinator lock, collect, broadcast after". Preserve that shape — but note the publisher must do the *mutation* too, since it is the mutation that assigns the revision. Collect the returned tasks and await them after the lock releases.

Replace the `resetSessions` declaration (`CustomCompanionEndpoints.cs:41`), the `resetSessions.Add(...)` call at `:75`, and the broadcast loop at `:83-95` with:

```csharp
            var sends = new List<Task>();

            using (await eventCoordinator.AcquireAsync(eventId, httpContext.RequestAborted))
            {
                // ... unchanged: record lookup, redaction, MarkDeletedAsync, ResetSelectionsAsync ...

                foreach (var affectedUserId in affectedUserIds)
                {
                    if (!sessionMapping.TryGetMappingByUserId(affectedUserId, out var sessionId, out var mapping)
                        || mapping is null)
                    {
                        continue;
                    }

                    // PublishAsync returns as soon as the payload is enqueued, so the
                    // coordinator lock is not held across the fan-out. Awaiting these here
                    // would reintroduce exactly what cd7b48fa removed.
                    sends.Add(publisher.PublishAsync(
                        () => sessionMapping.TryUpdateCompanionIdIfCurrent(
                            sessionId, deletedCompanionId, "floppy"),
                        envelope => new
                        {
                            type = "companionChanged",
                            instanceId = envelope.InstanceId,
                            revision = envelope.Revision,
                            sessionId,
                            matrixUserId = mapping.MatrixUserId,
                            companionId = "floppy",
                            customCompanionId = (string?)null
                        }));
                }
            }

            await Task.WhenAll(sends);
            return Results.NoContent();
```

Add `IMappingEventPublisher publisher` to the DELETE endpoint's DI parameters and remove `IBrmbleEventBus eventBus` if it becomes unused.

`MumbleServerCallback.cs:197` becomes:

```csharp
        await _publisher.PublishAsync(
            () => true,   // RemoveSession already ran and bumped the revision
            envelope => new
            {
                type = "userMappingRemoved",
                instanceId = envelope.InstanceId,
                revision = envelope.Revision,
                sessionId = user.SessionId
            });
```

Inject `IMappingEventPublisher` into `MumbleServerCallback`'s constructor as `_publisher`, following the existing `_eventBus` field pattern.

- [ ] **Step 5: Run to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS. Tests that assert an exact serialised payload string will fail on the two new properties — update those expected strings to include `instanceId` and `revision`.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/ tests/Brmble.Server.Tests/
git commit -m "feat: stamp every session mapping event with instance id and revision"
```

---

## Task 5: Stamp snapshots and handle requestSnapshot

**Files:**
- Modify: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs:203-215`
- Test: `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs`

**Why:** A snapshot is what repairs a client after a gap, so it must carry the envelope it is repairing *to*. And the read loop currently discards everything that is not a Close frame, using a 1024-byte buffer and ignoring `EndOfMessage`, so a client has no way to ask.

- [ ] **Step 1: Write the failing tests**

Append to `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs`:

```csharp
    [TestMethod]
    public async Task BuildInitialPayloadsAsync_StampsSnapshotWithEnvelope()
    {
        var mappings = new SessionMappingService();
        mappings.TryAddMatrixUser(42, "@alice:test", "Alice", 1L, "floppy");

        var payloads = await BrmbleWebSocketHandler.BuildInitialPayloadsAsync(
            new StubDuelSnapshotProvider(), 0, mappings.GetSnapshot(),
            new MappingEnvelope(mappings.InstanceId, mappings.Revision));

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payloads[0]));
        Assert.AreEqual("sessionMappingSnapshot", doc.RootElement.GetProperty("type").GetString());
        Assert.AreEqual(mappings.InstanceId, doc.RootElement.GetProperty("instanceId").GetString());
        Assert.AreEqual(mappings.Revision, doc.RootElement.GetProperty("revision").GetInt64());
    }

    [TestMethod]
    public void TryParseClientMessage_RecognisesRequestSnapshot()
    {
        Assert.IsTrue(BrmbleWebSocketHandler.TryParseClientMessage(
            "{\"type\":\"requestSnapshot\"}", out var type));
        Assert.AreEqual("requestSnapshot", type);
    }

    [TestMethod]
    public void TryParseClientMessage_RejectsGarbageWithoutThrowing()
    {
        Assert.IsFalse(BrmbleWebSocketHandler.TryParseClientMessage("not json", out _));
        Assert.IsFalse(BrmbleWebSocketHandler.TryParseClientMessage("{}", out _));
        Assert.IsFalse(BrmbleWebSocketHandler.TryParseClientMessage("", out _));
    }
```

Reuse whatever duel-snapshot stub the file already defines; if there is none, add a minimal `StubDuelSnapshotProvider` implementing `IDuelSnapshotProvider`.

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleWebSocketHandlerTests"`

Expected: FAIL — compile error, no overload of `BuildInitialPayloadsAsync` takes 4 arguments.

- [ ] **Step 3: Stamp the snapshot**

In `BrmbleWebSocketHandler.cs`, change `BuildInitialPayloadsAsync` to accept the envelope and include it:

```csharp
    internal static async Task<IReadOnlyList<object>> BuildInitialPayloadsAsync(
        IDuelSnapshotProvider snapshots,
        long sessionId,
        IReadOnlyDictionary<int, SessionMapping> mappings,
        MappingEnvelope envelope)
    {
        var snapshot = mappings.ToDictionary(
            kvp => kvp.Key.ToString(),
            kvp =>
            {
                var wire = CompanionWireSelection.FromPersisted(kvp.Value.CompanionId);
                return new
                {
                    matrixUserId = kvp.Value.MatrixUserId,
                    mumbleName = kvp.Value.MumbleName,
                    companionId = wire.CompanionId,
                    customCompanionId = wire.CustomCompanionId,
                    certHash = kvp.Value.CertHash,
                    isBrmbleClient = kvp.Value.IsBrmbleClient,
                };
            });
        var initial = new List<object>
        {
            new
            {
                type = "sessionMappingSnapshot",
                instanceId = envelope.InstanceId,
                revision = envelope.Revision,
                mappings = snapshot
            }
        };
        if (sessionId != 0)
            initial.Add(DuelWire.ToEvent(await snapshots.GetSnapshotForSessionAsync(sessionId)));
        return initial;
    }
```

Update the call in `InitializeAcceptedClientAsync` to pass
`new MappingEnvelope(sessionMapping.InstanceId, sessionMapping.Revision)`.

Apply the same two properties to the `/auth/token` response in `AuthEndpoints.cs:203-215`, adding `instanceId` and `revision` beside `sessionMappings`, read from the injected `ISessionMappingService`.

- [ ] **Step 4: Add the message parser**

Add to `BrmbleWebSocketHandler`:

```csharp
    /// <summary>
    /// Parses a client-to-server frame. Returns false for anything unparseable rather than
    /// throwing: a malformed frame must never take the socket down.
    /// </summary>
    internal static bool TryParseClientMessage(string json, out string type)
    {
        type = string.Empty;
        if (string.IsNullOrWhiteSpace(json)) return false;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty("type", out var typeProperty)) return false;
            if (typeProperty.ValueKind != JsonValueKind.String) return false;
            type = typeProperty.GetString() ?? string.Empty;
            return type.Length > 0;
        }
        catch (JsonException)
        {
            return false;
        }
    }
```

Add `using System.Text.Json;` at the top.

- [ ] **Step 5: Fix the read loop and serve the request**

Replace the read loop (lines 46-56) with one that reassembles multi-frame messages and caps their size:

```csharp
            // Read loop until close. Messages are reassembled across frames; anything larger
            // than the cap is discarded rather than buffered, so a client cannot exhaust memory.
            const int MaxClientMessageBytes = 8 * 1024;
            var buffer = new byte[1024];
            var accumulated = new MemoryStream();
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, context.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                    break;
                }

                if (accumulated.Length + result.Count <= MaxClientMessageBytes)
                    accumulated.Write(buffer, 0, result.Count);

                if (!result.EndOfMessage) continue;

                var json = System.Text.Encoding.UTF8.GetString(accumulated.ToArray());
                accumulated.SetLength(0);

                if (!TryParseClientMessage(json, out var messageType)) continue;
                if (messageType != "requestSnapshot") continue;

                sessionMapping.TryGetSessionByUserId(user.Id, out var resyncSessionId);
                var payloads = await BuildInitialPayloadsAsync(
                    context.RequestServices.GetRequiredService<IDuelSnapshotProvider>(),
                    resyncSessionId,
                    sessionMapping.GetSnapshot(),
                    new MappingEnvelope(sessionMapping.InstanceId, sessionMapping.Revision));

                foreach (var payload in payloads)
                    await eventBus.SendToClientAsync(ws, payload);
            }
```

`IBrmbleEventBus` has no public single-client send. Add one, mirroring the existing private `SendToClient`:

```csharp
    // IBrmbleEventBus.cs
    Task SendToClientAsync(System.Net.WebSockets.WebSocket socket, object message);
```

```csharp
    // BrmbleEventBus.cs — beside BroadcastAsync
    public Task SendToClientAsync(WebSocket socket, object message) =>
        SendToClient(socket, Serialize(message), default);
```

Add the stub to `RecordingEventBus` in `MappingEventPublisherTests` and to any other hand-written `IBrmbleEventBus` double.

- [ ] **Step 6: Run to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleWebSocketHandlerTests"`

Expected: PASS.

- [ ] **Step 7: Full verification**

```bash
dotnet build
dotnet test
```

Expected: build clean with 0 warnings; all four test projects pass.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Server/ tests/Brmble.Server.Tests/
git commit -m "feat: stamp mapping snapshots and serve client resync requests"
```

---

## Done when

- [ ] `dotnet build` is clean with 0 warnings
- [ ] `dotnet test` passes in all four projects
- [ ] Every one of the six mapping payload types carries `instanceId` and `revision`
- [ ] **Every revision bump is announced.** Cross-check each `Bump()` call site against a producer that broadcasts a stamped payload. A bump nobody hears manufactures a phantom gap in every connected client, which is worse than not bumping at all. In particular `RemoveSession` bumps, so `userMappingRemoved` (`MumbleServerCallback.cs:197`) must go through the publisher — it is not made redundant by snapshot reconciliation
- [ ] `userMappingAdded` carries `isBrmbleClient: null` when no socket has registered
- [ ] A `{"type":"requestSnapshot"}` frame returns a stamped `sessionMappingSnapshot`
- [ ] An existing client build still connects and behaves normally — every change is additive, and the client ignores unknown fields

## Manual smoke test

```bash
cd src/Brmble.Web; npm run build; cd ../..
docker compose -f docker-local/docker-compose.yml up -d --build brmble
dotnet run --project src/Brmble.Client
```

Connect, confirm the user list and companions render as before, then restart only the Brmble container and confirm the client reconnects:

```bash
docker compose -f docker-local/docker-compose.yml restart brmble
```

Phase 1 alone does **not** fix the badge/skin reversion on restart — the client still ignores the new fields. It should, however, be no worse than before. The fix lands in Phase 3.

---

## Next

Phase 2 (`UserProjectionStore`, pure client-side, no wiring) and Phase 3 (`MumbleAdapter` and `App.tsx`) are separate plans, written after this one lands.
