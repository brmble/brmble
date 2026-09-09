# Phase 3 handoff — wiring the user projection

Implement Phase 3 of the Brmble user projection.

## Start here

Repo: `C:\Projects\brmble`
Branch: `feature/user-projection-phase-3` — already created for you, branched from `feature/user-projection-phase-2` at `b22c1f88`.

Read these, in this order:

1. `docs/superpowers/plans/2026-08-01-user-projection-phase-3-wiring.md` — the plan you are executing. Read it in full, including "Background you need" and "What Phase 1's late review fixes changed under this plan", before writing any code.
2. `docs/superpowers/specs/2026-07-31-user-projection-design.md` — the approved design. §3.4, §4.4, §5, §6, §8, §9 and §11 are what Phase 3 implements. Skim the rest.

The plan is self-contained: four stages (A–D), each independently shippable and green, with complete code, exact commands and expected failure messages. Follow it in order. **Stage D is the only one that changes user-visible behaviour** — A, B and C are groundwork, and shipping them green is the point.

## Sanity check you're in the right place

```powershell
git rev-parse --abbrev-ref HEAD        # feature/user-projection-phase-3
git log --oneline -1                   # b22c1f88 if no Phase 3 work has started
Select-String -Path src/Brmble.Client/Services/Voice/Projection/UserProjectionStore.cs -Pattern MaxPendingEntries
```

Baseline — confirm all of these before starting, so you can tell your own failures from pre-existing ones:

```powershell
dotnet build     # 0 warnings, 0 errors
dotnet test      # 1308 passing: Server 791, Client 345, MumbleVoiceEngine 99, Audio 73
cd src/Brmble.Web; npm run test -- --run; npx tsc --noEmit; cd ../..
```

Record the frontend test count yourself before you start — it is not written down here, and Stage D changes it.

If the baseline doesn't match, stop and ask rather than guessing which failures are yours.

## Context you need that isn't in the plan

**Phase 1 is merged.** PR #619 landed on `main` as merge commit `4fef8f13`, with history preserved. `git diff main` is meaningful again — the warnings in earlier handoffs about it being misleading no longer apply.

**Phase 2 is open as PR #622 and is not merged.** Your branch is stacked on it. Two consequences:

- When you open a PR, base it on `feature/user-projection-phase-2`, not `main` — otherwise Phase 2's 15 commits appear in your diff.
- If review changes land on #622, rebase before continuing: `git fetch origin; git rebase origin/feature/user-projection-phase-2`. Stage A touches only new files plus `MumbleAdapter.cs`, which Phase 2 does not touch, so conflicts are unlikely. Stage C touches `BrmbleWebSocketHandler.cs` and `MappingEventPublisher.cs`, which Phase 2 does touch.

**The plan's line numbers were taken before the Phase 1 merge.** Client-side references (`MumbleAdapter.cs`, `App.tsx`) were spot-checked afterwards and are accurate. `BrmbleWebSocketHandler.cs` shifted, so the plan deliberately names *methods* rather than lines in that file — if you find a line reference into it, re-derive it.

## Environment traps that cost real time

**1. The language server lies.** It reports unresolved `Moq`, `TestClass`, `Microsoft.Extensions`, `Ice`, `ProtoBuf`, `WebApplicationFactory` in files you haven't touched. False. `dotnet build` is the source of truth. Don't "fix" imports that are already correct.

