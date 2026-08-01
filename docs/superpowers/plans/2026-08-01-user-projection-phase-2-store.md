# User Projection — Phase 2: `UserProjectionStore` (client) + `baseRevision` (server)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single authoritative client-side projection — a pure, dependency-free `UserProjectionStore` that merges Mumble presence and Brmble identity under two rules (ownership, and null-means-unknown) — and add the `baseRevision` field the server needs for that store to detect gaps correctly.

**Architecture:** The store owns a `Dictionary<uint, UserProjection>` and exposes four `Apply*` methods, one per input source. Each returns a `ChangeSet` describing what moved. It has no Mumble, no HTTP and no JSON dependency: callers translate wire shapes into plain input records first, so the store unit-tests without a protocol stack. Phase 2 builds and tests the store in isolation — **nothing calls it yet**. Wiring is Phase 3.

**Tech Stack:** C# / .NET 10, MSTest. `InternalsVisibleTo` for `Brmble.Client.Tests` is already configured (`src/Brmble.Client/Brmble.Client.csproj:19-21`), so `internal` types are directly testable.

**Spec:** `docs/superpowers/specs/2026-07-31-user-projection-design.md` §3.1, §3.2, §4.2, §4.3, §6.6, §8.

**Depends on:** Phase 1 (`feature/user-projection-phase-1`, HEAD `1f5aa25e`). Confirm before starting:

```powershell
git log --oneline -1                    # expect 1f5aa25e
Select-String -Path src/Brmble.Server/Events/MappingEventPublisher.cs -Pattern PublishExceptAsync
```

Baseline: `dotnet build` clean with 0 warnings, `dotnet test` 1250 passing (Server 777, Client 301, MumbleVoiceEngine 99, Audio 73). Confirm this so you can tell your own failures from pre-existing ones.

---

## Background you need

### Why `baseRevision` exists (Task 1)

Spec §4.2 gives the client these rules: apply when `revision == ours + 1`, treat `revision > ours + 1` as a gap, ignore `revision <= ours`. **Those rules cannot be implemented against Phase 1 as shipped.** One logical operation bumps the counter several times but is announced once — `SessionMappingHandler.OnUserConnected` calls `TryAddMatrixUser`, `TryUpdateCertHash` and `TryUpdateBrmbleStatus` inside a single `PublishAsync`, so a first registration moves the revision `0 → 3` and announces `3`. A client following §4.2 literally would read every normal registration as a gap and resync forever.

Rather than force every operation down to exactly one bump (an invasive server refactor), each event now carries **both** ends of the range it spans:

- `baseRevision` — the table revision *before* this operation's mutations.
- `revision` — the revision *after* them.

The client rule becomes "apply when `baseRevision == ours`", which is insensitive to how many bumps an operation makes:

| Condition | Meaning | Action |
|---|---|---|
| `instanceId` differs | server restarted | drop server-owned fields, request snapshot |
| `baseRevision == ours` | contiguous | apply, set `ours = revision` |
| `baseRevision < ours` | already applied — duplicate or reorder | ignore |
| `baseRevision > ours` | genuine gap | apply nothing, request snapshot |

This also makes the deliberate duplicate in `SessionMappingHandler` correct by construction. The `brmbleClientActivated` there restates a fact the preceding `userMappingAdded` already carries and performs no mutation of its own, so it reuses that payload's captured envelope. Its `baseRevision` is therefore below `ours` by the time it arrives, and the rule above ignores it — which is exactly right, since applying it would be a no-op.

Snapshots do **not** carry `baseRevision`. A snapshot is absolute, not a delta: it sets `ours = revision` outright.

### Two rules the store exists to enforce (Tasks 3-5)

**Ownership (spec §3.2 rule 1).** A Mumble input may only write Mumble-owned fields; a server input only server-owned ones. This is enforced by the *shape of the input types* — `MumbleUserInput` has no `MatrixUserId` field to write, and `ServerMappingEntry` has no `Name` — so a cross-write is a compile error, not a code-review catch.

**Null means unknown (spec §3.2 rule 2).** On a server input, a `null` field leaves the existing value untouched. This is why `isBrmbleClient` can never silently become `false` and a companion can never silently become floppy. Clearing happens only through snapshot reconciliation or an explicit removal. Note the asymmetry: Mumble-owned fields are *not* subject to this rule — Mumble sends complete `UserState` every time, so its values are authoritative including when empty.

### Threading (spec §6.6)

Inputs arrive on three threads: the Mumble protocol thread, the WebSocket read loop, and an HTTP continuation. Every `Apply*` takes one lock, mutates, computes the `ChangeSet`, and releases before returning. The store never invokes a callback or bridge under its lock — it returns data and lets the caller emit. Phase 3 relies on this.

### `certHash` has two sources

Mumble supplies `CertificateHash` on `UserState`; the server supplies `certHash` in mappings. The current code prefers Mumble's (`MumbleAdapter.cs:4190`: `u.CertificateHash ?? sm!.CertHash`). The projection keeps both in separate fields, each written only by its owner, and exposes a computed `CertHash` preserving that precedence. This is what lets a server restart clear its own copy without touching Mumble's.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/Brmble.Server/Events/MappingEnvelope.cs` | *Modify* — gains `BaseRevision` plus a `Snapshot` factory |
| `src/Brmble.Server/Events/MappingEventPublisher.cs` | *Modify* — captures the revision before and after the mutation |
| `src/Brmble.Server/Events/SessionMappingHandler.cs` | *Modify* — stamp `baseRevision` |
| `src/Brmble.Server/Auth/AuthService.cs` | *Modify* — stamp `baseRevision` (2 sites) |
| `src/Brmble.Server/Auth/AuthEndpoints.cs` | *Modify* — stamp `baseRevision` (2 sites); snapshot factory for `/auth/token` |
| `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs` | *Modify* — stamp `baseRevision` |
| `src/Brmble.Server/Mumble/MumbleServerCallback.cs` | *Modify* — stamp `baseRevision` |
| `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs` | *Modify* — stamp `baseRevision` on `userMappingAdded`; snapshot factory |
| `src/Brmble.Client/Services/Voice/Projection/UserProjection.cs` | *Create* — the row record |
| `src/Brmble.Client/Services/Voice/Projection/ProjectionInputs.cs` | *Create* — dependency-free input records |
| `src/Brmble.Client/Services/Voice/Projection/ChangeSet.cs` | *Create* — the output of every `Apply*` |
| `src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs` | *Create* — the store itself |

The namespace is `Brmble.Client.Services.Voice.Projection`, deliberately **not** `...Voice.UserProjection`. A namespace whose last segment matches a type it contains (`UserProjection`) trips CA1724 and can produce a `CS0118 'namespace used like a type'` when the type is referenced from inside that namespace. Do not "tidy" the folder name to match the type.

---

## Task 1: `baseRevision` on the wire

**Files:**
- Modify: `src/Brmble.Server/Events/MappingEnvelope.cs`
- Modify: `src/Brmble.Server/Events/MappingEventPublisher.cs`
- Modify: all seven producers (listed in each step below)
- Test: `tests/Brmble.Server.Tests/Events/MappingPayloadEnvelopeTests.cs`, `tests/Brmble.Server.Tests/Events/MappingEventPublisherTests.cs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/Brmble.Server.Tests/Events/MappingEventPublisherTests.cs`, inside the existing class:

```csharp
    [TestMethod]
    public async Task PublishAsync_StampsTheRevisionRangeTheMutationSpanned()
    {
        // One logical operation may bump several times. baseRevision is the revision before
        // the mutation, revision the one after, so a client can apply on "baseRevision ==
        // ours" without caring how many bumps happened in between.
        var before = _mappings.Revision;

        await _publisher.PublishAsync(
            () =>
            {
                _mappings.TryUpdateCompanionId(1, "retro");
                _mappings.TryUpdateCertHash(1, "abc");
                return true;
            },
            envelope => new
            {
                type = "companionChanged",
                instanceId = envelope.InstanceId,
                baseRevision = envelope.BaseRevision,
                revision = envelope.Revision
            });

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(_bus.Broadcasts.Single()));
        Assert.AreEqual(before, doc.RootElement.GetProperty("baseRevision").GetInt64());
        Assert.AreEqual(before + 2, doc.RootElement.GetProperty("revision").GetInt64());
    }

    [TestMethod]
    public async Task PublishAsync_RangesAreContiguousUnderConcurrency()
    {
        // Each event's baseRevision must equal the previous event's revision, or a client
        // applying on "baseRevision == ours" stalls and resyncs forever.
        await Task.WhenAll(Enumerable.Range(0, 100).Select(i => Task.Run(() =>
            _publisher.PublishAsync(
                () => _mappings.TryUpdateCompanionId(1, $"c{i}"),
                envelope => new
                {
                    type = "companionChanged",
                    instanceId = envelope.InstanceId,
                    baseRevision = envelope.BaseRevision,
                    revision = envelope.Revision
                }))));

        var ranges = _bus.Broadcasts
            .Select(p => JsonDocument.Parse(JsonSerializer.Serialize(p)).RootElement)
            .Select(e => (Base: e.GetProperty("baseRevision").GetInt64(),
                          Rev: e.GetProperty("revision").GetInt64()))
            .ToList();

        Assert.AreEqual(100, ranges.Count);
        for (var i = 1; i < ranges.Count; i++)
            Assert.AreEqual(ranges[i - 1].Rev, ranges[i].Base,
                $"event {i} does not start where event {i - 1} ended");
    }
