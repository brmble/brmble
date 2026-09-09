# PR #629 (Phase 3) — review findings

Two small findings, one doc correction, and one accepted risk. Nothing blocks the merge.

Branch: `feature/user-projection-phase-3`. Verified independently: build clean, `dotnet test` 1342, `npm run test` 1490, `npx tsc --noEmit` clean.

**Work list: items 2, 3 and 4. Item 1 is an accepted risk — do not implement it.**

---

## 1. New client against an old server loses all identity — ACCEPTED RISK, DO NOT FIX

**Decision: not fixing. Brmble is in beta and both sides of the deployment are controlled, so client/server version skew is not a scenario worth engineering for. Recorded only so it is not rediscovered as a bug.**

The one thing possibly worth doing is the diagnostic at the end of this section — three lines, and it makes the failure loud instead of silent if it is ever hit for a reason other than version skew. Everything above that line is context, not a task.

### What happens

`ProjectionWire.ReadSnapshot` (`src/Brmble.Client/Services/Voice/ProjectionWire.cs:22-23`) returns `null` when `instanceId` is missing:

```csharp
var instanceId = ReadString(root, "instanceId");
if (string.IsNullOrEmpty(instanceId)) return null;
```

The adapter then silently skips the snapshot at both call sites — `MumbleAdapter.cs:1974` (`/auth/token`) and `:2643` (WebSocket).

A server predating Phase 1 sends no `instanceId`, so against one of those:

1. No snapshot is ever applied, so the store never establishes a cursor
2. `_instanceId is null`, so **every** event returns `NeedsSnapshot`
3. `RequestSnapshot()` fires, and an old server's read loop discards non-Close frames
4. Nothing ever repairs it — a resync request every 1s widening to 30s, forever

Every user renders with no `matrixUserId`, no companion, no Brmble badge and no avatar. Permanently. No error is surfaced.

### Why it was raised

This is a **new** incompatibility — the pre-Phase-3 client parsed `sessionMappings` without needing an envelope, so the combination worked before. It is being accepted rather than fixed because version skew is not a real scenario during beta.

### Optional: make the failure loud (the only part worth doing)

The mechanism is not strictly limited to old servers — any snapshot that fails to yield an envelope takes the same path, and it does so **silently and permanently**. A log line, or a `SendBrmbleServiceStatus` degraded marker, at the point where `ReadSnapshot` returns null would turn "identities mysteriously blank" into something diagnosable in seconds.

Three lines, no behaviour change, worth it independently of the version-skew decision. Skip if you disagree.

### Not doing

Do **not** implement a legacy snapshot mode, a cursor-less enriched state, or compatibility tests for envelope-free payloads. That work is out of scope.


---

## 2. A discarded event creates a phantom gap

**Severity: minor, latent rather than live.**

`ProjectionWire.ReadEvent` returns `null` — dropping the event **and its revision** — in three cases:

| Line | Condition |
|---|---|
| `:87` | missing or empty `instanceId` |
| `:92` | `sessionId == 0` |
| `:94-95` | missing or non-numeric `revision` |

Because the event never reaches `ApplyServerEvent`, the cursor does not advance, so the next event looks like a gap and triggers a resync.

It self-heals, and I could not find a producer that emits `sessionId: 0` — `AuthService`'s publisher lambda guards on `TryGetSessionByUserId`, and `b632d0a3` tightened registration announcements. So this is latent.

Worth either a comment recording that the resync is the intended cost, or advancing the cursor for a payload that is well-formed enough to sequence but unusable for other reasons.

---

## 3. `applyChangeSet` append loop is quadratic

**Severity: trivial.**

`src/Brmble.Web/src/hooks/useUserDirectory.ts:34-36`:

```ts
for (const user of change.changed) {
  if (!previous.some(existing => existing.session === user.session)) next = [...next, user];
}
```

`previous.some(...)` inside the loop, and the array is rebuilt per append. Irrelevant at channel scale. A `Set` of existing session ids would make it linear if the list ever grows — for example a large snapshot arriving after a reset.

---

## 4. The spec should record what Phase 3 actually settled

Not a code change — the spec now overstates what was done, and the next reader will think work is missing.

**Spec §4.4** describes collapsing the companion to one truthful field. In practice only the WebSocket snapshot does this. `/auth/token` and every broadcast keep the legacy split, both for good reasons that are documented in the code:

- `/auth/token` is fetched before the WebSocket exists, so it carries no `pv`
- Broadcast recipients are at mixed projection versions

So the "lie at the compatibility boundary" §4.4 wanted still lives in the core protocol; the client just handles it correctly in `ReadCompanionId`. That is the right outcome given the constraints, but the spec should say so rather than describing an end state that was deliberately not reached.

Also worth recording in the spec: `TryUpdateCompanionIdIfCurrent` was **kept**, and §4.4's proposal to retire it was wrong — `CustomCompanionEndpoints` computes its reset target inside `PublishAsync`'s gate and carries no client revision, so there is nothing for revision rejection to reject.

---

## Still outstanding from the PR body

Custom companions were not manually verified. Stage C is exactly where a regression would hide: a custom skin rendering as floppy on other clients, because that is the wire format Stage C changed.
