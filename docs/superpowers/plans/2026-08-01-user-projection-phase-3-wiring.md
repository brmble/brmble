# User Projection — Phase 3: Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `UserProjectionStore` the client's only user state, so a Brmble server restart stops blanking badges, reverting companions and flickering the user list.

**Architecture:** Four stages, each independently shippable and green. **A** teaches the client to read the `instanceId`/`revision`/`baseRevision` envelope and routes all three inputs through the store, still emitting today's eight bridge events so React is untouched. **B** adds the resync send path and fixes a socket teardown bug. **C** negotiates a projection version and collapses the two companion wire fields into one. **D** replaces the eight bridge events with two and collapses React's 17 `setUsers` sites to 2.

**Tech Stack:** C# / .NET 10, MSTest, a hand-rolled RFC 6455 WebSocket client over BouncyCastle TLS, React 18 + TypeScript + Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-31-user-projection-design.md` §3.4, §4.4, §5, §6, §8.

**Branch:** `feature/user-projection-phase-3`, branched from `feature/user-projection-phase-2`.

**Baseline — confirm before starting:**

```powershell
git rev-parse --abbrev-ref HEAD     # feature/user-projection-phase-3
dotnet build                        # 0 warnings, 0 errors
dotnet test                         # 1299: Server 782, Client 345, MumbleVoiceEngine 99, Audio 73
cd src/Brmble.Web; npm run test -- --run; cd ../..
```

---

## Background you need

### The client cannot currently sequence anything

Phase 1 put `instanceId` and `revision` on the wire and Phase 2 built a store that sequences on them. **Nothing on the client reads them.** `Select-String -Path src/Brmble.Client/Services/Voice/MumbleAdapter.cs -Pattern "instanceId|revision"` returns nothing.

So Stage A is not merely "call the store instead of the dictionary". The envelope has to be parsed into `ServerSnapshot` and `ServerEvent` first, or `ApplyServerEvent` sees `instanceId: ""` on every event, mismatches its cursor, and returns `NeedsSnapshot` forever.

### There are three user-state stores today, not one

| Field | Line | Keyed by | Holds |
|---|---|---|---|
| `_sessionMappings` | `:66` | session id | matrixUserId, mumbleName, companionId, isBrmbleClient, certHash |
| `_pendingBrmbleStatus` | `:68` | session id | a `bool` announced before its mapping arrived |
| `_userMappings` | `:65` | **mumble name** | matrixUserId, from `/auth/token`'s `userMappings` |

All three die in Stage A. `_userMappings` is easy to miss — it is read as a fallback at `:4191` and `:4315` (`_userMappings.GetValueOrDefault(u.Name)`) and is the reason a user can show a Matrix id with no mapping. The store's `MatrixUserId` replaces it. `_pendingBrmbleStatus` is replaced by the hold map added in Part A of the review fixes.

### The parser drops mappings and invents companions

`ParseSessionMappings` (`:117-139`):

```csharp
if (matrixId is not null && name is not null && companionId is not null)
```

`companionId` comes from `ParseWireCompanionId`, which falls back to `"floppy"` and therefore is *never* null — so that third clause is dead, and every entry silently gains a companion it may not have. Meanwhile a mapping with a null `mumbleName` is dropped entirely.

Both behaviours invert the design's rule 2. The translator written in Stage A replaces this function; do not try to patch it.

### `voice.userJoined` is not a join event

`:4303` emits `voice.userJoined` on **every** `UserState` — channel moves, mutes, comment changes. React's upsert at `App.tsx:2552` exists to cope with that. This is why item 3's "rows must be complete" matters: once the store owns merging, the C# side can emit a complete row on every change and React can replace by session id with no field logic at all.

### The WebSocket stream is a local variable

`:2318` — `var stream = tlsProtocol.Stream;` — lives inside the reconnect loop in `StartWebSocketConnection`. `SendWebSocketFrame` (`:2536`) is `static` and is only ever called from inside `ReadWebSocketFrame` to answer a ping (`:2503`, `:2519`). There is no way to send an application message from outside the loop. Stage B hoists it.

### Threading

