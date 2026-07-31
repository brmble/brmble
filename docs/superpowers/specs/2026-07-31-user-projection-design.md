# A single authoritative user projection

**Status:** design, approved in brainstorm. Not yet planned or implemented.

**Written:** 2026-07-31

**Supersedes the open questions in:** `docs/superpowers/specs/2026-07-31-user-data-propagation-problem.md`

**Precondition:** assumes `custom-companion` (PR #616) is merged, which it is as of `31353ec5`.

---

## 1. The problem, in one sentence

Server-owned user data reaches the client over three fire-once transports, is cached, and is then
re-asserted to the UI on every Mumble `UserState` — so a lost or out-of-order event does not
produce a *missing* value, it produces a **confidently wrong** value, rebroadcast indefinitely by
an unrelated event.

The prior document records the evidence. This document decides what to do.

### Why now

Connect, disconnect and reconnect are constant in normal operation. Every one of them is a chance
for the current design to settle on a wrong answer, and there is no mechanism that ever corrects
it short of a full reconnect.

Two concrete instances, both live on `main` at the time of writing:

- **`isBrmbleClient` after a Brmble restart.** `SessionMappingHandler.cs:38` derives the flag from
  `AuthService._activeSessions`, which is in-memory and wiped by the restart. The Ice snapshot
  (`MumbleIceService.cs:78`) then re-publishes every user as `isBrmbleClient = false` — not
  "unknown", but a positive assertion of the wrong value — until each user's own WebSocket
  re-registers.
- **Stale index producing a confident broadcast.** `PersistCompanionSelectionAsync` resolved a
  session through an index that can disagree with the mapping table, then announced a change that
  may never have happened. Fixed in `fix/companion-broadcast-scope` (PR #617) by routing through
  the validated `TryGetMappingByUserId`. That fix is a point repair of the same class this design
  removes structurally.

---

## 2. Scope

**In scope:** the fields that compose a sidebar row — server-owned identity (`matrixUserId`,
`companionId`, `isBrmbleClient`, `certHash`) and Mumble-native presence (`name`, `channelId`,
`muted`, `deafened`, `comment`).

**Out of scope, deliberately:** screen shares, LiveKit participants, duel/queue state, paint
sessions. These remain feature-owned. They may consume the projection for session → user
resolution, but they do not live in it.

**Also out of scope:** replacing the Mumble protocol (not ours), and unifying the Matrix media
layer (see §9).

### 2.1 Inherited constraints

Carried forward from the problem statement, which this document supersedes:

1. **The Mumble protocol is not ours to change.** Mumble-owned fields keep arriving as `UserState`
   and keep repeating on every change. The design leans on that rather than replacing it.
2. **`/auth/token` cannot be dropped.** It exists because the client needs credentials *before*
   the WebSocket is up, so it is not redundant with `sessionMappingSnapshot` even though they
   carry identical data. §3.1 keeps them as two transports sharing one code path rather than
   collapsing them — a future "simplification" that deletes the HTTP route would break bootstrap.
3. **The projection is not the only consumer.** Client-side, companions read it (§6.5). The
   *server's* `ISessionMappingService` is a different thing and additionally feeds duels, paint,
   screen share and channel routing — it is not in scope here.
4. **It has to survive concurrent joins.** Simultaneous registration is what exposed this bug
   class in the first place, via a deadlock that starved clients of `sessionMappingSnapshot`
   entirely (fixed in `29ac2c8c`). See the concurrency acceptance test in §8.

---

## 3. Architecture

### 3.1 One projection, three inputs, one output

A new `UserProjectionStore` in `Brmble.Client` owns the single authoritative
`Dictionary<uint, UserProjection>`.

| Input | Source | Owns exclusively |
|---|---|---|
| `ApplyMumbleUserState` / `ApplyMumbleUserRemove` | Mumble `UserState` / `UserRemove` | session existence, `name`, `channelId`, `muted`, `deafened`, `comment`, Mumble `certHash` |
| `ApplyServerSnapshot` | `/auth/token` + WS `sessionMappingSnapshot` | `matrixUserId`, `companionId`, `isBrmbleClient`, server `certHash`, and membership reconciliation |
| `ApplyServerEvent` | WS `userMappingAdded/Removed`, `brmbleClient*`, `companionChanged` | the same server-owned set, incrementally |

### 3.2 The two rules that do all the work

1. **Ownership.** A Mumble input can only write Mumble-owned fields; a server input only
   server-owned ones. Cross-writes are impossible by construction — not by convention, and not by
   a guard that a future contributor might forget.

2. **Null means unknown.** On any server input, a `null` field leaves the existing value
   untouched. Clearing is never implicit: it happens only through snapshot reconciliation or an
   explicit `userMappingRemoved`.

Rule 2 is why `companionId: null` can never become floppy and `isBrmbleClient: null` can never
become `false`. Today those defaults are applied in four separate places: `MumbleAdapter.cs:139`
(`ParseWireCompanionId`), `:2110` (`GetSelfCompanionOrDefault`), `:2656` (`userMappingAdded`), and
the `IsBrmbleClient = false` default on the `SessionMappingEntry` record at `:110`.

### 3.3 Degraded mode

Session existence is owned by Mumble alone. If the Brmble container is down, rows still appear,
move channels, mute and unmute. They carry stale-but-last-known enrichment. Voice is unaffected.

This is a deliberate rejection of "the Brmble server assembles and pushes the whole list": it
would be a simpler merge, but a Brmble outage would empty the user list while audio kept flowing.

### 3.4 The invariant

> **The projection carries identifiers, never resolved assets.**
> If a value can be re-derived from an identifier, it does not belong in the projection.

`matrixUserId` and `companionId` are in. `avatarUrl` and `atlasCacheKey` are out.

This is not a style preference. There are two layers with opposite characteristics, and mixing
them is what lets a lost event corrupt a cache:

| Layer | Nature | Failure of a lost update |
|---|---|---|
| Identity (this design) | pushed, fire-once, order-sensitive | permanent wrongness |
| Asset (avatar, companion atlas) | pulled, derived, retried, cached | self-heals on next derive |

The avatar pipeline was the one thing that already worked in the original problem statement
precisely because it was accidentally obeying this rule. The rule makes that deliberate and
answers "where does the next field go?" without re-litigating it each time.

---

## 4. Wire contract

Five changes on the Brmble side. The Mumble protocol is untouched. All are additive in the sense
that an older client ignores the new fields — but §4.3 changes the *meaning* of an existing
payload, so it is the one that needs care.

### 4.1 Tri-state `isBrmbleClient`

`SessionMapping` (`ISessionMappingService.cs:3`) gains `bool? IsBrmbleClient`, serialised as
`true` / `false` / `null`.

The restart bug then fixes itself: `SessionMappingHandler.cs:38` publishes `null` — *unknown* —
instead of `false`, and rule 2 preserves the badge until the client's own socket asserts `true`.

`companionId` gets the same treatment. `ParseSessionMappings` (`MumbleAdapter.cs:117`) currently
defaults an absent companion to `"floppy"`, which is exactly how a missing field became a wrong
value. Absent becomes `null`; `"floppy"` becomes a **render-time** fallback only, in
`resolveCompanionDisplay`.

### 4.2 `instanceId` + `revision`

- **`instanceId`** — a GUID generated once at Brmble server startup. `SessionMappingService` is
  purely in-memory (`SessionMappingService.cs:7-10`), so a restart resets everything. A changed
  `instanceId` tells the client "discard all server-owned fields and take the new snapshot as
  truth" without inference.
- **`revision`** — a monotonic `long` on the mapping table, incremented on every mutation and
  stamped on every snapshot and event.

Client rules:

| Condition | Action |
|---|---|
| `instanceId` differs | Discard server-owned fields, request snapshot |
| `revision <= ours` | Ignore — duplicate or reorder, already applied |
| `revision == ours + 1` | Apply |
| `revision > ours + 1` | Gap — apply nothing, request snapshot |
| Event for a session Mumble has not shown us | Buffer briefly, then request snapshot |

**This requires all projection events to be broadcast server-wide.** Channel-scoped delivery would
make out-of-channel clients observe phantom gaps and resync continuously. PR #617 already made
`companionChanged` global for both the selection and moderator-deletion paths, which is the
prerequisite. No privacy boundary is crossed: every client already receives the full mapping table
in its snapshot.

### 4.3 Snapshots are authoritative for membership

Today `voice.sessionMappingSnapshot` only patches rows that already exist and never removes
(`App.tsx:3079`), so a session that vanished during an outage lingers forever.

A snapshot now means "this is the complete set of server-known sessions": any session absent from
it has its server-owned fields reset to unknown. It still cannot delete a row — only Mumble owns
existence.

### 4.4 Companion becomes one field

`custom-companion` introduced `CompanionWireSelection.FromPersisted`, which for a custom skin
sends `companionId: "floppy"` plus the truth in `customCompanionId`. That is a legacy-safe shim
for clients predating the feature, and it works — but it transmits a default as though it were a
fact, which §3.2 rule 2 exists to prevent.

Resolution: `UserProjection` carries a single `CompanionSelection` (a built-in id or
`custom:$eventId`), with `null` meaning unknown. The client announces a projection version at
WebSocket registration; the server sends the single truthful field to clients that support it and
the legacy split to those that do not. The compatibility lie lives at the compatibility boundary
rather than in the core protocol, and `ParseWireCompanionId`'s `"floppy"` defaults collapse to one
render-time fallback.

`TryUpdateCompanionIdIfCurrent` (the per-field CAS added by `custom-companion`) is retired: a
mutation carrying a stale revision is rejected wholesale.

### 4.5 Client → server resync request

The WebSocket is receive-only today, and the server's read loop reads into a 1024-byte buffer and
discards everything that is not a Close frame, ignoring `EndOfMessage`
(`BrmbleWebSocketHandler.cs:46-55`). This design fixes that loop properly and adds one message:

```json
{ "type": "requestSnapshot", "instanceId": "...", "haveRevision": 42 }
```

The server replies by reusing `BuildInitialPayloadsAsync`, which already builds exactly this
payload. The client already has a correct masked-frame writer (`SendWebSocketFrame`,
`MumbleAdapter.cs`); it needs the stream hoisted out of the retry loop into a field, plus a send
lock, since pongs share the socket.

Resync is rate-limited: one in flight, minimum 1s spacing, exponential backoff to 30s if gaps
persist. If the socket is down it is a no-op — reconnection delivers a snapshot anyway. The worst
case is a redundant snapshot, never a loop.

**Rejected alternative:** dropping and re-establishing the WebSocket to trigger a snapshot. It
costs a TLS handshake and makes the server broadcast `userMappingAdded` to everyone, so the
recovery path itself generates churn. The read loop needs fixing regardless.

---

## 5. Asset invalidation

A second event class, distinct from identity change, which the first draft of this design missed.

| | Identity change | Asset invalidation |
|---|---|---|
| Means | this session's identifier changed | the asset behind an identifier changed or was revoked |
| Cardinality | one session | one-to-many sessions |
| Examples | user picks a new companion | moderator redacts a skin; user changes avatar |

A moderator redaction is a single revision bump that changes N sessions atomically — which is
precisely the case a per-field CAS handles badly and a table-level revision handles naturally.

Invalidation events carry a revision like any other mutation, so a missed one is caught by gap
detection and repaired by the next snapshot.

Client-side an invalidation is two steps: the projection resets the affected sessions'
`companionId`, and the asset layer purges its cache entry. The projection emits the change; the
existing `cleanupEntry` / `deleteAtlas` machinery does the purge. No new caching code.

### 5.1 Correction to an earlier reading

An earlier analysis in this workstream claimed that a moderator deletion failed to reach
out-of-channel clients, leaving redacted skins rendering from IndexedDB. **That was wrong**, and
is recorded here so it is not rediscovered as a bug:

- Every Brmble client is force-joined to the gallery room on every `/auth`
  (`AuthEndpoints.cs:147-160` → `EnsureUserInRoom`).
- `useCustomCompanionGallery` listens on `RoomStateEvent.Events`, `RoomEvent.Timeline` and
  `ClientEvent.Sync`, so a redaction propagates via Matrix sync independently of the WebSocket and
  of voice channel.
- `applyRedaction` → `cleanupEntry` revokes the object URLs and calls `deleteAtlas`, a real
  IndexedDB delete. `resolveCompanionDisplay` falls back to floppy as soon as the entry is gone.

The moderation path is sound. The WebSocket `companionChanged` is only the selection reset.

---

## 6. Client structure

### 6.1 Output: two bridge events replace eight

`ApplyX` returns a `ChangeSet`, which becomes:

- `voice.usersReset { users: [...] }` — the complete list. Voice connect, disconnect (empty),
  reconnect.
- `voice.usersChanged { users: [...], removed: [sessions] }` — full rows for changed sessions.

`voice.connected` survives, but stops carrying `users`: it keeps the channel list and connection
metadata, and the user list arrives as the first `voice.usersReset`. This removes the only
wholesale user-list assignment outside the projection (`App.tsx:2176`).

Rows are always **complete** — every field present, nulls explicit. React therefore has nothing to
merge and no absent-vs-null ambiguity. There is exactly one row serializer, replacing the six
duplicated shapes in `MumbleAdapter.cs` (`2626`, `2660`, `2670`, `2685`, `4168` via
`SendVoiceConnected`, `4299`).

### 6.2 `App.tsx`: 17 `setUsers` sites become 2

```
voice.usersReset   → setUsers(d.users)
voice.usersChanged → setUsers(prev => applyChangeSet(prev, d))
```

`applyChangeSet` does index-by-session replace and remove, with **no field logic** — no `||`, no
`??`, no `!== undefined`. Adding a field to the projection requires no `App.tsx` change at all.

The 17 current sites decompose as:

| Group | Lines | Becomes |
|---|---|---|
| Avatar writes (5) | `1434`, `1562`, `1615`, `1630`, `1910` | writes to the avatar map (§6.3) |
| Bridge-event reducers (9) | `2176`, `2552`, `2765`, `2892`, `3058`, `3079`, `3104`, `3135`, `3144` | `voice.usersChanged` |
| Clear-to-empty (3) | `2273`, `3043`, `3718` | `voice.usersReset` with an empty list |

Deleted: `onVoiceUserJoined`, `onVoiceUserLeft`, `onVoiceUserCommentChanged`,
`onUserMappingUpdated`, `onSessionMappingSnapshot`, `onVoiceCompanionChanged`,
`onBrmbleClientActivated`, `onBrmbleClientDeactivated` (registered at `App.tsx:3211`, `3214`,
`3223`, `3266`, `3267`, `3268`, `3270`, `3271`) — along with the three-guard-style merge in
`onVoiceUserJoined` and the patch-only snapshot handler at `:3076-3082`.

### 6.3 Avatars move out of `users`

`avatarUrl` becomes its own React state keyed by **asset identity** (`matrixUserId`), joined onto
projection rows in a selector. The derive-and-retry effect (`App.tsx:1585-1592`, backed by
`fetchAvatarForUser` at `:1898` and the helpers in `utils/avatarFetch.ts`) is unchanged in
behaviour — it just reads from the projection and writes to the avatar map instead of round-tripping
through `users`.

This is what allows `users` to be overwritten wholesale without losing avatars. Keying by asset
identity rather than session also means a future shared media layer (§9) is a substitution rather
than a rewrite.

### 6.4 Targeted structural cleanup

In scope because the work lands here; not a general refactor:

- `MumbleAdapter.cs` is 4,698 lines and not `partial`. `UserProjectionStore` and `UserProjection`
  become standalone types in `Services/Voice/UserProjection/` with no Mumble dependency, so they
  unit-test without a protocol stack.
- `App.tsx` is 5,623 lines. User and avatar state move into a `useUserDirectory` hook alongside the
  existing 20 hooks, exposing `users` (joined), `usersRef` and the avatar map. Consumers keep the
  same row shape and do not change.
- The two divergent `User` types — `types/index.ts:22` (no `companionId`) and `App.tsx:651` (has
  it) — collapse to one, generated to match the C# record field-for-field, with `types/index.ts`
  re-exporting.

### 6.5 Other consumers

`_sessionMappings` is deleted. `GetSelfCompanionOrDefault` / `UpdateSelfCompanionMapping`
(`MumbleAdapter.cs:2104-2118`) read the projection instead. Duels are unaffected — they read the
*server's* `ISessionMappingService`, not this client cache.

### 6.6 Threading

Inputs arrive on three threads: Mumble protocol, WebSocket read loop, HTTP continuation. The store
takes a single lock for the apply, computes the `ChangeSet`, releases, and *then* emits to the
bridge. No bridge call happens under the lock.

---

## 7. Failure modes

| Failure | Before | After |
|---|---|---|
| Lost `brmbleClientActivated` | Badge reverts, rebroadcast forever | Stays unknown, kept; next snapshot corrects |
| Event missing `companionId` | Becomes floppy permanently | Ignored as unknown; skin preserved |
| Brmble restart | Everyone flagged non-Brmble, skins revert | `instanceId` change → full resync |
| Reordered events | Last writer wins | Lower revision ignored |
| Session leaves during outage | Ghost row forever | Snapshot reconciliation clears server fields |
| Moderator redaction missed | — | Gap detected, snapshot repairs |
| Brmble down entirely | — | Rows persist with stale enrichment; voice unaffected |

---

## 8. Testing

**1. `UserProjectionStore` unit tests** (`tests/Brmble.Client.Tests`, MSTest; `InternalsVisibleTo`
is already configured). No Mumble or network dependency, so these are fast and exhaustive:
ownership violations, unknown-never-overwrites, every sequencing branch, snapshot reconciliation.

Plus a **convergence test**: given a random permutation of a fixed event set with arbitrary drops,
applying them and then a final snapshot always yields the same projection. That property is the
whole design in one assertion.

**2. Server tests** (`tests/Brmble.Server.Tests`): revision monotonicity, `instanceId` stability
within a process, tri-state serialisation, and `requestSnapshot` handling — including a
multi-frame message, since the current read loop uses a 1024-byte buffer and ignores
`EndOfMessage`.

**3. Vitest** for `applyChangeSet` and the avatar join selector. Small, because little logic
remains.

### Acceptance tests

**Restart.** Against `docker-local`: two clients connected, one plain Mumble and one Brmble with a
custom companion. Restart only the `brmble` container. Assert no user-list flicker, the Brmble
badge never disappears, the custom skin never reverts to floppy, and voice is uninterrupted. This
currently fails on all four counts.

**Moderation.** A moderator redacts a skin while a client sits in a different channel with that
atlas cached. That client loses it from memory and disk without changing channels or reconnecting.
(Expected to pass already via Matrix sync — this pins it against regression.)

**Concurrency.** Several clients register their WebSockets simultaneously. Every one of them
receives a complete `sessionMappingSnapshot`, and every one converges on the same projection.
Simultaneous registration is what exposed this bug class originally — a deadlock left clients with
no snapshot at all (`29ac2c8c`) — so it is a standing acceptance criterion, not a one-off
regression test.

---

## 9. Not doing

Recorded so the next reader does not have to rediscover the reasoning.

**A unified Matrix media layer.** Avatar and custom-companion assets both resolve from Matrix and
share real primitives — mxc→http construction (four ad-hoc call sites with different arities),
bounded authenticated fetch, object-URL lifetime, in-flight dedupe, server-side image validation.
But they solve different problems: profile pull vs room-state subscription, unauthenticated
`<img src>` vs authenticated size-capped fetch, no cache vs IndexedDB LRU. The companion
implementation is more advanced but has no production usage yet; unifying today means rewriting
working avatar code against an unproven design. §3.4 and §6.3 keep the door open.

**Avatar authenticated-media migration.** Avatars resolve via the unauthenticated media endpoint
(`useMatrixClient.ts`, 4-arg `mxcUrlToHttp`), while the companion loader uses
`useAuthentication=true`. Matrix is moving to authenticated media, so this is a deprecation track
with its own risk profile. Separate work.

**IndexedDB keyspace reconciliation.** Nothing enumerates cached atlases and deletes keys absent
from the gallery, so an orphaned blob can survive to LRU eviction (100MB budget). It never renders,
because rendering requires a live gallery entry. Minor; belongs with the media layer.

**Persisting server session state.** Rebuilding from Ice `getUsers()` + SQLite is adequate once
`isBrmbleClient` stops asserting a false value. Persistence would be a larger change with its own
consistency questions.

**Ice connect retry.** `MumbleIceService` swallows a startup Ice failure with a warning and no
retry, leaving mappings empty until the next restart. Real, but independent of this design.

---

## 10. Rollout

Server changes are additive — `instanceId`, `revision`, tri-state, `requestSnapshot` — and ignored
by older clients, so the server ships first. The client change is a single atomic swap of the user
pipeline; there is no useful half-state, and Velopack delivers it in one update.

---

## 11. Open questions for the implementation plan

1. Projection version negotiation (§4.4): announced in the WS registration handshake, or derived
   from a `requestSnapshot` field? The former is cleaner but touches the handshake.
2. How long is "buffer briefly" for an event naming an unknown session, before resync?
3. Does `userMappingRemoved` still earn its place once snapshots reconcile membership?
