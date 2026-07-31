# User Projection — session handoff

Sequence, current state, and a ready-to-paste prompt for whichever phase comes next.

**Design spec:** [`../specs/2026-07-31-user-projection-design.md`](../specs/2026-07-31-user-projection-design.md)
**Superseded problem statement:** [`../specs/2026-07-31-user-data-propagation-problem.md`](../specs/2026-07-31-user-data-propagation-problem.md)

---

## Phases

| Phase | Scope | Plan | Status |
|---|---|---|---|
| 1 | Server wire contract — `instanceId`, `revision`, tri-state `isBrmbleClient`, `requestSnapshot` | [`2026-07-31-user-projection-phase-1-server.md`](2026-07-31-user-projection-phase-1-server.md) | Planned, not built |
| 2 | `UserProjectionStore` — pure, dependency-free C# in `Brmble.Client` | Not written | Blocked on Phase 1 landing |
| 3 | Rewire `MumbleAdapter` + `App.tsx`; companion collapse; `pv` negotiation | Not written | Blocked on Phase 2 landing |

**Phases 2 and 3 are deliberately unplanned.** They touch `MumbleAdapter.cs` (~4,700 lines) and
`App.tsx` (~5,600 lines), the most actively edited files in the repo, and plans written against
them go stale fast — that has already happened twice during this work, once from the
`custom-companion` merge and once from the companion-race fix. Plan one phase at a time, against
code that exists.

---

## Prompt: build Phase 1

Paste everything between the rules into a fresh session.

---

Implement Phase 1 of the Brmble user projection work.

### Start here

Repo: `C:\Projects\brmble`
Branch: `docs/user-projection-design` (HEAD should be `2661adca`)

Read these two files first, in this order:

1. `docs/superpowers/specs/2026-07-31-user-projection-design.md` — the approved design. Read §1–§4 and §11 for context; skim the rest.
2. `docs/superpowers/plans/2026-07-31-user-projection-phase-1-server.md` — the plan you are executing. Read it in full, including "Background you need", before writing any code.

The plan is self-contained: 5 tasks, 42 checkbox steps, with complete code and exact commands. Follow it in order.

### Before you write code — sanity check you're on the right branch

Both of this plan's dependencies are **already satisfied** on this branch. These commands just confirm you haven't landed somewhere unexpected:

```powershell
git rev-parse --abbrev-ref HEAD          # expect: docs/user-projection-design
git log --oneline origin/main | Select-String "broadcast companion changes"
Select-String -Path src/Brmble.Server/Events/ISessionMappingService.cs -Pattern TryUpdateCompanionIdIfOwnedBy
```

All three must return something. The companion-race fix (`cd7b48fa`) is the base commit of this branch, so `TryUpdateCompanionIdIfOwnedBy` is present at `ISessionMappingService.cs:16` and in use at `AuthEndpoints.cs:334`. If it's missing, you're on the wrong branch — stop and ask.

Baseline before starting: `dotnet build` (0 warnings) and `dotnet test` (1230 passing — Server 758, Client 300, MumbleVoiceEngine 99, Audio 73). Confirm this so you can tell your own failures from pre-existing ones.

### How to work

- Create a new branch off the current one: `git checkout -b feature/user-projection-phase-1`. Never commit to main.
- Use the **test-driven-development** skill. The plan is written red-green-refactor and every task starts with a failing test. Actually run each test and watch it fail for the expected reason before implementing — the plan states the expected failure message.
- Use the **verification-before-completion** skill before claiming anything works. Run the command, read the output, then make the claim.
- Commit after each task, using the commit message given in that task's final step.
- Do not push or open a PR without asking first.

### Two things the plan warns about — do not get these wrong

1. **JSON naming.** Always write `instanceId = envelope.InstanceId`, never the `envelope.InstanceId` property shorthand. The event bus serialises with a camelCase policy but the tests use default options, so the shorthand emits `InstanceId` and every assertion fails.

2. **Locks and broadcasts.** Calling `BroadcastAsync` only enqueues; *awaiting* it waits for the fan-out. `MappingEventPublisher` enqueues under its lock and returns, and callers await outside. This is deliberate and is what keeps commit `cd7b48fa`'s concurrency fix intact. Do not "simplify" it by awaiting inside the lock.

### Ignore the LSP noise

The language server in this repo reports unresolved `Moq`, `TestClass`, `Microsoft.Extensions` and `Ice` references in files you have not touched. These are false — `dotnet build` is clean. Trust the build, not the diagnostics.

### Done when

The plan's "Done when" checklist passes, including the invariant that **every revision bump is announced** — cross-check each `Bump()` call site against a producer that broadcasts a stamped payload. An unannounced bump manufactures a phantom gap in every connected client.

Report back with: what you built, test counts before and after, and anything in the plan that turned out to be wrong.

### What happens after this (context, not your task)

Phase 1 is the server wire contract. It is additive — older clients ignore the new fields — so it ships alone and fixes nothing user-visible on its own. The restart symptoms (badge loss, companion reverting to floppy) are fixed in Phase 3.

- **Phase 2** builds `UserProjectionStore` in `Brmble.Client`: ownership-scoped inputs, unknown-never-overwrites-known, unit-testable without a protocol stack.
- **Phase 3** rewires `MumbleAdapter` and `App.tsx`: deletes `_sessionMappings`, collapses 17 `setUsers` sites to 2, moves avatars into their own state, and adds companion version negotiation via a `pv` query parameter on the `/ws` URL.

Do not start Phase 2. When Phase 1 is committed and green, stop and report.

---

## Prompt: plan Phase 2 (after Phase 1 lands)

---

Write the Phase 2 implementation plan for the Brmble user projection.

Read `docs/superpowers/specs/2026-07-31-user-projection-design.md` (§3, §5, §6.5, §8) and the Phase 1 plan and code as they were actually built — not as Phase 1 was planned, since the two may differ.

Phase 2 is `UserProjectionStore` in `src/Brmble.Client/Services/Voice/UserProjection/`: a pure type with no Mumble or network dependency, four apply methods, and the two rules from §3.2. No wiring into `MumbleAdapter` — that is Phase 3.

Use the **writing-plans** skill. Save to `docs/superpowers/plans/YYYY-MM-DD-user-projection-phase-2-store.md`.

Resolve spec §11 question 2 (how long to buffer an event naming an unknown session) as part of this plan, now that it can be measured against a real store.

---

## Decisions worth not relitigating

- **Mumble owns session existence.** If the Brmble container is down, rows still appear and voice keeps working. Rejected: the server assembling and pushing the whole list.
- **The projection carries identifiers, never resolved assets.** `avatarUrl` and `atlasCacheKey` stay outside it. See spec §3.4.
- **Every revision bump is announced.** An unannounced bump is worse than no bump. See spec §11.3.
- **`/auth/token` cannot be dropped** — the client needs credentials before the WebSocket is up. See spec §2.1.
- **Moderator redactions already reach every client** via Matrix sync, independently of the WebSocket. An earlier reading claimed otherwise and was wrong; see spec §5.1 before re-investigating.