```

Then tighten the shared assertion in `tests/Brmble.Server.Tests/Events/MappingPayloadEnvelopeTests.cs`. Replace `AssertHasEnvelope` with two methods — snapshots are absolute and carry no `baseRevision`:

```csharp
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
        Assert.IsTrue(doc.RootElement.TryGetProperty("baseRevision", out var baseRevision),
            $"{expectedType} is missing baseRevision, so a client cannot tell a gap from a jump");
        Assert.IsTrue(baseRevision.GetInt64() < revision.GetInt64()
                      || baseRevision.GetInt64() == revision.GetInt64(),
            $"{expectedType} has baseRevision above revision");
    }

    /// <summary>
    /// Snapshots are absolute rather than deltas: they set the client's cursor outright, so
    /// they carry no baseRevision.
    /// </summary>
    internal static void AssertHasSnapshotEnvelope(object payload, string expectedType)
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        Assert.AreEqual(expectedType, doc.RootElement.GetProperty("type").GetString());
        Assert.IsFalse(string.IsNullOrWhiteSpace(
            doc.RootElement.GetProperty("instanceId").GetString()));
        Assert.IsTrue(doc.RootElement.TryGetProperty("revision", out _));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MappingEventPublisherTests"`

Expected: FAIL — compile error, `'MappingEnvelope' does not contain a definition for 'BaseRevision'`.

- [ ] **Step 3: Widen the envelope**

Replace the body of `src/Brmble.Server/Events/MappingEnvelope.cs`:

```csharp
namespace Brmble.Server.Events;

/// <summary>
/// Stamped on every session-mapping payload so a client can tell a restart from a gap.
/// </summary>
/// <param name="InstanceId">Identifies the server's mapping table; changes on restart.</param>
/// <param name="Revision">The table revision after the mutation being announced.</param>
/// <param name="BaseRevision">
/// The table revision before it. One logical operation may bump the counter several times, so a
/// client applies on <c>BaseRevision == ours</c> rather than on <c>Revision == ours + 1</c>.
/// </param>
public readonly record struct MappingEnvelope(string InstanceId, long Revision, long BaseRevision)
{
    /// <summary>
    /// A snapshot is absolute rather than a delta — it sets the client's cursor outright — so it
    /// is its own base.
    /// </summary>
    public static MappingEnvelope Snapshot(string instanceId, long revision) =>
        new(instanceId, revision, revision);
}
```

- [ ] **Step 4: Capture the range in the publisher**

In `src/Brmble.Server/Events/MappingEventPublisher.cs`, replace the `PublishCore` body:

```csharp
    private Task PublishCore(
        Func<bool> mutate,
        Func<MappingEnvelope, object> payload,
        Func<IBrmbleEventBus, object, Task> send,
        IBrmbleEventBus bus)
    {
        Task pending;
        lock (_gate)
        {
            // Read before, mutate, read after — all inside the lock, so the range provably
            // belongs to this mutation and cannot straddle a concurrent one.
            var baseRevision = mappings.Revision;
            if (!mutate()) return Task.CompletedTask;

            var envelope = new MappingEnvelope(mappings.InstanceId, mappings.Revision, baseRevision);

            // Safe under the lock: BrmbleEventBus's broadcast paths are deliberately not async
            // and enqueue to every per-socket queue before returning, so no socket I/O happens
            // here. Awaiting inside the lock would be wrong; capturing the task is not.
            pending = send(bus, payload(envelope));
        }

        return pending;
    }
```

- [ ] **Step 5: Run the publisher tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MappingEventPublisherTests"`

Expected: PASS, five tests.

- [ ] **Step 6: Stamp `baseRevision` on all six event producers**

Each producer already emits `instanceId` and `revision`. Add `baseRevision = envelope.BaseRevision` immediately after `instanceId` in every event payload. The six sites:

1. `src/Brmble.Server/Events/SessionMappingHandler.cs` — the `userMappingAdded` dictionary. Add between `["instanceId"]` and `["revision"]`:

```csharp
                    ["baseRevision"] = envelope.BaseRevision,
```

2. `src/Brmble.Server/Events/SessionMappingHandler.cs` — the `brmbleClientActivated` restatement. It reuses the captured `announced` envelope, so add:

```csharp
                    baseRevision = announced.BaseRevision,
```

3. `src/Brmble.Server/Auth/AuthService.cs` — both `brmbleClientActivated` and `brmbleClientDeactivated`:

```csharp
                baseRevision = envelope.BaseRevision,
```

4. `src/Brmble.Server/Auth/AuthEndpoints.cs` — both branches of the `/auth/token` publish (`userMappingAdded` and `brmbleClientActivated`), and the `companionChanged` in `PersistCompanionSelectionAsync`:

```csharp
                                baseRevision = envelope.BaseRevision,
```

