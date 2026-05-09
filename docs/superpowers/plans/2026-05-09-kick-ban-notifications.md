# Kick Ban Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show clear top-right notifications when the local user is kicked or banned from a Mumble server.

**Architecture:** Extend the existing `voice.disconnected` bridge payload from self `UserRemove` with kick/ban metadata. The React app consumes that metadata and renders one stable replacement notification with ID `server-removal`.

**Tech Stack:** C# Mumble client bridge, React/TypeScript, MSTest, Vitest.

---

### Task 1: Backend Removal Payload

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterRemovalEventTests.cs`

- [ ] **Step 1: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/MumbleAdapterRemovalEventTests.cs`:

```csharp
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterRemovalEventTests
{
    [TestMethod]
    public void CreateServerRemovalPayload_ForKick_ReturnsWarningMetadata()
    {
        var payload = MumbleAdapter.CreateServerRemovalPayload(
            banned: false,
            actorName: "Moderator",
            reason: "Too loud");

        Assert.AreEqual("kicked", payload.Reason);
        Assert.AreEqual("Moderator", payload.ActorName);
        Assert.AreEqual("Too loud", payload.Message);
    }

    [TestMethod]
    public void CreateServerRemovalPayload_ForBan_ReturnsBanMetadata()
    {
        var payload = MumbleAdapter.CreateServerRemovalPayload(
            banned: true,
            actorName: "Admin",
            reason: "Spam");

        Assert.AreEqual("banned", payload.Reason);
        Assert.AreEqual("Admin", payload.ActorName);
        Assert.AreEqual("Spam", payload.Message);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterRemovalEventTests"`

Expected: FAIL because `CreateServerRemovalPayload` does not exist.

- [ ] **Step 3: Implement helper and emit payload**

In `MumbleAdapter.cs`, add an internal record and helper:

```csharp
internal sealed record ServerRemovalPayload(string Reason, string ActorName, string? Message, bool ReconnectAvailable);

internal static ServerRemovalPayload CreateServerRemovalPayload(bool banned, string? actorName, string? reason)
{
    return new ServerRemovalPayload(
        banned ? "banned" : "kicked",
        string.IsNullOrWhiteSpace(actorName) ? "the server" : actorName,
        string.IsNullOrWhiteSpace(reason) ? null : reason,
        true);
}
```

In `UserRemove`, when `isSelf`, send `voice.disconnected` with this payload after the existing system message.

- [ ] **Step 4: Run backend tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterRemovalEventTests|FullyQualifiedName~MumbleAdapterMoveEventTests"`

Expected: PASS.

### Task 2: Frontend Notification

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write failing frontend tests**

Add tests that emit `voice.disconnected` with kick and ban payloads, then assert `notifQueue.register('server-removal', ...)` and notification copy appears.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- App.screenShareStart.test.ts` from `src/Brmble.Web`.

Expected: FAIL because no server-removal notification exists.

- [ ] **Step 3: Implement server-removal notification**

In `App.tsx`, add `getServerRemovalNotification()` helper:

```ts
export function getServerRemovalNotification(input: { reason: 'kicked' | 'banned'; actorName?: string; message?: string }) {
  const actorName = input.actorName || 'the server';
  const action = input.reason === 'banned' ? 'banned' : 'kicked';
  return {
    status: input.reason === 'banned' ? 'error' as const : 'warning' as const,
    title: input.reason === 'banned' ? 'Banned from server' : 'Kicked from server',
    detail: `${actorName} ${action} you from the server.${input.message ? ` Reason: ${input.message}` : ''}`,
  };
}
```

Use stable ID `server-removal`, register it when disconnect payload reason is `kicked` or `banned`, and render it as top-right `<Notification>`.

- [ ] **Step 4: Run frontend tests**

Run: `npm test -- App.screenShareStart.test.ts` from `src/Brmble.Web`.

Expected: PASS.

### Task 3: Verification

**Files:**
- Build/test only.

- [ ] **Step 1: Run targeted tests**

Run:
`dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterRemovalEventTests|FullyQualifiedName~MumbleAdapterMoveEventTests|FullyQualifiedName~MumbleAdapterCredentialsTests"`
`npm test -- App.screenShareEnded.test.ts App.screenShareStart.test.ts`

Expected: PASS.

- [ ] **Step 2: Build frontend and client**

Run:
`npm run build` from `src/Brmble.Web`
`dotnet build --no-incremental` from `src/Brmble.Client`

Expected: PASS with 0 C# warnings.
