# Phase 2 handoff — start prompt

Paste the block below into a fresh session to execute Phase 2.

---

Implement Phase 2 of the Brmble user projection.

## Start here

Repo: `C:\Projects\brmble`
Branch: `feature/user-projection-phase-1` (HEAD should be `fced11b1`)

Read these, in this order:

1. `docs/superpowers/plans/2026-08-01-user-projection-phase-2-store.md` — the plan you are executing. Read it in full, including "Background you need", before writing any code.
2. `docs/superpowers/specs/2026-07-31-user-projection-design.md` — the approved design. §3.1, §3.2, §4.2, §4.3, §6.6 and §8 are the sections Phase 2 implements. Skim the rest.

The plan is self-contained: 6 tasks with complete code, exact commands and expected failure messages. Follow it in order.

## Sanity check you're in the right place

```powershell
git rev-parse --abbrev-ref HEAD        # feature/user-projection-phase-1
git log --oneline -1                   # fced11b1
Select-String -Path src/Brmble.Server/Events/MappingEventPublisher.cs -Pattern PublishExceptAsync
```

Baseline before you start — confirm both, so you can tell your own failures from pre-existing ones:

```powershell
dotnet build     # 0 warnings, 0 errors
dotnet test      # 1250 passing: Server 777, Client 301, MumbleVoiceEngine 99, Audio 73
```

If the baseline doesn't match, stop and ask rather than guessing which failures are yours.

## Context you need that isn't in the plan

**Phase 1 is open as PR #619** (`https://github.com/brmble/brmble/pull/619`), 18 commits, not yet merged. Phase 2 lands on the *same branch* — the PR picks up new commits automatically. Do not open a second PR.

**The branch is not based on `main`.** It diverges from `origin/main` at `a4c993fa` and carries an unmerged prior fix (`cd7b48fa`). `git diff main` is misleading; use `git diff origin/main...HEAD` if you need it.

**Task 1 touches files that are under review in #619.** If review comments land on `MappingEventPublisher.cs`, `SessionMappingHandler.cs`, `AuthEndpoints.cs`, `AuthService.cs`, `CustomCompanionEndpoints.cs`, `MumbleServerCallback.cs` or `BrmbleWebSocketHandler.cs` while you work, rebase before continuing. Tasks 2-6 touch only new files and cannot conflict.

## Environment traps that cost time in Phase 1

**1. The language server lies.** It reports unresolved `Moq`, `TestClass`, `Microsoft.Extensions`, `Ice`, `ProtoBuf`, `WebApplicationFactory` and similar in files you have not touched. These are false. `dotnet build` is the source of truth — trust it, not the inline diagnostics. Do not "fix" imports that are already correct.

**2. Moq mocks silently return defaults for new interface members.** When Phase 1 added `InstanceId` and `Revision` to `ISessionMappingService`, every `Mock<ISessionMappingService>` returned `null` and `0`, so payloads went out with blank envelopes and tests failed with confusing assertions rather than compile errors. Task 1 does not add interface members, so this specific trap should not recur — but if an envelope assertion fails with a blank or zero value, check the mock setup before suspecting the production code. The stubs live in:
   - `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs` (delegates to a real `SessionMappingService`)
   - `tests/Brmble.Server.Tests/Auth/AuthEndpointsCompanionTests.cs` (`CompanionAuthFactory` hides the base mock with a bare one)
   - `tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs`

**3. Hand-written test doubles break on interface changes.** `tests/Brmble.Server.Tests/Games/SessionMappingGamePresenceTests.cs` implements `ISessionMappingService` by hand, and `MappingEventPublisherTests` / `BrmbleWebSocketHandlerTests` implement `IBrmbleEventBus` by hand. Task 1 changes neither interface, but if you widen one you must update these.

**4. Adding a wire field breaks exact-string payload assertions.** Task 1 adds `baseRevision` to every event payload. At least one test previously asserted a full serialised JSON string; it was converted to a structural assertion in Phase 1, but check for others if a test fails on an unexpected substring. Prefer structural assertions — `instanceId` is a per-process GUID and can never be matched exactly.