5. `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs` — the `companionChanged` in the deletion loop:

```csharp
                            baseRevision = envelope.BaseRevision,
```

6. `src/Brmble.Server/Mumble/MumbleServerCallback.cs` — `userMappingRemoved`:

```csharp
                baseRevision = envelope.BaseRevision,
```

7. `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs` — `CreateUserMappingAddedPayload`, between `instanceId` and `revision`:

```csharp
            baseRevision = envelope.BaseRevision,
```

- [ ] **Step 7: Switch the two snapshot sites to the factory**

Snapshots must *not* gain `baseRevision`. Change their construction to the explicit factory so the intent is visible.

In `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`, both envelope constructions for `BuildInitialPayloadsAsync` (the resync path and the bootstrap path) become:

```csharp
                var resyncEnvelope = MappingEnvelope.Snapshot(
                    sessionMapping.InstanceId, sessionMapping.Revision);
```

```csharp
            var bootstrapEnvelope = MappingEnvelope.Snapshot(
                sessionMapping.InstanceId, sessionMapping.Revision);
```

Keep the existing comments about reading the revision before the snapshot — that ordering still matters and is unrelated to this change.

`/auth/token` in `AuthEndpoints.cs` reads `sessionMapping.InstanceId` / `.Revision` directly into the response object rather than building an envelope; leave it as is. It already emits no `baseRevision`, which is correct.

- [ ] **Step 8: Fix the fallout and run everything**

Run: `dotnet build`

Any remaining two-argument `new MappingEnvelope(...)` in tests will fail to compile. In `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs` there are several `new MappingEnvelope("inst", 9L)` and `new MappingEnvelope(mappings.InstanceId, mappings.Revision)` calls — give each an explicit third argument (`new MappingEnvelope("inst", 9L, 8L)`) or switch snapshot-shaped ones to `MappingEnvelope.Snapshot(...)`.

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS. If a suite asserts on `sessionMappingSnapshot`, point it at `AssertHasSnapshotEnvelope`.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Server/ tests/Brmble.Server.Tests/
git commit -m "feat: stamp baseRevision so clients can apply across multi-bump operations"
```

---

## Task 2: Projection row, inputs and change set

**Files:**
- Create: `src/Brmble.Client/Services/Voice/Projection/UserProjection.cs`
- Create: `src/Brmble.Client/Services/Voice/Projection/ProjectionInputs.cs`
- Create: `src/Brmble.Client/Services/Voice/Projection/ChangeSet.cs`
- Test: `tests/Brmble.Client.Tests/Services/UserProjectionTests.cs` (create)

**Why:** Ownership is enforced by the shape of these types. `MumbleUserInput` has no server-owned field to write and `ServerMappingEntry` has no Mumble-owned one, so a cross-write cannot compile. Getting these right is what makes the store's logic small.

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/UserProjectionTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionTests
{
    [TestMethod]
    public void CertHash_PrefersMumbleOverServer()
    {
        // Mumble observes the certificate on the live connection; the server's copy is a
        // record of one. When both exist the live one wins, matching today's behaviour.
        var row = new UserProjection
        {
            SessionId = 1,
            MumbleCertHash = "from-mumble",
            ServerCertHash = "from-server"
        };

        Assert.AreEqual("from-mumble", row.CertHash);
    }

    [TestMethod]
    public void CertHash_FallsBackToServerWhenMumbleHasNone()
    {
        var row = new UserProjection { SessionId = 1, ServerCertHash = "from-server" };

        Assert.AreEqual("from-server", row.CertHash);
    }

    [TestMethod]
    public void CertHash_IsNullWhenNeitherSourceKnows()
    {
        Assert.IsNull(new UserProjection { SessionId = 1 }.CertHash);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionTests"`

Expected: FAIL — compile error, `The type or namespace name 'UserProjection' could not be found`.

- [ ] **Step 3: Create the row record**

Create `src/Brmble.Client/Services/Voice/Projection/UserProjection.cs`:

```csharp
namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// One row of the authoritative user projection: Mumble-native presence merged with
/// Brmble-owned identity.
/// </summary>
/// <remarks>
/// Fields are grouped by owner and never cross. A Mumble input may write only the first group,
/// a server input only the second. In the server group, <c>null</c> means "not known" rather
/// than "empty" — see <see cref="UserProjectionStore"/> for the rule that preserves it.
/// </remarks>
internal sealed record UserProjection
{
    public required uint SessionId { get; init; }

    // ---- Mumble-owned. Authoritative, including when empty: UserState is complete every time.
    public string? Name { get; init; }
    public uint ChannelId { get; init; }
    public bool Muted { get; init; }
    public bool Deafened { get; init; }
    public string? Comment { get; init; }
    public string? MumbleCertHash { get; init; }
    public bool IsSelf { get; init; }

    // ---- Server-owned. null means unknown, never "cleared".
    public string? MatrixUserId { get; init; }
    public string? CompanionId { get; init; }
    public bool? IsBrmbleClient { get; init; }
    public string? ServerCertHash { get; init; }

    /// <summary>
    /// The live connection's certificate wins over the server's recorded copy, so a server
    /// restart clearing its own copy cannot blank a hash Mumble can still see.
    /// </summary>
    public string? CertHash => MumbleCertHash ?? ServerCertHash;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionTests"`

Expected: PASS, three tests.

- [ ] **Step 5: Create the input records**

Create `src/Brmble.Client/Services/Voice/Projection/ProjectionInputs.cs`. These deliberately reference no Mumble, HTTP or JSON type — the caller translates before handing them over, which is what keeps the store unit-testable:

```csharp
namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// A Mumble <c>UserState</c>, reduced to the fields Mumble owns. Complete every time: Mumble
/// resends the full state on every change, so these values are authoritative even when empty.
/// </summary>
internal sealed record MumbleUserInput(
    uint SessionId,
    string? Name,
    uint ChannelId,
    bool Muted,
    bool Deafened,
    string? Comment,
    string? CertHash,
    bool IsSelf);

/// <summary>
/// The server-owned half of one session. Every field is nullable and <c>null</c> means "not
/// known", never "cleared".
/// </summary>
internal sealed record ServerMappingEntry(
    string? MatrixUserId,
    string? CompanionId,
    bool? IsBrmbleClient,
    string? CertHash);

/// <summary>
/// A complete statement of every session the server knows about, from <c>/auth/token</c> or a
/// WebSocket <c>sessionMappingSnapshot</c>. Authoritative for membership: a session absent from
/// it has its server-owned fields reset to unknown (spec §4.3).
/// </summary>
internal sealed record ServerSnapshot(
    string InstanceId,
    long Revision,
    IReadOnlyDictionary<uint, ServerMappingEntry> Mappings);

internal enum ServerEventKind
{
    MappingAdded,
    MappingRemoved,
    CompanionChanged,
    BrmbleActivated,
    BrmbleDeactivated
}

/// <summary>
/// One incremental server event.
/// </summary>
/// <param name="BaseRevision">
/// The revision this event applies on top of. The client applies when this equals its own
/// cursor — see the table in the Phase 2 plan. Not <c>Revision - 1</c>: one operation may bump
/// the server's counter several times.
/// </param>
internal sealed record ServerEvent(
    ServerEventKind Kind,
    string InstanceId,
    long BaseRevision,
    long Revision,
    uint SessionId,
    ServerMappingEntry? Entry = null);
```