**2. Moq returns silent defaults, and this causes hangs, not failures.** A `Mock<ISessionMappingService>` returns `false` from every `TryUpdate*`/`TryClaim*` and `0`/`null` from every property unless stubbed. In `InitializeAcceptedClientAsync` the relevant one is now **`TryClaimBrmbleSession`** (it replaced the `TryUpdateBrmbleStatus` + `TryUpdateCertHash` pair in Phase 1's `3c996dd1`). Unstubbed, no `userMappingAdded` is broadcast and any test awaiting that broadcast **waits forever**. Stage C changes this method's signature, so you will be in exactly this code. Fixtures: `Integration/BrmbleServerFactory.cs`, `Auth/AuthEndpointsCompanionTests.cs` (its `CompanionAuthFactory` hides the base mock), `Events/SessionMappingHandlerTests.cs`, `WebSockets/BrmbleWebSocketHandlerTests.cs`.

**3. `SetupSequence` doesn't support the out-parameter delegate overload.** `TryGetMappingByUserId` has two out params; `SetupSequence(...).Returns((long _, out int a, out SessionMapping? b) => ...)` fails with CS1660. Use one `Setup` with a call counter:

```csharp
var reads = 0;
mappings.Setup(x => x.TryGetMappingByUserId(42, out It.Ref<int>.IsAny, out It.Ref<SessionMapping?>.IsAny))
    .Returns((long _, out int sessionId, out SessionMapping? value) =>
    {
        sessionId = 7;
        value = Interlocked.Increment(ref reads) == 1 ? first : second;
        return true;
    });
```

**4. Hand-written test doubles break on interface changes.** `Games/SessionMappingGamePresenceTests.cs` implements `ISessionMappingService` by hand; `MappingEventPublisherTests` and `BrmbleWebSocketHandlerTests` implement `IBrmbleEventBus` by hand. Widening any of those interfaces means updating these.

**5. Beware asserting on fire-and-forget work.** `MumbleServerCallback.DispatchPaintParticipation` wraps its call in `_ = Task.Run(...)`. A test that awaits the outer method and then asserts `Times.Once` races the scheduler and flakes under load — one such test was fixed during Phase 2. Signal from the stub and await that, the way `DispatchUserStateChanged_DoesNotWaitForPaintParticipationFanOut` does.

**6. `dotnet test --no-build` after an edit runs stale binaries.** Only use it right after a successful build.

**7. `git rebase --continue` hangs.** It opens an editor for the commit message and waits forever. Set `$env:GIT_EDITOR="true"` first.

**8. `gh api --input <file>` returns HTTP 400 if the file has a UTF-8 BOM.** PowerShell's `Out-File -Encoding utf8` adds one. Use:

```powershell
[System.IO.File]::WriteAllText("$PWD\.git\body.json", $json, (New-Object System.Text.UTF8Encoding $false))
```

**9. PowerShell splits `gh api graphql -f query=...` on spaces.** Write the query to a file and use `-F query='@file.txt'` with quotes.

**10. Git prints CRLF warnings on nearly every commit.** Cosmetic.

## How to work

- Stay on `feature/user-projection-phase-3`. Never commit to `main` or the Phase 2 branch.
- Use the **test-driven-development** skill. Every task starts with a failing test and the plan states the expected failure message. Run it and watch it fail *for that reason* before implementing.
- Use the **verification-before-completion** skill before claiming anything works.
- Commit after each task with the message given in that task's final step.
- Do not push or open a PR without asking first.

## Things the plan warns about — do not get these wrong

- **`ProjectionWire` must live outside `Projection/`.** The store's value is that it has no JSON and no MumbleSharp dependency, which is what makes it testable without a protocol stack. There is a "Done when" grep enforcing this.
- **A snapshot's `null` is knowledge; an event's `null` is absence.** Phase 2 already implements both. Stage A's translator must not "helpfully" default absent fields — in particular `companionId` must become `null`, never `"floppy"`. The old `ParseSessionMappings` got this wrong in both directions and is being deleted, not patched.
- **`"floppy"` is a render-time fallback, never a stored or transmitted value.**
- **Broadcasts go to clients at mixed `pv` versions.** Only per-socket payloads may use the collapsed companion field. There are now **three** snapshot paths to thread the version through, not one — bootstrap, resync, and the shared `CreateSessionMappingSnapshotPayload`. Missing the resync one produces a bug that only appears after a gap.
- **The client's resync throttle must complete on *send*, not on receipt.** The server silently drops requests inside its 1s cooldown, so waiting for a reply that will never come wedges the throttle permanently.
- **`applyChangeSet` must contain no `||`, `??` or `!== undefined`.** Rows arriving from the bridge are already complete. Any merge logic there re-creates the exact class of bug this project exists to remove. There is a "Done when" item for it.
- **Delete `_userMappings` too.** It is a third identity store, keyed by mumble name, easy to miss, and read as a fallback in two places.

## Done when

The plan's "Done when" checklist passes, including:

- `dotnet build` clean, 0 warnings; `npx tsc --noEmit` clean
- `dotnet test` green with more than the 1308 baseline; `npm run test -- --run` green
- `Select-String -Path src/Brmble.Client/Services/Voice/MumbleAdapter.cs -Pattern "_sessionMappings|_pendingBrmbleStatus|_userMappings"` returns nothing
- `Select-String -Path src/Brmble.Client/Services/Voice/Projection/*.cs -Pattern "MumbleSharp|HttpClient|JsonElement|System.Text.Json"` returns nothing
- `(Select-String -Path src/Brmble.Web/src/App.tsx -Pattern "setUsers\(").Count` is 0
- The three acceptance tests in the plan pass — in particular the restart test, whose four assertions **all currently fail**

## Report back with

What you built, test counts before and after, and **anything in the plan that turned out to be wrong**. Every phase so far has found real defects in its own plan — Phase 2 found two, and Part A of the review found four more. Say so plainly if you find one rather than working around it silently.

Two items in the plan are explicitly flagged as judgement calls rather than instructions — resolve them with evidence and say which way you went:

- **Task C3** (`TryUpdateCompanionIdIfCurrent`): the expected answer is *keep it*, because the CAS guards a moderator reset racing a user's own selection, where neither party carries a client revision for the revision path to reject. Remove it only if you can write a failing test proving otherwise.
- **Task D1 Step 3** (`voice.userLeft`): it carries `moved` / `previousChannelId` / `currentChannelId`, which the overlay and TTS consume. Check whether those are load-bearing before deleting the event, and keep a presentation-only `voice.userMoved` if they are.
