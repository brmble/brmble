# Phase 1 review findings — fix prompt

Paste the block below into a fresh session to fix the two defects found reviewing Phase 1.

---

Fix two defects found reviewing Phase 1 of the Brmble user projection.

## Context

Repo: `C:\Projects\brmble`
Branch: `feature/user-projection-phase-1` (HEAD `804230fe`)

Phase 1 is built and green — `dotnet build` clean, `dotnet test` 1246 passing (Server 774, Client 300, MumbleVoiceEngine 99, Audio 73). Confirm that baseline before you start.

Read `docs/superpowers/specs/2026-07-31-user-projection-design.md` §3.2, §4.1 and §4.2 for the rules these defects violate. The Phase 1 plan is at `docs/superpowers/plans/2026-07-31-user-projection-phase-1-server.md`.

Both defects originate in the plan, not in the implementation — it followed the plan faithfully. Fix the code; do not treat this as a rework of someone's mistake.

Use the **test-driven-development** skill: failing test first, watched to fail for the right reason, then the fix. Commit each defect separately.

---

## Defect 1 — tri-state null breaks the currently shipped client (ship blocker)

The server now emits `isBrmbleClient: null` for any session whose owner has not registered a WebSocket. The shipped client parses it like this, in two places:

- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:130` (`ParseSessionMappings`)
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:2650` (`userMappingAdded` handler)

```csharp
var isBrmble = prop.Value.TryGetProperty("isBrmbleClient", out var b) && b.GetBoolean();
```

`TryGetProperty` returns **true** for an explicit JSON null, and `JsonElement.GetBoolean()` **throws** `InvalidOperationException` when the value kind is Null. Line 130 runs while handling the `/auth/token` response, so an updated server would throw inside credential handling for every existing client, for every unregistered user in the snapshot.

**Fix, server-side: omit the property when unknown instead of writing null.**

An absent property makes old clients evaluate `TryGetProperty` to false and fall back to `false` — exactly today's behaviour. New clients treat absent and null identically as "unknown" (spec §3.2 rule 2), so nothing is lost. `false` must still be written explicitly, because an observed deactivation is knowledge, not an absence.

**Do not** set a global `DefaultIgnoreCondition = WhenWritingNull` on `BrmbleEventBus`'s `JsonOptions`. `customCompanionId = (string?)null` is deliberately meaningful on the wire and omitting it would change companion parsing. Make the omission specific to `isBrmbleClient`.

Sites that serialise it: `BrmbleWebSocketHandler.BuildInitialPayloadsAsync`, `BrmbleWebSocketHandler.CreateUserMappingAddedPayload`, `SessionMappingHandler.OnUserConnected`, and the `/auth/token` response in `AuthEndpoints`.

Tests to add:
- A payload for an unregistered session has **no** `isBrmbleClient` property at all (assert `TryGetProperty` is false), for both the snapshot and `userMappingAdded`.
- A payload for a deactivated session still carries `isBrmbleClient: false` explicitly.
- A regression test that the shipped client parser survives it: call `MumbleAdapter.ParseSessionMappings` (internal, `InternalsVisibleTo` is configured for `Brmble.Client.Tests`) with a snapshot containing an omitted `isBrmbleClient`, and assert it does not throw and yields `IsBrmbleClient == false`. Add the same for a payload containing an explicit `null`, so the client is hardened even if a null ever reaches it.

---

## Defect 2 — revision stamped outside the ordering lock

`MappingEventPublisher` exists so that revision order matches delivery order: it mutates, reads the revision and enqueues the broadcast under one lock. Five sites bypass that, mutating first and reading `sessionMapping.Revision` afterwards, unsynchronised:

| Site | Problem |
|---|---|
| `src/Brmble.Server/Auth/AuthEndpoints.cs:93-115` | 3 mutations, then raw `eventBus.BroadcastAsync` reading `.Revision` |
| `src/Brmble.Server/Auth/AuthEndpoints.cs:123-133` | 2 mutations, then raw `eventBus.BroadcastAsync` reading `.Revision` |
| `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs:131-139` | 2 mutations, then raw `BroadcastExceptAsync` reading `.Revision` |
| `src/Brmble.Server/Events/SessionMappingHandler.cs:43-45` | uses the publisher, but with `() => true` — mutations already happened outside the lock |
| `src/Brmble.Server/Mumble/MumbleServerCallback.cs:187,200` | `RemoveSession` at :187, publisher with `() => true` at :200 |

The race, with two users registering simultaneously:

```
Thread A: mutates            -> revision becomes 5
Thread B: publisher mutates  -> revision becomes 6, enqueues payload(6)
Thread A: reads .Revision    -> gets 6, enqueues payload(6)   <- wrong revision
```

Two payloads claim revision 6. A client applies one and discards the other as a duplicate — silent data loss, which is the exact failure this phase exists to prevent. It triggers under concurrent registration, which is the spec's §8 acceptance test.

`() => true` fails for the same underlying reason: the mutation happened before the lock, so the revision read inside it is not provably the one that mutation produced.

**Fix: move the mutations inside the publisher's `mutate` callback**, so mutation, revision read and enqueue are one atomic unit:

```csharp
await publisher.PublishAsync(
    () =>
    {
        sessionMapping.TryUpdateCertHash(sid, certHash);
        sessionMapping.TryUpdateBrmbleStatus(sid, true);
        return true;
    },
    envelope => new
    {
        type = "brmbleClientActivated",
        instanceId = envelope.InstanceId,
        revision = envelope.Revision,
        sessionId = sid
    });
```

Notes per site:
- `SessionMappingHandler` needs `TryAddMatrixUser`'s result after the fact to decide whether to send `brmbleClientActivated`. Capture it into a local from inside the callback.
- `BrmbleWebSocketHandler` excludes the registering socket, so add a `PublishExceptAsync(WebSocket excluded, ...)` overload to `IMappingEventPublisher` that calls `BroadcastExceptAsync` under the same lock.
- `MumbleServerCallback` must keep `RemoveSession` ordered against the LiveKit and channel-membership cleanup around it. Move only `RemoveSession` into the callback; the surrounding work stays where it is.

Test to add: a concurrency test that fires many simultaneous publishes and asserts **no two broadcast payloads carry the same revision**, and that revisions arrive in ascending order. Model it on the existing `PublishAsync_DeliversInRevisionOrderUnderConcurrency` in `tests/Brmble.Server.Tests/Events/MappingEventPublisherTests.cs`, but drive it through the real endpoints rather than the publisher directly, so it actually covers the five sites above.

---

## Done when

- `dotnet build` clean, 0 warnings
- `dotnet test` green, with more tests than the 1246 baseline
- No payload carries `isBrmbleClient` when the value is unknown; `false` is still explicit
- `ParseSessionMappings` survives both an omitted and an explicit-null `isBrmbleClient`
- Every mapping mutation reaches the wire through `MappingEventPublisher`, with no `() => true` left where a real mutation should be
- Grep confirms no remaining `eventBus.BroadcastAsync` for a mapping payload outside the publisher

Do not push or open a PR. Report what you changed and the test counts.