- [ ] **Step 6: Create the change set**

Create `src/Brmble.Client/Services/Voice/Projection/ChangeSet.cs`:

```csharp
namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// What one <c>Apply</c> changed. Rows in <see cref="Changed"/> are always complete — every
/// field present — so a consumer replaces by session id and never merges field-by-field.
/// </summary>
/// <param name="IsReset">
/// The caller should replace its whole list rather than patch it. Set by a Mumble reset and by
/// a snapshot that changed membership.
/// </param>
/// <param name="NeedsSnapshot">
/// The store detected a gap or a restart and cannot proceed from incremental events. The caller
/// should request a snapshot. Nothing in the projection was changed by the event that set this.
/// </param>
internal sealed record ChangeSet(
    IReadOnlyList<UserProjection> Changed,
    IReadOnlyList<uint> Removed,
    bool IsReset = false,
    bool NeedsSnapshot = false)
{
    public static readonly ChangeSet Empty = new([], []);

    public bool IsEmpty => Changed.Count == 0 && Removed.Count == 0 && !IsReset && !NeedsSnapshot;
}
```

- [ ] **Step 7: Build and commit**

Run: `dotnet build`

Expected: clean, 0 warnings.

```bash
git add src/Brmble.Client/Services/Voice/Projection/ tests/Brmble.Client.Tests/Services/UserProjectionTests.cs
git commit -m "feat: add user projection row, inputs and change set types"
```

---

## Task 3: The store and its Mumble inputs

**Files:**
- Create: `src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs`
- Test: `tests/Brmble.Client.Tests/Services/UserProjectionStoreMumbleTests.cs` (create)

**Why:** Mumble alone owns session existence (spec §3.3). If the Brmble server is down, rows still appear, move channel and mute — they just carry stale enrichment. That property comes from this task.

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/UserProjectionStoreMumbleTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionStoreMumbleTests
{
    private UserProjectionStore _store = null!;

    [TestInitialize]
    public void Setup() => _store = new UserProjectionStore();

    private static MumbleUserInput User(uint session, string name = "Alice", uint channel = 0) =>
        new(session, name, channel, false, false, null, null, false);

    [TestMethod]
    public void ApplyMumbleUserState_AddsARowAndReportsIt()
    {
        var change = _store.ApplyMumbleUserState(User(1));

        Assert.AreEqual(1, change.Changed.Count);
        Assert.AreEqual(1u, change.Changed[0].SessionId);
        Assert.AreEqual("Alice", change.Changed[0].Name);
        Assert.AreEqual(1, _store.Snapshot().Count);
    }

    [TestMethod]
    public void ApplyMumbleUserState_IsIdempotentForAnUnchangedState()
    {
        _store.ApplyMumbleUserState(User(1));

        var change = _store.ApplyMumbleUserState(User(1));

        Assert.IsTrue(change.IsEmpty, "an identical UserState must not churn the UI");
    }

    [TestMethod]
    public void ApplyMumbleUserState_UpdatesMumbleFieldsWithoutTouchingServerFields()
    {
        _store.ApplyMumbleUserState(User(1));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [1] = new("@alice:test", "retro", true, "cert-server")
        }));

        var change = _store.ApplyMumbleUserState(User(1, "Alice", channel: 7));

        var row = change.Changed.Single();
        Assert.AreEqual(7u, row.ChannelId);
        Assert.AreEqual("@alice:test", row.MatrixUserId, "a Mumble input must not clear identity");
        Assert.AreEqual("retro", row.CompanionId);
        Assert.AreEqual(true, row.IsBrmbleClient);
    }

    [TestMethod]
    public void ApplyMumbleUserRemove_DeletesTheRowEntirely()
    {
        _store.ApplyMumbleUserState(User(1));

        var change = _store.ApplyMumbleUserRemove(1);

        CollectionAssert.AreEqual(new[] { 1u }, change.Removed.ToArray());
        Assert.AreEqual(0, _store.Snapshot().Count);
    }

    [TestMethod]
    public void ApplyMumbleUserRemove_IsSilentForAnUnknownSession()
    {
        Assert.IsTrue(_store.ApplyMumbleUserRemove(99).IsEmpty);
    }

    [TestMethod]
    public void ApplyMumbleReset_ReplacesMembershipAndFlagsAReset()
    {
        _store.ApplyMumbleUserState(User(1));
        _store.ApplyMumbleUserState(User(2, "Bob"));

        var change = _store.ApplyMumbleReset([User(2, "Bob"), User(3, "Carol")]);

        Assert.IsTrue(change.IsReset);
        CollectionAssert.AreEquivalent(new[] { 2u, 3u }, _store.Snapshot().Keys.ToArray());
    }

    [TestMethod]
    public void ApplyMumbleReset_KeepsServerFieldsForSessionsThatSurvive()
    {
        // A voice reconnect must not cost us identity we already know.
        _store.ApplyMumbleUserState(User(1));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst", 5, new Dictionary<uint, ServerMappingEntry>
        {
            [1] = new("@alice:test", "retro", true, null)
        }));

        _store.ApplyMumbleReset([User(1)]);

        Assert.AreEqual("@alice:test", _store.Snapshot()[1].MatrixUserId);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionStoreMumbleTests"`

Expected: FAIL — compile error, `The type or namespace name 'UserProjectionStore' could not be found`.

- [ ] **Step 3: Create the store with its Mumble inputs**

Create `src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs`. `ApplyServerSnapshot` and `ApplyServerEvent` are stubbed here and implemented in Tasks 4 and 5 — the tests above need `ApplyServerSnapshot` to work, so it gets a minimal real body now and its reconciliation rules in Task 4:

