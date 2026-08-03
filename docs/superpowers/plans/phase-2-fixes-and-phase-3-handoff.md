# Phase 2 review fixes + Phase 3 handoff

Paste the block below the rule into the session that implemented Phase 2.

---

Two jobs: fix four things found reviewing your Phase 2 work, then plan and build Phase 3.

## Where you are

Repo: `C:\Projects\brmble`
Branch: `feature/user-projection-phase-2` (HEAD `71f89921`)

Baseline — confirm before touching anything:
- `dotnet build` clean, 0 warnings
- `dotnet test` 1288 passing: Server 782, Client 334, MumbleVoiceEngine 99, Audio 73

Reference docs:
- Design: `docs/superpowers/specs/2026-07-31-user-projection-design.md`
- Phase 2 plan: `docs/superpowers/plans/2026-08-01-user-projection-phase-2-store.md`

Use **test-driven-development** throughout, and **verification-before-completion** before claiming anything passes. Commit each item separately. Do not push or open a PR.

Your Phase 2 work reviewed well. The ownership split is structural rather than conventional, the snapshot's "null is knowledge here" exception is correct and well argued, and moving sequencing to `BaseRevision` was a genuine improvement over the spec — the spec's `revision == ours + 1` would have broken on `/auth/token`, which bumps three times. Your two pieces of feedback on the plan were both verified correct.

---

# PART A — Fixes

## A1. Server data for a session Mumble has not announced is silently discarded (do this first)

This is the significant one, and it affects both paths.

**Event path**, `UserProjectionStore.cs:188-189`:

```csharp
if (!_rows.TryGetValue(evt.SessionId, out var existing))
    return ChangeSet.Empty;   // cursor advanced, event consumed, data gone
```

**Snapshot path**, `UserProjectionStore.cs:108` — `ApplyServerSnapshot` iterates `_rows.Keys.ToArray()`, so snapshot entries for sessions not yet in `_rows` are ignored entirely.

### Why this matters

Spec §4.2 says an event naming a session Mumble has not shown should be *buffered briefly*, and spec §11 question 2 explicitly deferred "how long is briefly" **to Phase 2**. Phase 2 neither buffered nor resynced — it chose a third option, dropping, and encoded it in a test name (`ApplyServerEvent_ForASessionMumbleHasNotShownIsIgnoredButAdvancesTheCursor`). The deferred question is now answered silently.

Your reasoning in that comment is right as far as it goes: treating an unknown session as a gap would resync on every unrelated user's join, which would be worse. But dropping is not the alternative the spec intended, and the snapshot case is the dangerous one.

On voice connect, `/auth/token` returns a full snapshot. If it lands before Mumble's `UserState` batch has populated the rows, **every server-owned field is dropped for every user** — and nothing re-delivers it, because no gap occurs and no reconnect happens. That is exactly the "user shows up wrong on other clients" symptom this whole project exists to eliminate, reintroduced at the point where it is hardest to notice.

Phase 1's `MumbleAdapter` had `_pendingBrmbleStatus` for precisely this race. Phase 2 removed the capability without replacing it.

### What to build

A pending-entry map inside the store, applied when a row first appears:

- Hold `ServerMappingEntry` values for sessions not yet in `_rows`, from both `ApplyServerEvent` and `ApplyServerSnapshot`.
- When `ApplyMumbleUserState` (or `ApplyMumbleReset`) first creates a row for that session, apply the held entry and include the row in the returned `ChangeSet`.
- Bound it. Decide a cap and an eviction rule, and write the reasoning into a comment — an unbounded map fed by a remote server is a memory-exhaustion vector.
- Drop a held entry when its session is superseded: a snapshot that omits the session, or a `MappingRemoved` for it.

Keep the cursor advancing exactly as it does now. That part is right.

**Resolve spec §11 question 2 explicitly.** Edit the spec to record what you chose and why — whether that is a pending map with no timeout, a bounded one, or something else. It must not stay open after this.