`UserProjectionStore` takes its own lock and returns data; it never invokes a callback under the lock. Inputs arrive on three threads — the Mumble protocol thread (`UserState`/`UserRemove`), the WebSocket read loop, and the HTTP continuation in `FetchAndSendCredentials`. Emit to the bridge **after** `Apply*` returns, never inside it. `_bridge?.Send` followed by `_bridge?.NotifyUiThread()` is the existing convention and is already thread-safe (`NativeBridge` marshals via `PostMessage`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/Brmble.Client/Services/Voice/ProjectionWire.cs` | *Create* — JSON ⇄ projection input translation. Lives **outside** `Projection/` so the store keeps its no-JSON guarantee. |
| `src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs` | *Modify* — Stage B adds a resync-request hook only |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | *Modify* — all four stages |
| `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs` | *Modify* — Stage C reads `pv` |
| `src/Brmble.Server/Auth/AuthEndpoints.cs` | *Modify* — Stage C |
| `src/Brmble.Server/Mumble/CompanionWireSelection.cs` | *Modify* — Stage C gains a `pv>=1` shape |
| `src/Brmble.Web/src/hooks/useUserDirectory.ts` | *Create* — Stage D |
| `src/Brmble.Web/src/types/index.ts` | *Modify* — Stage D merges the two `User` types |
| `src/Brmble.Web/src/App.tsx` | *Modify* — Stage D |

---

# STAGE A — Envelope parsing and store wiring

**Outcome:** the store is the only user state in `MumbleAdapter`. The eight bridge events still fire, now derived from the store, so React is untouched and the app behaves identically. This stage alone fixes nothing user-visible; it makes Stage D small.

## Task A1: The wire translator

**Files:**
- Create: `src/Brmble.Client/Services/Voice/ProjectionWire.cs`
- Test: `tests/Brmble.Client.Tests/Services/ProjectionWireTests.cs` (create)

**Why:** the store must never see a `JsonElement` (Phase 2 "Done when" item). Translation is pure and therefore the cheapest thing in the system to test exhaustively — every wire quirk gets pinned here rather than discovered in the adapter.

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/ProjectionWireTests.cs`:

```csharp
using System.Text.Json;
using Brmble.Client.Services.Voice;
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class ProjectionWireTests
{
    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    [TestMethod]
    public void ReadSnapshot_ReadsTheEnvelopeAndEveryMapping()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        {
          "instanceId": "inst-a",
          "revision": 7,
          "mappings": {
            "3": { "matrixUserId": "@alice:test", "mumbleName": "Alice",
                   "companionId": "retro", "certHash": "abc", "isBrmbleClient": true }
          }
        }
        """));

        Assert.IsNotNull(snapshot);
        Assert.AreEqual("inst-a", snapshot!.InstanceId);
        Assert.AreEqual(7L, snapshot.Revision);
        var entry = snapshot.Mappings[3];
        Assert.AreEqual("@alice:test", entry.MatrixUserId);
        Assert.AreEqual("retro", entry.CompanionId);
        Assert.AreEqual(true, entry.IsBrmbleClient);
        Assert.AreEqual("abc", entry.CertHash);
    }

    [TestMethod]
    public void ReadSnapshot_KeepsAMappingWithNoMumbleName()
    {
        // The old ParseSessionMappings dropped these outright, losing the identity entirely.
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "matrixUserId": "@alice:test" } } }
        """));

        Assert.AreEqual("@alice:test", snapshot!.Mappings[3].MatrixUserId);
    }

    [TestMethod]
    public void ReadSnapshot_AbsentCompanionIsUnknownNotFloppy()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "matrixUserId": "@a:t" } } }
        """));

        Assert.IsNull(snapshot!.Mappings[3].CompanionId,
            "a default must never be transmitted as though it were a fact");
    }

    [TestMethod]
    public void ReadSnapshot_NullIsBrmbleClientIsUnknownNotFalse()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "matrixUserId": "@a:t", "isBrmbleClient": null } } }
        """));

        Assert.IsNull(snapshot!.Mappings[3].IsBrmbleClient);
    }

    [TestMethod]
    public void ReadSnapshot_PrefersACustomCompanionOverTheLegacyField()
    {
        var snapshot = ProjectionWire.ReadSnapshot(Json("""
        { "instanceId": "i", "revision": 1,
          "mappings": { "3": { "companionId": "floppy",
                               "customCompanionId": "custom:$abc" } } }
        """));

        Assert.AreEqual("custom:$abc", snapshot!.Mappings[3].CompanionId,
            "the legacy split sends floppy alongside the truth; the truth wins");
    }

    [TestMethod]
    public void ReadSnapshot_ReturnsNullWhenTheEnvelopeIsMissing()
    {
        Assert.IsNull(ProjectionWire.ReadSnapshot(Json("""{ "mappings": {} }""")));
    }

    [TestMethod]
    public void ReadEvent_ReadsAMappingAddedWithItsRange()
    {
        var evt = ProjectionWire.ReadEvent("userMappingAdded", Json("""
        { "instanceId": "inst-a", "baseRevision": 4, "revision": 7, "sessionId": 3,
          "matrixUserId": "@alice:test", "companionId": "retro", "isBrmbleClient": true }
        """));

        Assert.IsNotNull(evt);
        Assert.AreEqual(ServerEventKind.MappingAdded, evt!.Kind);
        Assert.AreEqual(4L, evt.BaseRevision);
        Assert.AreEqual(7L, evt.Revision);
        Assert.AreEqual(3u, evt.SessionId);
        Assert.AreEqual("retro", evt.Entry!.CompanionId);
    }

    [TestMethod]
    public void ReadEvent_ActivationCarriesNoEntry()
    {
        var evt = ProjectionWire.ReadEvent("brmbleClientActivated", Json("""
        { "instanceId": "i", "baseRevision": 1, "revision": 2, "sessionId": 3 }
        """));

        Assert.AreEqual(ServerEventKind.BrmbleActivated, evt!.Kind);
        Assert.IsNull(evt.Entry);
    }

    [TestMethod]
    public void ReadEvent_DefaultsAMissingBaseRevisionToOneBelowRevision()
    {
        // A server predating Phase 1 sends no baseRevision. Assuming a single bump is the
        // only reading that lets an old server still drive a new client.
        var evt = ProjectionWire.ReadEvent("companionChanged", Json("""
        { "instanceId": "i", "revision": 9, "sessionId": 3, "companionId": "bee" }
        """));

        Assert.AreEqual(8L, evt!.BaseRevision);
    }

    [TestMethod]
    public void ReadEvent_ReturnsNullForAnUnknownType()
    {
        Assert.IsNull(ProjectionWire.ReadEvent("screenShare.started", Json("{}")));
    }

    [TestMethod]
    public void ReadEvent_ReturnsNullWithoutASessionId()
    {
        Assert.IsNull(ProjectionWire.ReadEvent("companionChanged",
            Json("""{ "instanceId": "i", "revision": 2 }""")));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~ProjectionWireTests"`

Expected: FAIL — compile error, `The name 'ProjectionWire' does not exist in the current context`.

- [ ] **Step 3: Write the translator**

Create `src/Brmble.Client/Services/Voice/ProjectionWire.cs`:

```csharp
using System.Text.Json;
using Brmble.Client.Services.Voice.Projection;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Translates Brmble wire payloads into <see cref="UserProjectionStore"/> inputs.
/// </summary>
/// <remarks>
/// This is the only place that knows both JSON and the projection. Keeping it out of the
/// <c>Projection</c> namespace is what lets the store be unit-tested without a protocol stack,
/// and what stops wire quirks leaking into the merge rules.
/// </remarks>
internal static class ProjectionWire
{
    /// <summary>
    /// Reads a <c>sessionMappingSnapshot</c> or an <c>/auth/token</c> body. Returns null when the
    /// payload carries no envelope, because a snapshot without one cannot establish a cursor.
    /// </summary>
    internal static ServerSnapshot? ReadSnapshot(JsonElement root)
    {
        var instanceId = ReadString(root, "instanceId");
        if (string.IsNullOrEmpty(instanceId)) return null;
        if (!root.TryGetProperty("revision", out var revision) ||
            revision.ValueKind != JsonValueKind.Number) return null;

        var mappings = new Dictionary<uint, ServerMappingEntry>();
        if (root.TryGetProperty("mappings", out var raw) && raw.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in raw.EnumerateObject())
            {
                if (!uint.TryParse(property.Name, out var sessionId)) continue;
                mappings[sessionId] = ReadEntry(property.Value);
            }
        }

        return new ServerSnapshot(instanceId, revision.GetInt64(), mappings);
    }

    /// <summary>
    /// Reads one incremental mapping event. Returns null for any payload that is not one — the
    /// caller dispatches every WebSocket message through here.
    /// </summary>
    internal static ServerEvent? ReadEvent(string? type, JsonElement root)
    {
        var kind = type switch
        {
            "userMappingAdded" => ServerEventKind.MappingAdded,
            "userMappingRemoved" => ServerEventKind.MappingRemoved,
            "companionChanged" => ServerEventKind.CompanionChanged,
            "brmbleClientActivated" => ServerEventKind.BrmbleActivated,
            "brmbleClientDeactivated" => ServerEventKind.BrmbleDeactivated,
            _ => (ServerEventKind?)null
        };
        if (kind is null) return null;

        var instanceId = ReadString(root, "instanceId");
        if (string.IsNullOrEmpty(instanceId)) return null;

        if (!root.TryGetProperty("sessionId", out var session) ||
            session.ValueKind != JsonValueKind.Number) return null;
        var sessionId = session.GetUInt32();
        if (sessionId == 0) return null;

        if (!root.TryGetProperty("revision", out var revisionProperty) ||
            revisionProperty.ValueKind != JsonValueKind.Number) return null;
        var revision = revisionProperty.GetInt64();

        // A server predating Phase 1 sends no baseRevision. Assuming the operation bumped once
        // is the only reading under which an old server can still drive a new client; a wrong
        // guess costs one redundant snapshot, not a wrong value.
        var baseRevision = root.TryGetProperty("baseRevision", out var b) &&
                           b.ValueKind == JsonValueKind.Number
            ? b.GetInt64()
            : revision - 1;

        // Removal and the two activation events assert their meaning through Kind alone; only
        // the field-carrying events need an entry.
        var entry = kind is ServerEventKind.MappingAdded or ServerEventKind.CompanionChanged
            ? ReadEntry(root)
            : null;

        return new ServerEvent(kind.Value, instanceId, baseRevision, revision, sessionId, entry);
    }

    /// <summary>
    /// Reads the server-owned half of one session. Every absent field becomes null, which the
    /// store reads as "not known" — this is where the old parser's <c>"floppy"</c> default and
    /// its <c>isBrmbleClient: false</c> default are removed.
    /// </summary>
    private static ServerMappingEntry ReadEntry(JsonElement element) =>
        new(ReadString(element, "matrixUserId"),
            ReadCompanionId(element),
            ReadNullableBool(element, "isBrmbleClient"),
            ReadString(element, "certHash"));

    /// <summary>
    /// Prefers the custom companion over the legacy field. The legacy split transmits
    /// <c>companionId: "floppy"</c> alongside the real selection in <c>customCompanionId</c>,
    /// so reading the legacy field first would turn every custom skin into a floppy.
    /// </summary>
    private static string? ReadCompanionId(JsonElement element)
    {
        if (ReadString(element, "customCompanionId") is { } custom &&
            custom.StartsWith("custom:$", StringComparison.Ordinal))
            return custom;

        return ReadString(element, "companionId");
    }

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool? ReadNullableBool(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null
            }
            : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~ProjectionWireTests"`

Expected: PASS, eleven tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/ProjectionWire.cs tests/Brmble.Client.Tests/Services/ProjectionWireTests.cs
git commit -m "feat: translate mapping wire payloads into projection inputs"
```

## Task A2: Row serialisation

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/ProjectionWire.cs`
- Test: `tests/Brmble.Client.Tests/Services/ProjectionWireTests.cs`

**Why:** six payload shapes (`:4181`, `:4305`, `:2632`, `:2666`, and the two `voice.userLeft` variants) each rebuild a user row by hand, with different field names and different null handling. One serialiser replaces all of them, and Stage D reuses it unchanged.

- [ ] **Step 1: Write the failing test**

Append to `ProjectionWireTests`:

```csharp
    [TestMethod]
    public void ToWireRow_EmitsEveryFieldWithNullsExplicit()
    {
        var row = new UserProjection
        {
            SessionId = 3,
            Name = "Alice",
            ChannelId = 5,
            Muted = true,
            Deafened = false,
            Comment = "hi",
            MumbleCertHash = "live",
            IsSelf = true,
            MatrixUserId = "@alice:test",
            CompanionId = null,
            IsBrmbleClient = null,
            ServerCertHash = "stored"
        };

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(ProjectionWire.ToWireRow(row)));
        var json = doc.RootElement;

        Assert.AreEqual(3, json.GetProperty("session").GetInt32());
        Assert.AreEqual("Alice", json.GetProperty("name").GetString());
        Assert.AreEqual(5, json.GetProperty("channelId").GetInt32());
        Assert.IsTrue(json.GetProperty("muted").GetBoolean());
        Assert.IsTrue(json.GetProperty("self").GetBoolean());
        Assert.AreEqual("live", json.GetProperty("certHash").GetString(),
            "the live certificate wins over the server's recorded copy");

        // Nulls must be present rather than omitted: React replaces rows wholesale, so an
        // absent key and a null key must not mean different things.
        Assert.AreEqual(JsonValueKind.Null, json.GetProperty("companionId").ValueKind);
        Assert.AreEqual(JsonValueKind.Null, json.GetProperty("isBrmbleClient").ValueKind);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~ToWireRow"`

Expected: FAIL — `'ProjectionWire' does not contain a definition for 'ToWireRow'`.

- [ ] **Step 3: Add the serialiser**

Append to `ProjectionWire`:

```csharp
    /// <summary>
    /// The single wire shape for a user row. Every field is always present, nulls included, so a
    /// consumer replaces by session id and never merges field-by-field.
    /// </summary>
    internal static object ToWireRow(UserProjection row) => new
    {
        session = row.SessionId,
        name = row.Name,
        channelId = row.ChannelId,
        muted = row.Muted,
        deafened = row.Deafened,
        self = row.IsSelf,
        comment = row.Comment,
        certHash = row.CertHash,
        matrixUserId = row.MatrixUserId,
        companionId = row.CompanionId,
        isBrmbleClient = row.IsBrmbleClient
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~ProjectionWireTests"`

Expected: PASS, twelve tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/ProjectionWire.cs tests/Brmble.Client.Tests/Services/ProjectionWireTests.cs
git commit -m "feat: add one wire row shape for the projection"
```

## Task A3: Feed the store from Mumble

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (`:66`, `:4247-4393`, `:4495-4595`, `:4174-4212`)
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterProjectionTests.cs` (create)

**Why:** Mumble owns existence. Until `UserState` and `UserRemove` reach the store, nothing else can.

- [ ] **Step 1: Add the field and a translation helper**

In `MumbleAdapter.cs`, immediately after `_sessionMappings` (`:66`), add:

```csharp
    /// <summary>
    /// The authoritative user projection. Replaces _sessionMappings, _pendingBrmbleStatus and
    /// _userMappings: it merges Mumble presence and Brmble identity under one set of rules
    /// rather than three ad-hoc ones spread across the adapter and App.tsx.
    /// </summary>
    private readonly Projection.UserProjectionStore _projection = new();
```

Add near `SendVoiceConnected`:

```csharp
    /// <summary>
    /// Reduces a MumbleSharp user to the fields Mumble owns. Muted folds server mute, self mute
    /// and both deafen flags together, matching what the UI has always shown.
    /// </summary>
    private Projection.MumbleUserInput ToProjectionInput(MumbleSharp.Model.User user) =>
        new(user.Id,
            user.Name,
            user.Channel?.Id ?? 0,
            user.Muted || user.SelfMuted || user.Deaf || user.SelfDeaf,
            user.Deaf || user.SelfDeaf,
            user.Comment,
            user.CertificateHash,
            user == LocalUser);
```

- [ ] **Step 2: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/MumbleAdapterProjectionTests.cs`. Test the store contract the adapter depends on, since `MumbleAdapter` itself needs a live protocol stack:

```csharp
using Brmble.Client.Services.Voice;
using Brmble.Client.Services.Voice.Projection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

/// <summary>
/// The ordering guarantees MumbleAdapter relies on when it drives the store from three threads.
/// </summary>
[TestClass]
public class MumbleAdapterProjectionTests
{
    [TestMethod]
    public void AuthTokenSnapshotBeforeUserStateStillEnrichesTheRow()
    {
        // The real connect ordering: ServerSync -> FetchAndSendCredentials -> SendVoiceConnected.
        var store = new UserProjectionStore();
        var snapshot = ProjectionWire.ReadSnapshot(System.Text.Json.JsonDocument.Parse("""
        { "instanceId": "inst-a", "revision": 3,
          "mappings": { "1": { "matrixUserId": "@alice:test", "companionId": "retro",
                               "isBrmbleClient": true } } }
        """).RootElement);

        store.ApplyServerSnapshot(snapshot!);
        var change = store.ApplyMumbleReset([new MumbleUserInput(1, "Alice", 0, false, false, null, null, true)]);

        var row = change.Changed.Single();
        Assert.AreEqual("@alice:test", row.MatrixUserId);
        Assert.AreEqual("retro", row.CompanionId);
        Assert.AreEqual(true, row.IsBrmbleClient);
    }

    [TestMethod]
    public void AChannelMoveDoesNotDisturbIdentity()
    {
        var store = new UserProjectionStore();
        store.ApplyMumbleUserState(new MumbleUserInput(1, "Alice", 0, false, false, null, null, false));
        store.ApplyServerSnapshot(new ServerSnapshot("i", 1,
            new Dictionary<uint, ServerMappingEntry> { [1] = new("@a:t", "retro", true, null) }));

        var change = store.ApplyMumbleUserState(
            new MumbleUserInput(1, "Alice", 9, false, false, null, null, false));

        Assert.AreEqual(9u, change.Changed.Single().ChannelId);
        Assert.AreEqual(true, change.Changed.Single().IsBrmbleClient);
    }
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterProjectionTests"`

Expected: FAIL — compile error, `ProjectionWire` is `internal` to `Brmble.Client` but `InternalsVisibleTo` already covers the test project, so the real failure is `MumbleUserInput` ambiguity only if `using` lines are wrong. If it compiles and passes immediately, the store already satisfies the contract — that is acceptable here because these are regression pins for Stage A's wiring, not new behaviour. Note it and continue.

- [ ] **Step 4: Drive the store from the protocol handlers**

In `UserState` (`:4247`), after `base.UserState(userState);` (`:4261`), add:

```csharp
        // Mumble resends the complete UserState on every change, so this is authoritative for
        // every Mumble-owned field including the ones that went empty.
        if (user is not null) _projection.ApplyMumbleUserState(ToProjectionInput(user));
```

In `UserRemove` (`:4495`), after `base.UserRemove(userRemove);` (`:4505`), add:

```csharp
        // The only path that deletes a row: Mumble alone owns existence.
        _projection.ApplyMumbleUserRemove(userRemove.Session);
```

In `SendVoiceConnected` (`:4174`), before building the payload, add:

```csharp
        // A reconnect replaces membership wholesale. Server-owned fields survive for sessions
        // present both before and after, so a voice reconnect costs no identity.
        _projection.ApplyMumbleReset([.. Users.Select(ToProjectionInput)]);
```

- [ ] **Step 5: Run the full client suite**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS. The store is being written but not yet read, so nothing changes behaviourally.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterProjectionTests.cs
git commit -m "feat: drive the user projection from Mumble presence"
```

## Task A4: Feed the store from the server, and read from it

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (`:2000-2020`, `:2611-2714`, `:4174-4212`, `:4303-4321`)

**Why:** this is the switch-over. After it, `_sessionMappings`, `_pendingBrmbleStatus` and `_userMappings` are dead.

- [ ] **Step 1: Route `/auth/token` through the store**

Replace `:2013-2018` (the `sessionMappings` block) with:

```csharp
        // The credential body carries the same envelope as a WebSocket snapshot, so it
        // establishes the cursor too. Without this the first event after connect looks like a
        // gap and the client resyncs immediately.
        if (ProjectionWire.ReadSnapshot(credentials.Value) is { } tokenSnapshot)
        {
            var change = _projection.ApplyServerSnapshot(tokenSnapshot);
            EmitProjectionChange(change);
        }
```

Delete the `userMappings` block at `:2001-2010` and the `_userMappings` field at `:65`. Its two readers (`:4191`, `:4315`) are replaced in Step 3.

- [ ] **Step 2: Route WebSocket messages through the store**

In `HandleWebSocketMessage` (`:2611`), replace the five mapping cases (`sessionMappingSnapshot`, `userMappingAdded`, `companionChanged`, `userMappingRemoved`, `brmbleClientActivated`, `brmbleClientDeactivated`) with a single pre-dispatch block placed immediately after `var type = ...` (`:2617`):

```csharp
            // Every mapping payload goes through the projection. The store decides whether the
            // event is contiguous, a duplicate or a gap; the adapter only relays the result.
            if (type == "sessionMappingSnapshot")
            {
                if (ProjectionWire.ReadSnapshot(root) is { } wsSnapshot)
                    EmitProjectionChange(_projection.ApplyServerSnapshot(wsSnapshot));
                return;
            }

            if (ProjectionWire.ReadEvent(type, root) is { } mappingEvent)
            {
                EmitProjectionChange(_projection.ApplyServerEvent(mappingEvent));
                return;
            }
```

Leave the `screenShare.*` and `acl.changed` cases untouched.

- [ ] **Step 3: Emit the existing eight events from the store**

Add:

```csharp
    /// <summary>
    /// Relays a change set to the UI. Stage A keeps the legacy event set so React is unchanged;
    /// Stage D replaces the body with two events.
    /// </summary>
    /// <remarks>
    /// Called after Apply* has returned and released the store's lock — never inside it.
    /// </remarks>
    private void EmitProjectionChange(Projection.ChangeSet change)
    {
        if (change.IsEmpty) return;

        foreach (var row in change.Changed)
            _bridge?.Send("voice.userJoined", ProjectionWire.ToWireRow(row));

        foreach (var sessionId in change.Removed)
            _bridge?.Send("voice.userLeft", new { session = sessionId, moved = false });

        if (change.Changed.Count > 0 || change.Removed.Count > 0) _bridge?.NotifyUiThread();
    }
```

In `SendVoiceConnected` (`:4178-4195`), replace the hand-built `users` projection with:

```csharp
            users = _projection.Snapshot().Values.Select(ProjectionWire.ToWireRow).ToArray(),
```

In `UserState` (`:4303-4321`), replace the whole `voice.userJoined` emit with a call driven by the store:

```csharp
        if (user is not null)
            EmitProjectionChange(_projection.ApplyMumbleUserState(ToProjectionInput(user)));
```

(This supersedes the `ApplyMumbleUserState` call added in Task A3 Step 4 — there must be exactly one.)

- [ ] **Step 4: Delete the dead state**

Remove: `_sessionMappings` (`:66`), `_pendingBrmbleStatus` (`:68-75`), `_userMappings` (`:65`), `SessionMappingEntry` (`:110`), `ParseSessionMappings` (`:117-139`), `ParseWireCompanionId` (`:141-142`), `ParseWireCompanionIdOrNull` (`:144-159`), `RecordBrmbleStatus` (`:2586-2600`), `ApplyPendingBrmbleStatus` (`:2602-2609`), and the `_sessionMappings.Clear()` at `:546` and `:2015`.

Point `GetSelfCompanionOrDefault` (`:2104`) and `UpdateSelfCompanionMapping` (`:2116`) at the store:

```csharp
    private string GetSelfCompanionOrDefault()
    {
        if (LocalUser is null) return "floppy";
        // "floppy" is a render-time fallback for an unknown companion, never a stored value.
        return _projection.Snapshot().TryGetValue(LocalUser.Id, out var row)
               && !string.IsNullOrWhiteSpace(row.CompanionId)
            ? row.CompanionId!
            : "floppy";
    }
```

`UpdateSelfCompanionMapping` is deleted outright: the server announces the change and the store applies it, so writing a local guess is exactly the "confidently wrong value" the design removes. Delete its only call site at `:2180`.

- [ ] **Step 5: Fix the fallout and run everything**

Run: `dotnet build`

Expect errors at every deleted symbol. Any test referencing `ParseSessionMappings` or `SessionMappingEntry` moves to `ProjectionWireTests`; delete tests that only asserted the `"floppy"` default, and note in the commit body which ones and why.

Run: `dotnet test`

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: make the projection the client's only user state"
```

---

# STAGE B — Resync and socket lifetime

**Outcome:** a gap or a restart repairs itself. Today `NeedsSnapshot` has nowhere to go.

## Task B1: Hoist the stream and add a send lock

**Files:** `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (`:2272-2438`, `:2536`)

- [ ] **Step 1: Add the fields**

```csharp
    /// <summary>
    /// The live WebSocket stream, or null when disconnected. Hoisted out of the reconnect loop
    /// so application messages can be sent; guarded by _wsSendGate because the read loop answers
    /// pings on the same socket and two interleaved frames corrupt the stream.
    /// </summary>
    private Stream? _wsStream;
    private readonly SemaphoreSlim _wsSendGate = new(1, 1);
```

- [ ] **Step 2: Assign and clear it**

At `:2318`, after `var stream = tlsProtocol.Stream;`, add `_wsStream = stream;`. In the `finally` at `:2419`, add `_wsStream = null;` **before** `tlsProtocol?.Close()`.

- [ ] **Step 3: Route every send through the gate**

Change `SendWebSocketFrame` from `static` to an instance method and wrap its body:

```csharp
    private async Task SendWebSocketFrame(Stream stream, int opcode, byte[] data)
    {
        await _wsSendGate.WaitAsync();
        try
        {
            // ... existing body unchanged ...
        }
        finally
        {
            _wsSendGate.Release();
        }
    }
```

`ReadWebSocketFrame` is `static` and calls this for pongs (`:2503`, `:2519`); make it an instance method too, or pass a `Func<int, byte[], Task>` sender. Prefer the former — it is a smaller diff.

- [ ] **Step 4: Build and commit**

```bash
dotnet build
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "refactor: hoist the websocket stream so the client can send"
```

## Task B2: Request a snapshot when the store asks

**Files:** `MumbleAdapter.cs`; Test: `tests/Brmble.Client.Tests/Services/ResyncThrottleTests.cs` (create)

**Why:** item 7 — a persistent mismatch must never become a hot loop. Extract the throttle so it is testable without a socket.

- [ ] **Step 1: Write the failing test**

```csharp
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class ResyncThrottleTests
{
    [TestMethod]
    public void AllowsTheFirstRequestImmediately()
    {
        var throttle = new ResyncThrottle();
        Assert.IsTrue(throttle.TryBegin(TimeSpan.Zero));
    }

    [TestMethod]
    public void RefusesASecondRequestWhileOneIsInFlight()
    {
        var throttle = new ResyncThrottle();
        throttle.TryBegin(TimeSpan.Zero);

        Assert.IsFalse(throttle.TryBegin(TimeSpan.FromSeconds(5)),
            "one in flight at a time, or a burst of events becomes a burst of snapshots");
    }

    [TestMethod]
    public void EnforcesMinimumSpacingAfterCompletion()
    {
        var throttle = new ResyncThrottle();
        throttle.TryBegin(TimeSpan.Zero);
        throttle.Complete(TimeSpan.FromMilliseconds(100));

        Assert.IsFalse(throttle.TryBegin(TimeSpan.FromMilliseconds(200)));
        Assert.IsTrue(throttle.TryBegin(TimeSpan.FromMilliseconds(1200)));
    }

    [TestMethod]
    public void BacksOffExponentiallyToThirtySeconds()
    {
        var throttle = new ResyncThrottle();
        var now = TimeSpan.Zero;

        for (var i = 0; i < 12; i++)
        {
            now += TimeSpan.FromMinutes(1);
            Assert.IsTrue(throttle.TryBegin(now), $"attempt {i} should be allowed after a long wait");
            throttle.Complete(now);
        }

        Assert.AreEqual(TimeSpan.FromSeconds(30), throttle.CurrentDelay,
            "backoff must saturate rather than grow without bound");
    }

    [TestMethod]
    public void ResetsBackoffOnceASnapshotArrives()
    {
        var throttle = new ResyncThrottle();
        throttle.TryBegin(TimeSpan.Zero);
        throttle.Complete(TimeSpan.Zero);
        throttle.TryBegin(TimeSpan.FromSeconds(10));
        throttle.Complete(TimeSpan.FromSeconds(10));

        throttle.OnSnapshotApplied();

        Assert.AreEqual(TimeSpan.FromSeconds(1), throttle.CurrentDelay);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~ResyncThrottleTests"`

Expected: FAIL — `The type or namespace name 'ResyncThrottle' could not be found`.

- [ ] **Step 3: Write it**

Create `src/Brmble.Client/Services/Voice/ResyncThrottle.cs`:

```csharp
namespace Brmble.Client.Services.Voice;

/// <summary>
/// Rate-limits snapshot requests. A client whose cursor cannot be repaired — a server bug, a
/// truncated event stream — would otherwise request a snapshot for every event it receives.
/// </summary>
/// <remarks>
/// Time is passed in rather than read from a clock so the policy is testable without waiting.
/// </remarks>
internal sealed class ResyncThrottle
{
    private static readonly TimeSpan MinimumSpacing = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaximumDelay = TimeSpan.FromSeconds(30);

    private readonly object _gate = new();
    private bool _inFlight;
    private TimeSpan? _lastCompleted;

    public TimeSpan CurrentDelay { get; private set; } = MinimumSpacing;

    public bool TryBegin(TimeSpan now)
    {
        lock (_gate)
        {
            if (_inFlight) return false;
            if (_lastCompleted is { } last && now - last < CurrentDelay) return false;

            _inFlight = true;
            return true;
        }
    }

    /// <summary>Marks the request finished and widens the delay for the next one.</summary>
    public void Complete(TimeSpan now)
    {
        lock (_gate)
        {
            _inFlight = false;
            _lastCompleted = now;
            var doubled = CurrentDelay * 2;
            CurrentDelay = doubled > MaximumDelay ? MaximumDelay : doubled;
        }
    }

    /// <summary>A snapshot landed and the cursor is healthy, so the backoff has done its job.</summary>
    public void OnSnapshotApplied()
    {
        lock (_gate) CurrentDelay = MinimumSpacing;
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Expected: PASS, five tests.

- [ ] **Step 5: Wire it in**

Add `private readonly ResyncThrottle _resync = new();` and a stopwatch field `private readonly System.Diagnostics.Stopwatch _resyncClock = System.Diagnostics.Stopwatch.StartNew();`.

In `EmitProjectionChange`, before the row loop:

```csharp
        if (change.NeedsSnapshot) RequestSnapshot();
```

Add:

```csharp
    /// <summary>
    /// Asks the server to restate the mapping table. Fire-and-forget: the reply arrives as a
    /// normal sessionMappingSnapshot on the read loop.
    /// </summary>
    private void RequestSnapshot()
    {
        if (!_resync.TryBegin(_resyncClock.Elapsed)) return;

        var stream = _wsStream;
        if (stream is null)
        {
            // No socket: the reconnect will bring a bootstrap snapshot anyway.
            _resync.Complete(_resyncClock.Elapsed);
            return;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                var payload = System.Text.Json.JsonSerializer.Serialize(new { type = "requestSnapshot" });
                await SendWebSocketFrame(stream, 0x1, System.Text.Encoding.UTF8.GetBytes(payload));
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Brmble] resync request failed: {ex.Message}");
            }
            finally
            {
                _resync.Complete(_resyncClock.Elapsed);
            }
        });
    }
```

In the `sessionMappingSnapshot` branch added in Task A4, call `_resync.OnSnapshotApplied();` after applying.

- [ ] **Step 6: Build, test, commit**

```bash
dotnet build
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
git add src tests
git commit -m "feat: request a snapshot when the projection detects a gap"
```

## Task B3: Stop tearing down a working socket

**Files:** `MumbleAdapter.cs:2033-2034`

**Why:** `FetchAndSendCredentials` calls `StartWebSocketConnection` unconditionally. It is reachable from `ServerSync` on every reconnect and from the health-check path, so a credential refresh kills a socket that was working — and because `ReadExactAsync` (`:2579`) calls `stream.ReadAsync` **without** the cancellation token, the old read only unblocks when the TLS stream is disposed, racing the new connection.

- [ ] **Step 1: Add the guard**

Replace `:2034`:

```csharp
        // Only connect if we do not already have a live socket. A credential refresh — which the
        // health check can trigger at any time — must not tear down a working connection: the
        // old read loop does not observe cancellation until its stream is disposed, so the two
        // connections race and the surviving one may be the one being torn down.
        if (_wsStream is null) StartWebSocketConnection(apiUrl);
```

- [ ] **Step 2: Pass the token to the blocking read**

At `:2579`, add the token so cancellation is observed promptly:

```csharp
            var read = await stream.ReadAsync(buffer.AsMemory(offset + totalRead, count - totalRead), ct);
```

- [ ] **Step 3: Verify manually**

```bash
docker compose -f docker-local/docker-compose.yml up -d --build brmble
dotnet run --project src/Brmble.Client
```

Connect, wait for two health-check cycles, confirm the log shows exactly one `session/connected` and no reconnect churn.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "fix: do not restart a live websocket on credential refresh"
```

---

# STAGE C — Version negotiation and the companion collapse

**Outcome:** one truthful `companionId` for clients that announce support; the legacy lie confined to the compatibility boundary.

## Task C1: Server reads `pv`

**Files:** `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`; Test: `tests/Brmble.Server.Tests/WebSockets/ProjectionVersionTests.cs` (create)

- [ ] **Step 1: Write the failing test**

```csharp
using Brmble.Server.WebSockets;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.WebSockets;

[TestClass]
public class ProjectionVersionTests
{
    [TestMethod]
    public void AbsentQueryParameterIsVersionZero() =>
        Assert.AreEqual(0, BrmbleWebSocketHandler.ParseProjectionVersion(null));

    [TestMethod]
    public void ParsesAnExplicitVersion() =>
        Assert.AreEqual(1, BrmbleWebSocketHandler.ParseProjectionVersion("1"));

    [TestMethod]
    public void GarbageIsVersionZero()
    {
        // A malformed parameter must degrade to the legacy shape, never throw a client off.
        Assert.AreEqual(0, BrmbleWebSocketHandler.ParseProjectionVersion("banana"));
        Assert.AreEqual(0, BrmbleWebSocketHandler.ParseProjectionVersion("-3"));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `does not contain a definition for 'ParseProjectionVersion'`.

- [ ] **Step 3: Implement**

```csharp
    /// <summary>
    /// Reads the client's projection version from the <c>pv</c> query parameter. Absent or
    /// malformed means version 0, which gets the legacy companion split.
    /// </summary>
    internal static int ParseProjectionVersion(string? raw) =>
        int.TryParse(raw, out var version) && version > 0 ? version : 0;
```

Call it in `HandleAsync` **before** `AcceptWebSocketAsync`, so the version is known while initial payloads are built:

```csharp
        var projectionVersion = ParseProjectionVersion(context.Request.Query["pv"]);
```

Thread it through `InitializeAcceptedClientAsync` and `BuildInitialPayloadsAsync` as a parameter.

- [ ] **Step 4: Run, then commit**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ProjectionVersionTests"
git add src/Brmble.Server tests/Brmble.Server.Tests
git commit -m "feat: negotiate a projection version on the websocket"
```

## Task C2: One companion field for `pv>=1`

**Files:** `src/Brmble.Server/Mumble/CompanionWireSelection.cs`, every payload builder that calls it

- [ ] **Step 1: Write the failing test**

Add to the existing companion wire test suite:

```csharp
    [TestMethod]
    public void Version1SendsTheCustomSelectionInCompanionId()
    {
        var wire = CompanionWireSelection.For("custom:$abc", projectionVersion: 1);

        Assert.AreEqual("custom:$abc", wire.CompanionId);
        Assert.IsNull(wire.CustomCompanionId, "the split exists only for clients that need it");
    }

    [TestMethod]
    public void Version0KeepsTheLegacySplit()
    {
        var wire = CompanionWireSelection.For("custom:$abc", projectionVersion: 0);

        Assert.AreEqual("floppy", wire.CompanionId);
        Assert.AreEqual("custom:$abc", wire.CustomCompanionId);
    }

    [TestMethod]
    public void AnUnknownCompanionIsNullAtVersion1()
    {
        // Absent must not be transmitted as "floppy": that is the defect the design removes.
        Assert.IsNull(CompanionWireSelection.For(null, projectionVersion: 1).CompanionId);
    }
```

- [ ] **Step 2: Run to verify it fails, then implement**

```csharp
    /// <summary>
    /// Builds the companion fields for a client at the given projection version.
    /// </summary>
    /// <remarks>
    /// Version 0 predates custom companions being first-class and cannot parse
    /// <c>custom:$…</c> in <c>companionId</c>, so it gets <c>"floppy"</c> plus the truth in
    /// <c>customCompanionId</c>. That is a lie told at the compatibility boundary; it must never
    /// reach the projection.
    /// </remarks>
    public static CompanionWireSelection For(string? persisted, int projectionVersion)
    {
        if (projectionVersion >= 1) return new CompanionWireSelection(persisted, null);
        return FromPersisted(persisted);
    }
```

Keep `FromPersisted` as the version-0 implementation so existing callers and tests are undisturbed.

- [ ] **Step 3: Thread the version through every mapping payload builder**

`CreateUserMappingAddedPayload`, `SessionMappingWire.From`, `AuthEndpoints`' `/auth/token` and `PersistCompanionSelectionAsync`, `CustomCompanionEndpoints`, `SessionMappingHandler`. Broadcast events go to clients at mixed versions, so a broadcast **must** send the legacy split; only per-socket payloads (initial snapshot, and anything sent with `SendToClientAsync`) can use version 1.

**Write this down in a comment at each broadcast site**, because it is the non-obvious constraint of this stage:

```csharp
        // Broadcast: recipients are at mixed projection versions, so this must carry the legacy
        // split. Only per-socket payloads know their reader's version.
```

- [ ] **Step 4: Client announces the version**

In `MumbleAdapter.cs:2286`, change the path construction:

```csharp
        // Announce projection version 1: send one truthful companion field rather than the split.
        var wsPath = builder.Path.TrimEnd('/') + "/ws?pv=1";
```

- [ ] **Step 5: Test and commit**

```bash
dotnet test
git add src tests
git commit -m "feat: send one truthful companion field to pv>=1 clients"
```

## Task C3: Decide on `TryUpdateCompanionIdIfCurrent`

**Files:** `src/Brmble.Server/Mumble/ISessionMappingService.cs` and implementation

Item 12 is conditional. `TryUpdateCompanionIdIfCurrent` is a per-field compare-and-swap added by `custom-companion`; the spec proposes retiring it in favour of rejecting a whole mutation that carries a stale revision.

- [ ] **Step 1: Establish whether the revision path covers the same race**

The CAS guards: a moderator deletes a custom companion and resets that session to `"floppy"`, while the user concurrently selects something else. The revision path rejects a *stale-revision mutation*, but `CustomCompanionEndpoints` computes its target inside `PublishAsync`'s lock and does not carry a client revision at all — so there is nothing to reject.

**Expected conclusion: keep it, and record why.** Add to `ISessionMappingService.cs`:

```csharp
    /// <summary>
    /// Compare-and-swap on the companion field.
    /// </summary>
    /// <remarks>
    /// Retained deliberately (spec §4.4 proposed retiring it). Revision rejection guards a client
    /// submitting a mutation against a table it has since fallen behind. This guards a different
    /// race entirely: a server-side moderator reset racing a user's own selection, where neither
    /// party carries a client revision to reject. The two do not overlap.
    /// </remarks>
```

Only remove it if you can write a failing test proving the revision path rejects that interleaving. If you cannot, say so in the commit message.

- [ ] **Step 2: Commit**

```bash
git add src/Brmble.Server
git commit -m "docs: record why the companion CAS survives revision rejection"
```

---

# STAGE D — Two bridge events and the React collapse

**Outcome:** the user-visible one. 17 `setUsers` sites become 2; avatars stop being clobbered.

## Task D1: Emit two events

**Files:** `MumbleAdapter.cs`

- [ ] **Step 1: Replace the body of `EmitProjectionChange`**

```csharp
    private void EmitProjectionChange(Projection.ChangeSet change)
    {
        if (change.NeedsSnapshot) RequestSnapshot();
        if (change.IsEmpty) return;

        if (change.IsReset)
        {
            // Membership was replaced wholesale, so the consumer replaces its list rather than
            // reconciling additions against removals.
            _bridge?.Send("voice.usersReset", new
            {
                users = change.Changed.Select(ProjectionWire.ToWireRow).ToArray()
            });
            _bridge?.NotifyUiThread();
            return;
        }

        _bridge?.Send("voice.usersChanged", new
        {
            changed = change.Changed.Select(ProjectionWire.ToWireRow).ToArray(),
            removed = change.Removed.ToArray()
        });
        _bridge?.NotifyUiThread();
    }
```

- [ ] **Step 2: Stop `voice.connected` carrying users**

In `SendVoiceConnected`, delete the `users = ...` member and instead emit a reset immediately after:

```csharp
        _bridge?.Send("voice.usersReset", new
        {
            users = _projection.Snapshot().Values.Select(ProjectionWire.ToWireRow).ToArray()
        });
```

- [ ] **Step 3: Delete the superseded emit sites**

`voice.userJoined` (`:4305`), both `voice.userLeft` (`:4291`, `:4513`), `voice.sessionMappingSnapshot` (`:2629`), both `voice.userMappingUpdated` (`:2666`, `:2691`), `voice.companionChanged` (`:2676`), `voice.brmbleClientActivated` (`:2702`), `voice.brmbleClientDeactivated` (`:2712`).

Keep `voice.userCommentChanged` — comment is Mumble-owned and already flows through `UserState`, so it is redundant, but removing it is a separate change. **Note it as follow-up rather than doing it here.**

The `voice.userLeft` payload carried `moved`, `previousChannelId` and `currentChannelId`, which the overlay and TTS use. Check `App.tsx:2721-2767` before deleting: if those fields are load-bearing, keep a **presentation-only** `voice.userMoved` event carrying just the channel transition, and say so in the commit message.

- [ ] **Step 4: Build and commit**

```bash
dotnet build
git add src/Brmble.Client
git commit -m "feat: replace eight user bridge events with two"
```

## Task D2: `useUserDirectory`

**Files:** Create `src/Brmble.Web/src/hooks/useUserDirectory.ts` and `useUserDirectory.test.ts`; modify `src/types/index.ts`

- [ ] **Step 1: Merge the two `User` types**

In `src/types/index.ts:22`, add the missing field and export the companion alias so `App.tsx` can drop its local shadow:

```ts
export interface User {
  id?: string;
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  matrixUserId?: string;
  speaking?: boolean;
  comment?: string;
  prioritySpeaker?: boolean;
  certHash?: string;
  isBrmbleClient?: boolean;
  /** Built-in id or `custom:$eventId`. `null` means unknown — render a fallback, do not store one. */
  companionId?: CompanionSelection | null;
}
```

Delete the local `interface User` at `App.tsx:651-664`. **`avatarUrl` is deliberately absent** — it moves to its own state in Step 3.

- [ ] **Step 2: Write the failing test**

Create `src/Brmble.Web/src/hooks/useUserDirectory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyChangeSet } from './useUserDirectory';
import type { User } from '../types';

const row = (session: number, over: Partial<User> = {}): User =>
  ({ session, name: `u${session}`, companionId: null, isBrmbleClient: null, ...over }) as User;

describe('applyChangeSet', () => {
  it('replaces a row wholesale rather than merging fields', () => {
    const before = [row(1, { companionId: 'retro', isBrmbleClient: true })];

    const after = applyChangeSet(before, { changed: [row(1, { companionId: null })], removed: [] });

    expect(after[0].companionId).toBeNull();
    expect(after[0].isBrmbleClient).toBeNull();
  });

  it('appends an unknown session', () => {
    expect(applyChangeSet([], { changed: [row(2)], removed: [] })).toHaveLength(1);
  });

  it('removes by session id', () => {
    expect(applyChangeSet([row(1), row(2)], { changed: [], removed: [1] }))
      .toEqual([row(2)]);
  });

  it('preserves the order of untouched rows', () => {
    const after = applyChangeSet([row(1), row(2), row(3)], { changed: [row(2, { name: 'x' })], removed: [] });
    expect(after.map(u => u.session)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd src/Brmble.Web; npm run test -- --run useUserDirectory`

Expected: FAIL — cannot resolve `./useUserDirectory`.

- [ ] **Step 4: Write the hook**

```ts
import { useCallback, useMemo, useRef, useState } from 'react';
import type { User } from '../types';

export interface UserChangeSet {
  changed: User[];
  removed: number[];
}

/**
 * Index-by-session replace and remove, with no field logic whatsoever.
 *
 * Rows arriving from the bridge are complete — every field present, nulls explicit — because
 * UserProjectionStore has already merged them. Any `||`, `??` or `!== undefined` added here
 * re-introduces the class of bug this project exists to remove: a merge rule on the consumer
 * side that disagrees with the one on the producer side.
 */
export function applyChangeSet(previous: User[], change: UserChangeSet): User[] {
  let next = previous;

  if (change.removed.length > 0) {
    const dropped = new Set(change.removed);
    next = next.filter(user => !dropped.has(user.session));
  }

  if (change.changed.length > 0) {
    const incoming = new Map(change.changed.map(user => [user.session, user]));
    next = next.map(user => incoming.get(user.session) ?? user);
    for (const user of change.changed) {
      if (!previous.some(existing => existing.session === user.session)) next = [...next, user];
    }
  }

  return next;
}

/**
 * Owns the user list and the avatar map, joining them for consumers.
 */
export function useUserDirectory() {
  const [users, setUsers] = useState<User[]>([]);
  // Keyed by matrixUserId, not session: an avatar belongs to a person, not to a connection, so
  // it survives reconnects and is shared by every session that person has open.
  const [avatars, setAvatars] = useState<Map<string, string>>(() => new Map());

  const usersRef = useRef(users);
  usersRef.current = users;

  const reset = useCallback((rows: User[]) => setUsers(rows), []);
  const apply = useCallback(
    (change: UserChangeSet) => setUsers(previous => applyChangeSet(previous, change)),
    [],
  );
  const setAvatar = useCallback((matrixUserId: string, url: string | undefined) => {
    setAvatars(previous => {
      if (previous.get(matrixUserId) === url) return previous;
      const next = new Map(previous);
      if (url === undefined) next.delete(matrixUserId);
      else next.set(matrixUserId, url);
      return next;
    });
  }, []);

  // The join happens at read time so a snapshot can never clobber an avatar.
  const joined = useMemo(
    () => users.map(user => ({
      ...user,
      avatarUrl: user.matrixUserId ? avatars.get(user.matrixUserId) : undefined,
    })),
    [users, avatars],
  );

  return { users: joined, usersRef, avatars, reset, apply, setAvatar };
}
```

- [ ] **Step 5: Run it to verify it passes**

Expected: PASS, four tests.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useUserDirectory.ts src/Brmble.Web/src/hooks/useUserDirectory.test.ts src/Brmble.Web/src/types/index.ts
git commit -m "feat: add useUserDirectory with avatars keyed by matrix id"
```

## Task D3: Collapse `App.tsx`

**Files:** `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Move `usersRef` before its first use**

`usersRef` is declared at `:1778` but read at `:1064` inside `resolveGamePlayerName`. It works today only because that read is inside a `useCallback` body. The hook must be called before any consumer, so hoist the `useUserDirectory()` call above `:1050`.

- [ ] **Step 2: Replace the 17 `setUsers` sites**

| Old site | Replacement |
|---|---|
| `:2176` `onVoiceConnected` | delete — `voice.usersReset` handles it |
| `:2273`, `:3043`, `:3718` resets to `[]` | `reset([])` |
| `:2552` `onVoiceUserJoined` | delete handler; register `voice.usersChanged` → `apply(d)` |
| `:2765` `onVoiceUserLeft` | delete the `setUsers` (keep the DM/TTS side effects) |
| `:2892` comment changed | delete — comment arrives in the row |
| `:3058`, `:3079`, `:3104`, `:3135`, `:3144` | delete all five handlers |
| `:1434`, `:1562`, `:1615`, `:1630`, `:1910` avatars | `setAvatar(matrixUserId, url)` |

Register two listeners in the block at `:3205`:

```ts
    bridge.on('voice.usersReset', (d: { users: User[] }) => reset(d.users));
    bridge.on('voice.usersChanged', (d: UserChangeSet) => apply(d));
```

Mirror both in the teardown at `:3295`.

- [ ] **Step 3: Rekey the avatar pipeline**

`fetchedAvatarIdsRef` (`:1571`) is already keyed by `matrixUserId`, but `AvatarFetchRecord` carries `session` and `shouldFetchAvatar` (`utils/avatarFetch.ts:38-49`) compares `record.session !== user.session` to force a refetch on reconnect. With avatars keyed by identity that comparison is wrong — the avatar is still valid across sessions. Delete the `session` field from `AvatarFetchRecord` and simplify `shouldFetchAvatar` to "no avatar for this matrixUserId and not already attempted". Update `avatarFetch.test.ts` accordingly.

- [ ] **Step 4: Make `resolveCompanionDisplay` treat null as unknown**

`InterfaceSettingsTypes.ts:112`. `normalizeCompanionId` (`:67`) currently collapses anything unrecognised to `'floppy'`, which erases the distinction. Accept `CompanionSelection | null` and return `{ companionId: 'floppy' }` for null **without** writing that back anywhere, so the row self-corrects when the real value arrives. Verify no caller persists the result: `App.tsx:4155`, `:4157`, `:4173`.

- [ ] **Step 5: Run everything**

```bash
cd src/Brmble.Web; npm run test -- --run; npx tsc --noEmit; npm run build; cd ../..
```

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web
git commit -m "refactor: collapse user state into useUserDirectory"
```

---

## Acceptance tests (spec §8)

Run against `docker-local` with a Debug build so multiple clients can run side by side.

```bash
cd src/Brmble.Web; npm run build; cd ../..
docker compose -f docker-local/docker-compose.yml up -d --build brmble
dotnet run --project src/Brmble.Client
```

- [ ] **Restart.** Two clients connected, one plain Mumble and one Brmble with a custom companion. `docker compose -f docker-local/docker-compose.yml restart brmble`. Assert: no user-list flicker; the Brmble badge never disappears; the custom skin never reverts to floppy; voice uninterrupted. **All four currently fail.**
- [ ] **Concurrency.** Start three clients within a second of each other. Assert every client's user list converges on the same rows, and no client sits in a resync loop (check for repeated `requestSnapshot` in the log).
- [ ] **Moderation.** Redact a custom skin from a moderator client while a second client sits in another channel with that atlas cached. Assert it is dropped from memory and IndexedDB without a reconnect. Expected to pass already — pin it against regression.

## Do NOT do

Recorded in spec §9 with reasoning; all are follow-ups:

- No shared Matrix media layer.
- No avatar authenticated-media migration.
- No IndexedDB keyspace reconciliation (`atlasCacheKey` stays `roomId\0eventId`).
- No removal of `voice.userCommentChanged` (noted in Task D1 Step 3).

## The invariant that governs all of it

> **The projection carries identifiers, never resolved assets.** If a value can be re-derived from an identifier, it does not belong in the projection.

`matrixUserId` and `companionId` are in. `avatarUrl` and `atlasCacheKey` are out — which is exactly why Task D2 moves avatars into a separate map joined at read time.

## Done when

- [ ] `dotnet build` clean, 0 warnings; `npx tsc --noEmit` clean
- [ ] `dotnet test` green with more than the 1299 baseline; `npm run test -- --run` green
- [ ] `Select-String -Path src/Brmble.Client/Services/Voice/MumbleAdapter.cs -Pattern "_sessionMappings|_pendingBrmbleStatus|_userMappings"` returns nothing
- [ ] `Select-String -Path src/Brmble.Client/Services/Voice/Projection/*.cs -Pattern "MumbleSharp|HttpClient|JsonElement|System.Text.Json"` still returns nothing
- [ ] `(Select-String -Path src/Brmble.Web/src/App.tsx -Pattern "setUsers\(").Count` is 0 — all writes go through `useUserDirectory`
- [ ] No `||`, `??` or `!== undefined` in `applyChangeSet`
- [ ] The three acceptance tests pass