```csharp
namespace Brmble.Client.Services.Voice.Projection;

/// <summary>
/// The single authoritative user projection. Merges Mumble presence and Brmble identity under
/// two rules: each input writes only the fields it owns, and a null server field means "not
/// known" rather than "cleared".
/// </summary>
/// <remarks>
/// Every Apply takes one lock, mutates, computes the change set and releases. No callback runs
/// under the lock — the caller emits from the returned value (spec §6.6). Inputs arrive on the
/// Mumble protocol thread, the WebSocket read loop and an HTTP continuation.
/// </remarks>
internal sealed class UserProjectionStore
{
    private readonly object _gate = new();
    private readonly Dictionary<uint, UserProjection> _rows = [];

    private string? _instanceId;
    private long _revision;

    /// <summary>A copy of the current projection, for tests and for building a full reset.</summary>
    public IReadOnlyDictionary<uint, UserProjection> Snapshot()
    {
        lock (_gate) return new Dictionary<uint, UserProjection>(_rows);
    }

    public ChangeSet ApplyMumbleUserState(MumbleUserInput input)
    {
        lock (_gate)
        {
            _rows.TryGetValue(input.SessionId, out var existing);
            var updated = WithMumbleFields(existing, input);
            if (existing == updated) return ChangeSet.Empty;

            _rows[input.SessionId] = updated;
            return new ChangeSet([updated], []);
        }
    }

    public ChangeSet ApplyMumbleUserRemove(uint sessionId)
    {
        lock (_gate)
        {
            // Mumble alone owns existence, so this is the only path that deletes a row.
            return _rows.Remove(sessionId)
                ? new ChangeSet([], [sessionId])
                : ChangeSet.Empty;
        }
    }

    /// <summary>
    /// Replaces membership wholesale on voice connect or reconnect. Server-owned fields survive
    /// for sessions present in both the old and new list.
    /// </summary>
    public ChangeSet ApplyMumbleReset(IReadOnlyList<MumbleUserInput> users)
    {
        lock (_gate)
        {
            var rebuilt = new Dictionary<uint, UserProjection>(users.Count);
            foreach (var input in users)
            {
                _rows.TryGetValue(input.SessionId, out var existing);
                rebuilt[input.SessionId] = WithMumbleFields(existing, input);
            }

            _rows.Clear();
            foreach (var (sessionId, row) in rebuilt) _rows[sessionId] = row;

            return new ChangeSet([.. rebuilt.Values], [], IsReset: true);
        }
    }

    /// <summary>
    /// Writes only Mumble-owned fields. Server-owned fields are carried across untouched, which
    /// is why a channel move cannot blank a badge.
    /// </summary>
    private static UserProjection WithMumbleFields(UserProjection? existing, MumbleUserInput input)
    {
        var row = existing ?? new UserProjection { SessionId = input.SessionId };
        return row with
        {
            Name = input.Name,
            ChannelId = input.ChannelId,
            Muted = input.Muted,
            Deafened = input.Deafened,
            Comment = input.Comment,
            MumbleCertHash = input.CertHash,
            IsSelf = input.IsSelf
        };
    }

    public ChangeSet ApplyServerSnapshot(ServerSnapshot snapshot)
    {
        lock (_gate)
        {
            _instanceId = snapshot.InstanceId;
            _revision = snapshot.Revision;

            var changed = new List<UserProjection>();
            foreach (var (sessionId, entry) in snapshot.Mappings)
            {
                if (!_rows.TryGetValue(sessionId, out var existing)) continue;
                var updated = WithServerFields(existing, entry);
                if (existing == updated) continue;
                _rows[sessionId] = updated;
                changed.Add(updated);
            }

            return changed.Count == 0 ? ChangeSet.Empty : new ChangeSet(changed, []);
        }
    }

    /// <summary>
    /// Writes only server-owned fields, and only those the input actually knows: a null leaves
    /// the current value alone. This is the rule that stops a missing field becoming a wrong one.
    /// </summary>
    private static UserProjection WithServerFields(UserProjection row, ServerMappingEntry entry) =>
        row with
        {
            MatrixUserId = entry.MatrixUserId ?? row.MatrixUserId,
            CompanionId = entry.CompanionId ?? row.CompanionId,
            IsBrmbleClient = entry.IsBrmbleClient ?? row.IsBrmbleClient,
            ServerCertHash = entry.CertHash ?? row.ServerCertHash
        };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionStoreMumbleTests"`

Expected: PASS, seven tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs tests/Brmble.Client.Tests/Services/UserProjectionStoreMumbleTests.cs
git commit -m "feat: add user projection store with Mumble-owned inputs"
```

---

## Task 4: Snapshot reconciliation

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs`
- Test: `tests/Brmble.Client.Tests/Services/UserProjectionStoreSnapshotTests.cs` (create)