Tests to add:
- A `CompanionChanged` event for an unknown session, then `ApplyMumbleUserState` for that session — the row appears carrying the companion, and is reported in `Changed`.
- A full snapshot arriving before any Mumble rows, then a Mumble reset — every user comes out enriched. Assert this against the real connect ordering, because this is the case that would otherwise silently break Phase 3.
- A held entry is discarded when a later snapshot omits that session.
- The bound is enforced.

## A2. `ChangeSet.IsReset` documents behaviour that cannot exist

`ChangeSet.cs:8-9` says `IsReset` is "Set by a Mumble reset and by a snapshot that changed membership." The second clause is not merely unimplemented — it is impossible. `ApplyServerSnapshot` only ever modifies existing rows; it cannot add or remove any, because only Mumble owns existence (spec §4.3). A snapshot can change *server-known* membership but never *row* membership.

So this is not a decision between two options. Fix it as documentation:

- Delete the "and by a snapshot that changed membership" clause.
- Rename `ApplyServerSnapshot_FlagsAResetWhenMembershipChanged` to something truthful, e.g. `ApplyServerSnapshot_ReportsRowsItResets`.
- Leave `IsReset` as Mumble-reset-only. Your instinct was right: making resyncs flag a reset would force Phase 3 to rebuild the whole list every time.
- Make the same correction in the Phase 2 plan (`:520-523` and `:912`) so the two do not disagree.

## A3. No guard against a malformed revision range

`ApplyServerEvent` accepts `evt.Revision < evt.BaseRevision` and would move `_revision` backwards. The server should never emit that, but the store is the trust boundary. Reject it as a gap (`NeedsSnapshot`) rather than applying it. One test.

## A4. Namespace drift in the spec

Spec §6.4 says `Services/Voice/UserProjection/`; the code uses `Services/Voice/Projection/`. **The code is right** — commit `fced11b1` shows you avoided a type/namespace collision deliberately. Correct the spec so it does not read as accidental drift.

---

# PART B — Phase 3

Do not start until Part A is committed and green.

Phase 3 is where this becomes user-visible. Everything so far ships invisibly; this is the phase that stops badges disappearing and companions reverting to floppy.

## Plan it first

Use the **writing-plans** skill. Save to `docs/superpowers/plans/YYYY-MM-DD-user-projection-phase-3-wiring.md`.

Write the plan against the code as it actually exists after Part A, not against the spec's description of it. The spec was written before Phases 1 and 2 were built and both diverged for good reasons — `baseRevision` and the `Projection` namespace being two examples.

Read spec §3.4, §4.4, §5, §6 and §8 first.

## Scope

**Client C# — `MumbleAdapter`**

1. Delete `_sessionMappings` and `_pendingBrmbleStatus`. `UserProjectionStore` replaces both.
2. Feed the store from the three inputs: Mumble `UserState`/`UserRemove`, the `/auth/token` snapshot, and WebSocket events.
3. Emit exactly two bridge events, replacing eight: `voice.usersReset` and `voice.usersChanged`. Rows must be **complete** — every field present, nulls explicit — so React has nothing to merge. One row serializer, replacing the six duplicated shapes.
4. `voice.connected` keeps channels and connection metadata but stops carrying `users`.
5. Companion consumers (`GetSelfCompanionOrDefault`, `UpdateSelfCompanionMapping`) read the projection.

**Client C# — resync**

6. Send `{"type":"requestSnapshot", ...}` when the store returns `NeedsSnapshot`. The client currently has `SendWebSocketFrame` (`MumbleAdapter.cs:2536`) but uses it only for pongs, and the stream is a local inside the reconnect loop. Hoist it to a field and add a send lock, since pongs share the socket. Server side already exists from Phase 1.
7. Rate-limit resync: one in flight, minimum 1s spacing, exponential backoff to 30s. A persistent mismatch must never become a hot loop.
8. Fix the teardown bug at `MumbleAdapter.cs:2034` — `FetchAndSendCredentials` unconditionally calls `StartWebSocketConnection`, so a health-triggered credential refresh tears down a socket that was already working. Make it conditional on the socket not already being connected.

