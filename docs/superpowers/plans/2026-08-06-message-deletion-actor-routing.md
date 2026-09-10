# Message Deletion Actor Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore recent-message deletion for Brmble users by routing Matrix redactions through the correct actor for channels and direct messages.

**Architecture:** `MessageDeletionService` remains the authorization boundary and first classifies the registered room as a channel or DM. Channel redactions use the existing default Brmble bot actor so administrators can moderate other users; DM redactions use the authenticated requester, with DM room creation explicitly allowing participant redactions. The existing optional actor parameter on `IMatrixAppService.RedactRoomEvent` is retained.

**Tech Stack:** .NET 10, ASP.NET Core minimal APIs, MSTest, Moq, Dapper, Matrix Client-Server API, TypeScript/React existing deletion client.

## Global Constraints

- Non-admins may delete only their own channel or DM message within 24 hours.
- Admins may delete any channel or DM message within 24 hours.
- Brmble server authorization remains authoritative; Matrix room permissions must not replace it.
- Channel redactions use the bot default; DM redactions use the authenticated requester.
- Do not add the Brmble bot to private DMs or use a Matrix admin token.
- Preserve unrelated bot-owned redaction callers and existing error/status mappings.

---

### Task 1: Add failing actor-routing coverage

**Files:**
- Modify: `tests/Brmble.Server.Tests/Integration/MessageDeletionEndpointTests.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs` only if the existing fixture needs a DM mapping helper

**Interfaces:**
- Consumes: `MessageDeletionService.DeleteAsync(User requester, string roomId, string eventId, CancellationToken cancellationToken)`.
- Produces: assertions that channel deletion calls `RedactRoomEvent(room, event, reason)` with the default bot actor and DM deletion calls the four-argument overload with the requester Matrix ID.

- [ ] **Step 1: Add a registered-DM fixture helper and four focused tests**

Use the existing `FactoryAsync` setup and add a DM mapping for the authenticated user. Add tests named:

```csharp
[TestMethod]
public async Task Administrator_DeletesOtherUsersChannelMessage_AsBot()

[TestMethod]
public async Task Author_DeletesOwnDmMessage_AsRequester()

[TestMethod]
public async Task Administrator_DeletesOtherUsersDmMessage_AsRequester()

[TestMethod]
public async Task NonAdministrator_CannotDeleteOtherUsersDmMessage()
```

For channel moderation, verify:

```csharp
factory.MatrixAppMock.Verify(matrix => matrix.RedactRoomEvent(
    RoomId, EventId, "Deleted through Brmble", null), Times.Once);
```

For DM deletion, verify the requester actor:

```csharp
factory.MatrixAppMock.Verify(matrix => matrix.RedactRoomEvent(
    DmRoomId, EventId, "Deleted through Brmble", "@alice:test"), Times.Once);
```

The non-admin test must assert `403`, code `not_authorized`, and no redaction.

- [ ] **Step 2: Run the focused tests and confirm the expected failures**

Run:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~MessageDeletionEndpointTests
```

Expected: the new channel moderation assertion fails because the service currently passes `@alice:test`; DM setup/assertions fail because the service does not distinguish room types.

### Task 2: Route channel and DM redaction actors

**Files:**
- Modify: `src/Brmble.Server/Messages/MessageDeletionService.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/MessageDeletionEndpointTests.cs`

**Interfaces:**
- Consumes: channel and DM room repositories already injected into `MessageDeletionService`.
- Produces: a private room-classification result and actor selection that calls `RedactRoomEvent(roomId, eventId, reason, actor)`.

- [ ] **Step 1: Add a private room classifier without changing authorization behavior**

Refactor `IsRequesterConversationAsync` into a method that returns a room kind, for example:

```csharp
private enum ConversationKind { Channel, DirectMessage, Unknown }
```

Check channel mappings first, then the requester’s DM mappings. Return `Unknown` when neither contains the requested room. Return `Forbidden` before Matrix access for `Unknown`, preserving the existing security behavior.

- [ ] **Step 2: Implement the minimal actor selection**

After the existing policy returns `Allowed`, call:

```csharp
var redactionActor = conversationKind == ConversationKind.DirectMessage
    ? requester.MatrixUserId
    : null;

await _matrix.RedactRoomEvent(
    roomId,
    eventId,
    "Deleted through Brmble",
    redactionActor);
```

Do not use `effectiveAuthor` as the redaction actor. Keep the current trusted-author parsing and policy evaluation unchanged.

- [ ] **Step 3: Run the focused server tests**

Run the same `MessageDeletionEndpointTests` command. Expected: all actor-routing tests and all existing deletion tests pass.

- [ ] **Step 4: Commit the implementation unit**

```text
git add src/Brmble.Server/Messages/MessageDeletionService.cs tests/Brmble.Server.Tests/Integration/MessageDeletionEndpointTests.cs
git commit -m "fix: route message deletion by room type"
```

### Task 3: Permit participant redaction in newly created DMs

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixAppService.cs` in `CreateDMRoom`
- Modify: `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`

**Interfaces:**
- Consumes: existing `CreateDMRoom(string localpartA, string localpartB)`.
- Produces: DM rooms whose initial `m.room.power_levels` state permits joined participants to submit redactions, while the server endpoint still controls who may request deletion.

- [ ] **Step 1: Add a failing request-shape test**

Capture the `createRoom` JSON in the existing Matrix HTTP test handler, call `CreateDMRoom("alice", "bob")`, and assert the initial state includes:

```json
{
  "type": "m.room.power_levels",
  "content": { "redact": 0 }
}
```

The test should fail because the current `trusted_private_chat` request has no explicit power-level state.

- [ ] **Step 2: Add explicit DM power levels**

Change the `CreateDMRoom` body to include an `initial_state` entry for `m.room.power_levels` with `users_default: 0`, `events_default: 0`, `state_default: 50`, and `redact: 0`. Preserve the private trusted invite behavior and the two participant IDs.

- [ ] **Step 3: Run Matrix-focused tests**

Run:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~MatrixAppServiceTests
```

Expected: all Matrix service tests pass, including the new DM power-level assertion and existing bot-default redaction tests.

- [ ] **Step 4: Commit the DM room change**

```text
git add src/Brmble.Server/Matrix/MatrixAppService.cs tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs
git commit -m "fix: allow participant redaction in new DMs"
```

### Task 4: Full verification and final review

**Files:**
- Verify only: all files changed by Tasks 1–3

- [ ] **Step 1: Run the complete server test suite**

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: zero failed tests.

- [ ] **Step 2: Run the relevant web regression tests**

```text
npm run test -- --run src/utils/replyHelpers.test.ts
npm run test -- --run src/components/ChatPanel/ChatPanel.test.tsx
npm run test -- --run src/components/ChatPanel/MessageBubble.test.tsx
```

Expected: all existing deletion UI tests pass; no frontend behavior changes are required.

- [ ] **Step 3: Inspect formatting and scope**

Run `git diff --check`, inspect the scoped diff, and confirm no untracked user files were staged. Confirm the final behavior matrix matches the requirement for channel/DM and author/admin combinations.

- [ ] **Step 4: Commit verification-only adjustments if needed**

Only commit if a test-only correction was required:

```text
git add <scoped-test-files>
git commit -m "test: cover message deletion actor routing"
```