**5. `dotnet test --no-build` after an edit runs stale binaries.** Only use `--no-build` immediately after a successful `dotnet build`.

**6. Git prints CRLF warnings on nearly every commit.** Cosmetic, ignore them.

## How to work

- Stay on `feature/user-projection-phase-1`. Do not create a new branch, and never commit to `main`.
- Use the **test-driven-development** skill. Every task starts with a failing test, and the plan states the expected failure message. Actually run it and watch it fail for that reason before implementing.
- Use the **verification-before-completion** skill before claiming anything works. Run the command, read the output, then make the claim.
- Commit after each task with the message given in that task's final step.
- Do not push or comment on the PR without asking first.

## Things the plan warns about — do not get these wrong

**1. The namespace is `Brmble.Client.Services.Voice.Projection`, not `...Voice.UserProjection`.** A namespace ending in the name of a type it contains trips CA1724 and can produce `CS0118 'namespace used like a type'`. Do not rename the folder to match the type.

**2. Snapshots and events treat `null` differently, on purpose.** On an *event*, a null server field means "not telling you" and must leave the existing value alone. On a *snapshot*, null means "there is no value" and must overwrite. Task 4's implementation overwrites; Task 5's preserves. Both have comments explaining why. Getting these the same way round is the single most likely way to break the design.

**3. A gap must apply nothing at all.** When `baseRevision > ours`, return `NeedsSnapshot` and change no row. Partially applying a gapped event is precisely what produces the confidently-wrong values this design exists to eliminate.

**4. Advance the cursor even when the event touches no row you hold.** An event for a session Mumble has not shown you is still an observed event. If you skip the cursor update, the next event looks like a gap and the client resyncs on every unrelated user's join. There is a test for this.

**5. Do not weaken the convergence test.** It is the design's core property in one assertion. If it fails, one of Tasks 3-5 has a real bug. Its final snapshot deliberately omits a session the events enrich — that omission is what makes it able to catch a snapshot-reconciliation regression instead of passing trivially. Do not "simplify" it by making the final snapshot complete.

**6. Phase 2 ships no behaviour.** Nothing calls the store. `MumbleAdapter.cs` and `App.tsx` must be untouched — that is an explicit "Done when" item. If you find yourself editing either, you have drifted into Phase 3.

## Done when

The plan's "Done when" checklist passes, including:

- `dotnet build` clean, 0 warnings
- `dotnet test` green with more than the 1250 baseline
- Every mapping **event** carries `baseRevision`; every **snapshot** carries `instanceId` and `revision` and no `baseRevision`
- Consecutive events from one publisher are contiguous — each event's `baseRevision` equals the previous event's `revision`
- The store has no Mumble, HTTP or JSON dependency:
  `Select-String -Path src/Brmble.Client/Services/Voice/Projection/*.cs -Pattern "MumbleSharp|HttpClient|JsonElement|System.Text.Json"` returns nothing
- `git diff origin/main...HEAD -- src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Web/src/App.tsx` shows no changes

Report back with: what you built, test counts before and after, and anything in the plan that turned out to be wrong. The last two phases each found real defects in their own plan — say so plainly if you find one rather than working around it silently.

## What happens after this (context, not your task)

**Phase 3** wires the store in and is where the user-visible fixes land: delete `_sessionMappings`, translate wire payloads into the Task 2 input records, collapse 17 `setUsers` sites in `App.tsx` to 2, move avatars into their own state keyed by `matrixUserId`, and add client version negotiation via a `pv` query parameter so the server can send one truthful `companionId` instead of the legacy `companionId`/`customCompanionId` split.

Phase 3 is **not planned yet, deliberately** — it touches the repo's two most actively edited files, and plans against them go stale fast. It gets planned after Phase 2 lands, against shipped code. Do not start it.