**Wire — companion collapse and negotiation**

9. Client appends `?pv=1` to the `/ws` URL (`MumbleAdapter.cs:2283`). Server reads `context.Request.Query["pv"]` in `HandleAsync` *before* `AcceptWebSocketAsync`, so the version is known before initial payloads are built.
10. For `pv>=1`, send one truthful companion field; for absent `pv`, keep the legacy `companionId`/`customCompanionId` split. The legacy shim sends `companionId: "floppy"` for custom skins — that lie must live only at the compatibility boundary, never in the projection.
11. `"floppy"` becomes a render-time fallback only. `null` means unknown everywhere else.
12. Retire `TryUpdateCompanionIdIfCurrent` in favour of revision rejection, **only if** you can show the revision path covers the same race. If not, say so and keep it.

**React — `App.tsx`**

13. 17 `setUsers` sites become 2. `applyChangeSet` does index-by-session replace and remove with **no field logic** — no `||`, no `??`, no `!== undefined`.
14. Avatars move out of `users` into their own state keyed by `matrixUserId`, joined in a selector. Without this, every snapshot clobbers avatars. Key by asset identity, not session, so a future shared media layer is a substitution rather than a rewrite.
15. Extract into a `useUserDirectory` hook alongside the existing ones. Consumers keep the same row shape.
16. Collapse the two `User` types — `types/index.ts:22` lacks `companionId`, the local one in `App.tsx` has it.
17. `resolveCompanionDisplay` treats `null` as unknown and renders floppy **without caching that as a decision**, so the row self-corrects when the real value arrives.

**Do NOT do**

18. No shared Matrix media layer. No avatar authenticated-media migration. No IndexedDB keyspace reconciliation. All are recorded in spec §9 as follow-ups with reasoning.

## The invariant that governs all of it

> **The projection carries identifiers, never resolved assets.** If a value can be re-derived from an identifier, it does not belong in the projection.

`matrixUserId` and `companionId` are in. `avatarUrl` and `atlasCacheKey` are out.

## Acceptance tests (spec §8)

These are the point of the whole project. Phase 3 is not done until they pass.

- **Restart.** Two clients connected, one plain Mumble and one Brmble with a custom companion. Restart only the `brmble` container. No user-list flicker, the Brmble badge never disappears, the custom skin never reverts to floppy, voice uninterrupted. Currently fails on all four counts.
- **Concurrency.** Several clients register simultaneously; every one receives a complete snapshot and converges on the same projection. This is what exposed the whole bug class originally.
- **Moderation.** A moderator redacts a skin while a client sits in another channel with that atlas cached; it is dropped from memory and disk without a reconnect. Expected to pass already via Matrix sync — pin it against regression.

Manual, against `docker-local`:

```bash
cd src/Brmble.Web; npm run build; cd ../..
docker compose -f docker-local/docker-compose.yml up -d --build brmble
dotnet run --project src/Brmble.Client
docker compose -f docker-local/docker-compose.yml restart brmble
```

Debug builds allow multiple clients, so you can run several side by side.

## Things that will bite you

- **UI work requires `docs/UI_GUIDE.md`.** Read it before touching any component or CSS. Never hardcode colours, sizes, spacing or radii — use the existing tokens.
- **`App.tsx` is ~5,600 lines and `MumbleAdapter.cs` ~4,700.** Both are actively edited. Rebase early and often; `main` has moved repeatedly during this work.
- **LSP noise is false.** The language server reports unresolved `Moq`, `TestClass`, `Microsoft.Extensions` and `Ice` in files you have not touched. `dotnet build` is the truth.
- **PowerShell, not bash.** No `&&`; use `;` or `if ($?) { }`.
- **Never commit to main.** Branch `feature/user-projection-phase-3`. Ask before pushing or opening a PR.

## Report back with

What you changed, test counts before and after, the acceptance-test results, and anything in the spec or plan that turned out to be wrong. That last one has been the most valuable output of every phase so far — Phase 1 found two unannounced revision bumps, Phase 2 found the `IsReset` contradiction.
