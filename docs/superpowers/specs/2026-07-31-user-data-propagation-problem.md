# User data reaches clients by four different routes

> **Status: SUPERSEDED — historical record, do not work from this document.**
>
> The design that answers this is
> [`2026-07-31-user-projection-design.md`](2026-07-31-user-projection-design.md). All four open
> questions below are decided there, and its §2.1 carries forward the constraints.
>
> Kept because it holds the original evidence and debugging history. **Its line references are
> stale** — they predate the `custom-companion` merge (`31353ec5`) and no longer resolve. Use the
> design document for current anchors.
>
> One claim made during the follow-up investigation — that moderator redactions failed to reach
> out-of-channel clients — was later disproved. See §5.1 of the design.

**Status:** problem statement only. No solution chosen — this is input for a brainstorm.

**Written:** 2026-07-31, from the investigation behind `29ac2c8c`, `621ce204` and `659797c4`.

## Why this exists

Four bugs were fixed on `feature/minigame-framework-expansion` in one session. Three of them
were the same bug wearing different clothes. This records the shared cause with its evidence,
so the overhaul can start from findings rather than from another investigation.

The recurring symptom: **a user connects and other clients show them wrong** — no Brmble badge,
the default companion, no avatar — while the user themselves sees the correct thing.

## The four routes

A single row in the sidebar is assembled from four independent sources.

| Data | Origin | Transport | Lifetime |
|---|---|---|---|
| name, channel, mute/deaf, comment, `certHash` | Mumble server | Mumble protocol `UserState` | Re-sent on every change |
| `matrixUserId`, `companionId`, `isBrmbleClient`, `certHash` | Brmble server | HTTP `/auth/token` response | Once per voice connection (`_credentialsAlreadyFetched`, `MumbleAdapter.cs:87`) |
| the same fields | Brmble server | WS `sessionMappingSnapshot` | Once per WebSocket registration |
| the same fields | Brmble server | WS `userMappingAdded`, `brmbleClientActivated`/`Deactivated`, `companionChanged` | Fire once, never repeated |
| `avatarUrl` | Matrix homeserver | HTTP, on demand | Re-derived from state whenever `users` changes |

`certHash` genuinely has two origins and is resolved by preference at `MumbleAdapter.cs:4211`.

## The property that makes it fragile

Rows two to four carry **the same fields over three transports, none of which repeat**.

Those fields are then cached in `MumbleAdapter._sessionMappings` and **re-asserted to the UI on
every Mumble `UserState`**, via `voice.userJoined` (`MumbleAdapter.cs:4247`) — an event that has
nothing to do with them and fires on every mute toggle, channel move and comment reply.

So a fire-once event the cache cannot absorb does not produce a *missing* value. It produces a
**confidently wrong** value, rebroadcast indefinitely by an unrelated event.

That is the whole bug class:

- `brmbleClientActivated` for a session whose mapping had not arrived was discarded, then
  contradicted by the next `UserState` — badge reverted to a plain Mumble user.
- `userMappingAdded` omitted `companionId`, which was read as the default rather than as
  absent, and overwrote the cache entry — companion reverted to floppy.
- Two clients registering at once deadlocked, so neither received `sessionMappingSnapshot`
  at all, and every remote user stayed unflagged.

Contrast `avatarUrl`, which is **derived from `users` state** by a safety-net effect
(`App.tsx:1317-1334`) with retries. A lost event costs nothing there: the next render re-derives
it. Its one bug was a stale suppression record, not a lost update. **This is the pattern that
works, and it is the odd one out.**

## The second half: merging

`setUsers` is called from **17 sites** in `App.tsx`, roughly six of them bridge-event reducers,
each with hand-written merge rules.

The rules are per-call-site and inconsistent. In `onVoiceUserJoined` alone (`App.tsx:2275-2286`)
`certHash` and `matrixUserId` are guarded with `||`, `isBrmbleClient` with `!== undefined`, and
`companionId` was guarded by nothing at all until `621ce204`. The base expression is
`{ ...u, ...d }`, so any field the incoming payload carries as `null` or `undefined` silently
replaces a known value.

Consequences:
- every new field starts out unprotected
- every new reducer can wipe fields it does not know about
- there is no single place to state "absent means unknown, not empty"

## Constraints any solution has to respect

- The Mumble protocol is not ours to change; route one stays as it is.
- Route two exists because the client needs credentials before the WebSocket is up.
- The client is not the only consumer — `_sessionMappings` also feeds duels and companions.
- Whatever replaces this has to survive concurrent joins, which is what exposed all of it.

## Open design questions for the brainstorm

*(All four are answered in the design document — pointers added retrospectively.)*

1. Should server-owned user data become self-correcting like `UserState`, by periodic or
   change-driven re-assertion — or should the client resync when it sees an event for a
   session it cannot place? → **Resync on gap, driven by a revision counter** (design §4.2).
2. Can routes two and three collapse into one? They carry identical data for different
   reasons. → **No — two transports, one code path** (design §3.1, §2.1 constraint 2).
3. Should "absent" be representable at all on the wire, or should every payload be complete?
   → **Yes, as tri-state; absent means unknown** (design §3.2, §4.1).
4. Does the merge belong in one function in `App.tsx`, or should the adapter own a single
   authoritative user projection and the UI stop merging entirely? → **The adapter owns it; the
   UI stops merging** (design §3.1, §6.2).

## What is deliberately not decided here

Which of the above to do. Question 4 in particular is a large change with real trade-offs and
should not be settled in a document written by the person who just finished debugging it.