**Why:** Spec §4.3 changes what a snapshot *means*. Today it only patches rows that already exist and never clears, so a session that vanished during an outage keeps stale enrichment forever. A snapshot is now the complete set of server-known sessions: anything absent has its server-owned fields reset to unknown. It still cannot delete a row — only Mumble owns existence.

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/UserProjectionStoreSnapshotTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionStoreSnapshotTests
{
    private UserProjectionStore _store = null!;

    [TestInitialize]
    public void Setup()
    {
        _store = new UserProjectionStore();
        _store.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));
        _store.ApplyMumbleUserState(new MumbleUserInput(2, "Bob", 0, false, false, null, null, false));
    }

    private static ServerSnapshot Snapshot(long revision, params (uint Session, ServerMappingEntry Entry)[] entries) =>
        new("inst-a", revision, entries.ToDictionary(e => e.Session, e => e.Entry));

    [TestMethod]
    public void ApplyServerSnapshot_FillsServerFieldsForKnownSessions()
    {
        var change = _store.ApplyServerSnapshot(
            Snapshot(5, (1, new ServerMappingEntry("@alice:test", "retro", true, "cert-a"))));

        Assert.AreEqual("@alice:test", _store.Snapshot()[1].MatrixUserId);
        Assert.AreEqual(1, change.Changed.Count);
    }

    [TestMethod]
    public void ApplyServerSnapshot_ResetsServerFieldsForSessionsItOmits()
    {
        // Session 2 was known to the server, then vanished during an outage. The snapshot is
        // authoritative for membership, so its enrichment goes back to unknown rather than
        // lingering as a confident wrong answer.
        _store.ApplyServerSnapshot(Snapshot(5,
            (1, new ServerMappingEntry("@alice:test", "retro", true, null)),
            (2, new ServerMappingEntry("@bob:test", "bee", true, null))));

        _store.ApplyServerSnapshot(Snapshot(6,
            (1, new ServerMappingEntry("@alice:test", "retro", true, null))));

        var bob = _store.Snapshot()[2];
        Assert.IsNull(bob.MatrixUserId);
        Assert.IsNull(bob.CompanionId);
        Assert.IsNull(bob.IsBrmbleClient);
    }

    [TestMethod]
    public void ApplyServerSnapshot_DoesNotDeleteRowsMumbleStillShows()
    {
        _store.ApplyServerSnapshot(Snapshot(5, (1, new ServerMappingEntry("@alice:test", null, null, null))));

        Assert.IsTrue(_store.Snapshot().ContainsKey(2), "only Mumble may remove a row");
        Assert.AreEqual("Bob", _store.Snapshot()[2].Name);
    }

    [TestMethod]
    public void ApplyServerSnapshot_KeepsMumbleFieldsIntact()
    {
        _store.ApplyServerSnapshot(Snapshot(5, (1, new ServerMappingEntry("@alice:test", null, null, null))));

        Assert.AreEqual("Alice", _store.Snapshot()[1].Name);
    }

    [TestMethod]
    public void ApplyServerSnapshot_ForAnEntryWithNoMumbleRowIsIgnored()
    {
        // The server knows a session Mumble has not shown us. Existence is Mumble's to grant,
        // so nothing is created; the next UserState will pick the enrichment up via the
        // snapshot that follows it.
        _store.ApplyServerSnapshot(Snapshot(5, (99, new ServerMappingEntry("@ghost:test", null, null, null))));

        Assert.IsFalse(_store.Snapshot().ContainsKey(99));
    }

    [TestMethod]
    public void ApplyServerSnapshot_FlagsAResetWhenMembershipChanged()
    {
        _store.ApplyServerSnapshot(Snapshot(5,
            (1, new ServerMappingEntry("@alice:test", null, null, null)),
            (2, new ServerMappingEntry("@bob:test", null, null, null))));

        var change = _store.ApplyServerSnapshot(Snapshot(6,
            (1, new ServerMappingEntry("@alice:test", null, null, null))));

        Assert.IsTrue(change.Changed.Any(r => r.SessionId == 2),
            "the reset row must be reported so the UI drops the badge");
    }

    [TestMethod]
    public void ApplyServerSnapshot_FromANewInstanceReplacesEverything()
    {
        _store.ApplyServerSnapshot(Snapshot(90, (1, new ServerMappingEntry("@alice:test", "retro", true, null))));

        _store.ApplyServerSnapshot(new ServerSnapshot("inst-b", 2,
            new Dictionary<uint, ServerMappingEntry>
            {
                [1] = new("@alice:test", "bee", null, null)
            }));

        var alice = _store.Snapshot()[1];
        Assert.AreEqual("bee", alice.CompanionId);
        Assert.IsNull(alice.IsBrmbleClient, "a restart invalidates what the old instance told us");
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionStoreSnapshotTests"`

Expected: FAIL — `ApplyServerSnapshot_ResetsServerFieldsForSessionsItOmits` fails because Bob keeps `@bob:test`.

- [ ] **Step 3: Implement reconciliation**

In `UserProjectionStore.cs`, replace `ApplyServerSnapshot` entirely:

```csharp
    /// <summary>
    /// Applies a complete statement of server-known sessions. Sessions the snapshot omits have
    /// their server-owned fields reset to unknown — stale enrichment is worse than none — but
    /// their rows survive, because only Mumble owns existence.
    /// </summary>
    public ChangeSet ApplyServerSnapshot(ServerSnapshot snapshot)
    {
        lock (_gate)
        {
            // A different instance means the old revision line is meaningless. Nothing special
            // is needed beyond taking this snapshot as truth, which the reset below does.
            _instanceId = snapshot.InstanceId;
            _revision = snapshot.Revision;

            var changed = new List<UserProjection>();

            foreach (var sessionId in _rows.Keys.ToArray())
            {
                var existing = _rows[sessionId];

                var updated = snapshot.Mappings.TryGetValue(sessionId, out var entry)
                    // Present: overwrite the server half outright. A snapshot states every
                    // server-owned field, so null here is knowledge, not absence — this is the
                    // one place the null-means-unknown rule does not apply.
                    ? existing with
                    {
                        MatrixUserId = entry.MatrixUserId,
                        CompanionId = entry.CompanionId,
                        IsBrmbleClient = entry.IsBrmbleClient,
                        ServerCertHash = entry.CertHash
                    }
                    // Absent: the server does not know this session. Back to unknown.
                    : existing with
                    {
                        MatrixUserId = null,
                        CompanionId = null,
                        IsBrmbleClient = null,
                        ServerCertHash = null
                    };

                if (existing == updated) continue;
                _rows[sessionId] = updated;
                changed.Add(updated);
            }

            return changed.Count == 0 ? ChangeSet.Empty : new ChangeSet(changed, []);
        }
    }
```

`WithServerFields` is now used only by `ApplyServerEvent` in Task 5. Leave it in place.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionStore"`

Expected: PASS — the seven Mumble tests and the seven snapshot tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs tests/Brmble.Client.Tests/Services/UserProjectionStoreSnapshotTests.cs
git commit -m "feat: make snapshots authoritative for server-owned membership"
```

---

## Task 5: Incremental events and sequencing

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs`
- Test: `tests/Brmble.Client.Tests/Services/UserProjectionStoreEventTests.cs` (create)

**Why:** This is where a lost or reordered event stops producing a confidently wrong value. The four sequencing branches from the Background table live here.

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/UserProjectionStoreEventTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class UserProjectionStoreEventTests
{
    private UserProjectionStore _store = null!;

    [TestInitialize]
    public void Setup()
    {
        _store = new UserProjectionStore();
        _store.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));
        _store.ApplyServerSnapshot(new ServerSnapshot("inst-a", 10,
            new Dictionary<uint, ServerMappingEntry>
            {
                [1] = new("@alice:test", "retro", true, "cert-a")
            }));
    }

    private static ServerEvent Companion(long baseRevision, long revision, string? companionId) =>
        new(ServerEventKind.CompanionChanged, "inst-a", baseRevision, revision, 1,
            new ServerMappingEntry(null, companionId, null, null));

    [TestMethod]
    public void ApplyServerEvent_AppliesWhenBaseRevisionMatchesTheCursor()
    {
        var change = _store.ApplyServerEvent(Companion(10, 13, "bee"));

        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
        Assert.AreEqual(1, change.Changed.Count);
        Assert.IsFalse(change.NeedsSnapshot);
    }

    [TestMethod]
    public void ApplyServerEvent_AcceptsAMultiBumpRange()
    {
        // One server operation can bump the counter several times; the client must not read
        // that as a gap.
        var change = _store.ApplyServerEvent(Companion(10, 40, "bee"));

        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
        Assert.IsFalse(change.NeedsSnapshot);
    }

    [TestMethod]
    public void ApplyServerEvent_IgnoresAnAlreadyAppliedEvent()
    {
        _store.ApplyServerEvent(Companion(10, 13, "bee"));

        var change = _store.ApplyServerEvent(Companion(10, 13, "bee"));

        Assert.IsTrue(change.IsEmpty, "a duplicate must not re-emit");
        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
    }

    [TestMethod]
    public void ApplyServerEvent_IgnoresAReorderedOlderEvent()
    {
        _store.ApplyServerEvent(Companion(10, 20, "bee"));

        var change = _store.ApplyServerEvent(Companion(12, 15, "stale"));

        Assert.AreEqual("bee", _store.Snapshot()[1].CompanionId);
        Assert.IsTrue(change.IsEmpty);
    }

    [TestMethod]
    public void ApplyServerEvent_RequestsASnapshotOnAGapAndChangesNothing()
    {
        var change = _store.ApplyServerEvent(Companion(30, 33, "bee"));

        Assert.IsTrue(change.NeedsSnapshot);
        Assert.AreEqual(0, change.Changed.Count);
        Assert.AreEqual("retro", _store.Snapshot()[1].CompanionId, "a gap must apply nothing");
    }

    [TestMethod]
    public void ApplyServerEvent_RequestsASnapshotWhenTheInstanceChanged()
    {
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.CompanionChanged, "inst-b", 0, 1, 1,
                new ServerMappingEntry(null, "bee", null, null)));

        Assert.IsTrue(change.NeedsSnapshot);
        Assert.AreEqual("retro", _store.Snapshot()[1].CompanionId);
    }

    [TestMethod]
    public void ApplyServerEvent_BeforeAnySnapshotRequestsOne()
    {
        var fresh = new UserProjectionStore();
        fresh.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));

        var change = fresh.ApplyServerEvent(Companion(0, 1, "bee"));

        Assert.IsTrue(change.NeedsSnapshot, "without a cursor there is nothing to sequence against");
    }

    [TestMethod]
    public void ApplyServerEvent_NullFieldsLeaveKnownValuesAlone()
    {
        // The rule that makes a lost field harmless: unknown never overwrites known.
        var change = _store.ApplyServerEvent(Companion(10, 11, null));

        Assert.AreEqual("retro", _store.Snapshot()[1].CompanionId);
        Assert.IsTrue(change.IsEmpty);
    }

    [TestMethod]
    public void ApplyServerEvent_BrmbleDeactivatedIsKnowledgeAndClearsTheBadge()
    {
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.BrmbleDeactivated, "inst-a", 10, 11, 1));

        Assert.AreEqual(false, _store.Snapshot()[1].IsBrmbleClient);
        Assert.AreEqual(1, change.Changed.Count);
    }

    [TestMethod]
    public void ApplyServerEvent_BrmbleActivatedSetsTheBadge()
    {
        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleDeactivated, "inst-a", 10, 11, 1));

        _store.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleActivated, "inst-a", 11, 12, 1));

        Assert.AreEqual(true, _store.Snapshot()[1].IsBrmbleClient);
    }

    [TestMethod]
    public void ApplyServerEvent_MappingRemovedClearsServerFieldsButKeepsTheRow()
    {
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.MappingRemoved, "inst-a", 10, 11, 1));

        Assert.IsTrue(_store.Snapshot().ContainsKey(1), "only Mumble removes rows");
        Assert.IsNull(_store.Snapshot()[1].MatrixUserId);
        Assert.IsNull(_store.Snapshot()[1].IsBrmbleClient);
        Assert.AreEqual(0, change.Removed.Count);
    }

    [TestMethod]
    public void ApplyServerEvent_ForASessionMumbleHasNotShownIsIgnoredButAdvancesTheCursor()
    {
        // The row does not exist yet, so there is nothing to enrich — but the event was still
        // observed, and treating it as a gap would resync on every unrelated user's join.
        var change = _store.ApplyServerEvent(
            new ServerEvent(ServerEventKind.CompanionChanged, "inst-a", 10, 11, 77,
                new ServerMappingEntry(null, "bee", null, null)));

        Assert.IsFalse(change.NeedsSnapshot);
        Assert.IsFalse(_store.Snapshot().ContainsKey(77));

        var next = _store.ApplyServerEvent(Companion(11, 12, "pip"));
        Assert.AreEqual("pip", _store.Snapshot()[1].CompanionId);
        Assert.IsFalse(next.NeedsSnapshot);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionStoreEventTests"`

Expected: FAIL — compile error, `'UserProjectionStore' does not contain a definition for 'ApplyServerEvent'`.

- [ ] **Step 3: Implement `ApplyServerEvent`**

Add to `UserProjectionStore.cs`:

```csharp
    /// <summary>
    /// Applies one incremental server event, or reports that a snapshot is needed.
    /// </summary>
    /// <remarks>
    /// Sequencing uses <c>BaseRevision</c>, not <c>Revision - 1</c>: a single server operation
    /// may bump the counter several times, so only the range's start tells us whether we are
    /// contiguous. An event that cannot be applied changes nothing at all — a partially applied
    /// gap is what produces a confidently wrong row.
    /// </remarks>
    public ChangeSet ApplyServerEvent(ServerEvent evt)
    {
        lock (_gate)
        {
            // No cursor yet: nothing to sequence against, so ask for the snapshot that
            // establishes one.
            if (_instanceId is null)
                return new ChangeSet([], [], NeedsSnapshot: true);

            // The server restarted. Everything it told us belongs to a table that no longer
            // exists, so take nothing from this event and resync.
            if (!string.Equals(evt.InstanceId, _instanceId, StringComparison.Ordinal))
                return new ChangeSet([], [], NeedsSnapshot: true);

            // Already reflected — a duplicate or a reorder. Silently correct.
            if (evt.BaseRevision < _revision) return ChangeSet.Empty;

            // A genuine gap: we missed something in between and cannot infer it.
            if (evt.BaseRevision > _revision)
                return new ChangeSet([], [], NeedsSnapshot: true);

            // Contiguous. Advance the cursor even if the event turns out not to touch a row we
            // hold, or the next event would look like a gap.
            _revision = evt.Revision;

            if (!_rows.TryGetValue(evt.SessionId, out var existing))
                return ChangeSet.Empty;

            var updated = evt.Kind switch
            {
                ServerEventKind.MappingRemoved => existing with
                {
                    MatrixUserId = null,
                    CompanionId = null,
                    IsBrmbleClient = null,
                    ServerCertHash = null
                },
                // Activation and deactivation are both knowledge, so they write a real bool.
                ServerEventKind.BrmbleActivated => existing with { IsBrmbleClient = true },
                ServerEventKind.BrmbleDeactivated => existing with { IsBrmbleClient = false },
                // Everything else carries a partial entry: null means unknown, so leave it.
                _ => evt.Entry is null ? existing : WithServerFields(existing, evt.Entry)
            };

            if (existing == updated) return ChangeSet.Empty;

            _rows[evt.SessionId] = updated;
            return new ChangeSet([updated], []);
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionStoreEventTests"`

Expected: PASS, twelve tests.

- [ ] **Step 5: Run the whole client suite**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs tests/Brmble.Client.Tests/Services/UserProjectionStoreEventTests.cs
git commit -m "feat: apply server events with base-revision sequencing"
```

---

## Task 6: Convergence property test

**Files:**
- Test: `tests/Brmble.Client.Tests/Services/UserProjectionConvergenceTests.cs` (create)

**Why:** Spec §8 calls this "the whole design in one assertion". Every individual rule exists to serve one property: **however events are reordered or dropped, a final snapshot always produces the same projection.** If this holds, the failure modes in spec §7 cannot occur.

- [ ] **Step 1: Write the test**

Create `tests/Brmble.Client.Tests/Services/UserProjectionConvergenceTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// The design's central property: given the same starting point and the same final snapshot,
/// any permutation of the intervening events — with any subset dropped — converges on the same
/// projection. Ordering and delivery become irrelevant to correctness.
/// </summary>
[TestClass]
public class UserProjectionConvergenceTests
{
    private static readonly MumbleUserInput[] Users =
    [
        new(1, "Alice", 0, false, false, null, null, false),
        new(2, "Bob", 0, false, false, null, null, false),
        new(3, "Carol", 0, false, false, null, null, false)
    ];

    private static readonly ServerSnapshot Final = new("inst-a", 100,
        new Dictionary<uint, ServerMappingEntry>
        {
            [1] = new("@alice:test", "retro", true, "cert-a"),
            // Session 2 is deliberately absent. Events below enrich it, so a patch-only
            // reconciliation would leave it enriched in some trials and not others — this is
            // what makes the property test able to catch a §4.3 regression rather than passing
            // trivially because the final snapshot overwrites everything.
            [3] = new("@carol:test", "pip", null, null)
        });

    private static ServerEvent[] BuildEvents() =>
    [
        new(ServerEventKind.CompanionChanged, "inst-a", 10, 11, 1, new ServerMappingEntry(null, "bee", null, null)),
        new(ServerEventKind.BrmbleActivated, "inst-a", 11, 12, 2),
        new(ServerEventKind.CompanionChanged, "inst-a", 12, 20, 3, new ServerMappingEntry(null, "floppy", null, null)),
        new(ServerEventKind.BrmbleDeactivated, "inst-a", 20, 21, 1),
        new(ServerEventKind.MappingRemoved, "inst-a", 21, 25, 2),
        new(ServerEventKind.CompanionChanged, "inst-a", 25, 26, 1, new ServerMappingEntry(null, "pip", null, null))
    ];

    private static UserProjectionStore Seeded()
    {
        var store = new UserProjectionStore();
        foreach (var user in Users) store.ApplyMumbleUserState(user);
        store.ApplyServerSnapshot(new ServerSnapshot("inst-a", 10,
            new Dictionary<uint, ServerMappingEntry>
            {
                [1] = new("@alice:test", "retro", null, null),
                [2] = new("@bob:test", "bee", null, null),
                [3] = new("@carol:test", "pip", null, null)
            }));
        return store;
    }

    private static string Describe(IReadOnlyDictionary<uint, UserProjection> rows) =>
        string.Join("|", rows.OrderBy(r => r.Key).Select(r =>
            $"{r.Key}:{r.Value.Name}:{r.Value.MatrixUserId}:{r.Value.CompanionId}:" +
            $"{r.Value.IsBrmbleClient?.ToString() ?? "unknown"}:{r.Value.CertHash ?? "none"}"));

    [TestMethod]
    public void AnyPermutationWithAnyDropsConvergesOnTheSameProjection()
    {
        var reference = Seeded();
        foreach (var evt in BuildEvents()) reference.ApplyServerEvent(evt);
        reference.ApplyServerSnapshot(Final);
        var expected = Describe(reference.Snapshot());

        var random = new Random(20260801);

        for (var trial = 0; trial < 500; trial++)
        {
            var events = BuildEvents().ToList();

            // Shuffle.
            for (var i = events.Count - 1; i > 0; i--)
            {
                var j = random.Next(i + 1);
                (events[i], events[j]) = (events[j], events[i]);
            }

            // Drop an arbitrary subset.
            events = events.Where(_ => random.Next(4) != 0).ToList();

            var store = Seeded();
            foreach (var evt in events) store.ApplyServerEvent(evt);
            store.ApplyServerSnapshot(Final);

            Assert.AreEqual(expected, Describe(store.Snapshot()),
                $"trial {trial} diverged with {events.Count} of 6 events");
        }
    }

    [TestMethod]
    public void ASessionTheFinalSnapshotOmitsEndsUnknownRegardlessOfWhatEventsSaid()
    {
        // Guards the guard: this is the case that makes the permutation test load-bearing. If
        // snapshot reconciliation regressed to patch-only, session 2 would keep whatever the
        // events happened to set and the permutations would diverge.
        var withEvent = Seeded();
        withEvent.ApplyServerEvent(new ServerEvent(ServerEventKind.BrmbleActivated, "inst-a", 10, 12, 2));
        withEvent.ApplyServerSnapshot(Final);

        var withoutEvent = Seeded();
        withoutEvent.ApplyServerSnapshot(Final);

        Assert.IsNull(withEvent.Snapshot()[2].IsBrmbleClient);
        Assert.IsNull(withEvent.Snapshot()[2].MatrixUserId);
        Assert.AreEqual(Describe(withoutEvent.Snapshot()), Describe(withEvent.Snapshot()));
    }

    [TestMethod]
    public void ADroppedEventNeverProducesAConfidentlyWrongValue()
    {
        // The failure this design exists to remove: a lost event must leave a field unknown or
        // stale-but-true, never asserted wrong.
        var store = Seeded();

        // Alice's deactivation is dropped; her later companion change still arrives.
        store.ApplyServerEvent(new ServerEvent(
            ServerEventKind.CompanionChanged, "inst-a", 20, 26, 1,
            new ServerMappingEntry(null, "pip", null, null)));

        var alice = store.Snapshot()[1];
        Assert.AreEqual("retro", alice.CompanionId, "the gapped event must not be applied");
        Assert.IsNull(alice.IsBrmbleClient, "and must not invent a badge state");
    }

    [TestMethod]
    public void AGapIsAlwaysReportedSoTheCallerCanRepairIt()
    {
        var store = Seeded();

        var change = store.ApplyServerEvent(new ServerEvent(
            ServerEventKind.CompanionChanged, "inst-a", 50, 51, 1,
            new ServerMappingEntry(null, "pip", null, null)));

        Assert.IsTrue(change.NeedsSnapshot);
    }
}
```

- [ ] **Step 2: Run the test**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~UserProjectionConvergenceTests"`

Expected: PASS, four tests. If the permutation test fails, **do not weaken it** — it is the design's core property, and a failure means one of Tasks 3-5 has a real bug. The assertion message names the trial and how many events survived; reproduce it by seeding `Random` with that trial number.

- [ ] **Step 3: Full verification**

```bash
dotnet build
dotnet test
```

Expected: build clean with 0 warnings; all four test projects pass.

- [ ] **Step 4: Commit**

```bash
git add tests/Brmble.Client.Tests/Services/UserProjectionConvergenceTests.cs
git commit -m "test: prove the projection converges under reordering and loss"
```

---

## Done when

- [ ] `dotnet build` is clean with 0 warnings
- [ ] `dotnet test` passes in all four projects, with more tests than the 1250 baseline
- [ ] Every mapping **event** carries `baseRevision`; every **snapshot** carries `instanceId` and `revision` and no `baseRevision`
- [ ] Consecutive events from one publisher are contiguous: each event's `baseRevision` equals the previous event's `revision`
- [ ] `UserProjectionStore` references no Mumble, HTTP or JSON type. Verify: `Select-String -Path src/Brmble.Client/Services/Voice/Projection/*.cs -Pattern "MumbleSharp|HttpClient|JsonElement|System.Text.Json"` returns nothing
- [ ] A server input can only reach server-owned fields and a Mumble input only Mumble-owned ones — enforced by the input types, not by a guard
- [ ] The convergence test passes with 500 trials
- [ ] **Nothing calls the store yet.** `MumbleAdapter.cs` and `App.tsx` are untouched by this phase. Verify: `git diff --stat main -- src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Web/src/App.tsx` shows no changes

## Manual smoke test

There is nothing to see: Phase 2 adds no behaviour. The only user-visible surface is Task 1, which is additive on the wire. Confirm it is harmless:

```bash
cd src/Brmble.Web; npm run build; cd ../..
docker compose -f docker-local/docker-compose.yml up -d --build brmble
dotnet run --project src/Brmble.Client
```

Connect and confirm the user list, badges and companions render exactly as before — the client ignores `baseRevision`. The restart symptoms are still present; they are fixed in Phase 3.

---

## Next

**Phase 3** wires the store in and is where the user-visible fixes land: delete `_sessionMappings`, translate wire payloads into the input records from Task 2, collapse the 17 `setUsers` sites to 2, move avatars into their own state keyed by `matrixUserId`, and add client version negotiation via a `pv` query parameter so the server can send a single truthful `companionId` (spec §4.4) instead of the legacy `companionId`/`customCompanionId` split. It touches the two most actively edited files in the repo, so it is planned against shipped code after Phase 2 lands.

