# Admin Move Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a clear top-right notification when the local user is moved by another user/server, including when screen sharing is stopped by that move.

**Architecture:** Extend the existing `voice.channelChanged` bridge event with move metadata from Mumble `UserState.Actor`. The React app consumes that metadata, generates a queued `<Notification>`, and marks share teardown as an intentional channel-move reason so the generic technical failure is suppressed.

**Tech Stack:** C# Mumble client bridge, React/TypeScript, MSTest, Vitest.

---

### Task 1: Backend Move Metadata

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterMoveEventTests.cs`

- [ ] **Step 1: Write the failing test**

Create a focused test around a small formatter/helper that turns self-channel-change data into a payload with actor metadata:

```csharp
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterMoveEventTests
{
    [TestMethod]
    public void CreateChannelChangedPayload_WithActor_ReturnsMoveMetadata()
    {
        var payload = MumbleAdapter.CreateChannelChangedPayload(
            previousChannelId: 5,
            currentChannelId: 7,
            actorSession: 99,
            actorName: "Moderator",
            movedByOtherUser: true);

        Assert.AreEqual(7u, payload.ChannelId);
        Assert.AreEqual(5u, payload.PreviousChannelId);
        Assert.AreEqual(99u, payload.ActorSession);
        Assert.AreEqual("Moderator", payload.ActorName);
        Assert.AreEqual("moved", payload.Reason);
    }

    [TestMethod]
    public void CreateChannelChangedPayload_WithoutActor_ReturnsUnknownReason()
    {
        var payload = MumbleAdapter.CreateChannelChangedPayload(
            previousChannelId: 5,
            currentChannelId: 7,
            actorSession: null,
            actorName: null,
            movedByOtherUser: false);

        Assert.AreEqual(7u, payload.ChannelId);
        Assert.AreEqual(5u, payload.PreviousChannelId);
        Assert.IsNull(payload.ActorSession);
        Assert.IsNull(payload.ActorName);
        Assert.AreEqual("unknown", payload.Reason);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterMoveEventTests"`

Expected: FAIL because `MumbleAdapterMoveEventTests.cs` or `CreateChannelChangedPayload` does not exist.

- [ ] **Step 3: Implement minimal backend helper and event payload**

Add an internal payload record and helper in `MumbleAdapter.cs`:

```csharp
internal sealed record ChannelChangedPayload(
    uint ChannelId,
    uint? PreviousChannelId,
    uint? ActorSession,
    string? ActorName,
    string Reason);

internal static ChannelChangedPayload CreateChannelChangedPayload(
    uint? previousChannelId,
    uint currentChannelId,
    uint? actorSession,
    string? actorName,
    bool movedByOtherUser)
{
    return new ChannelChangedPayload(
        currentChannelId,
        previousChannelId,
        actorSession,
        string.IsNullOrWhiteSpace(actorName) ? null : actorName,
        movedByOtherUser ? "moved" : "unknown");
}
```

Update the local-user channel change send path to call this helper and pass actor metadata from `userState.Actor` when available and not the local user.

- [ ] **Step 4: Run backend tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterMoveEventTests|FullyQualifiedName~MumbleAdapterCredentialsTests"`

Expected: PASS.

### Task 2: Frontend Move Notification Utilities

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/App.test.tsx`

- [ ] **Step 1: Write failing utility tests**

Add tests for `getMovedChannelNotification`:

```ts
expect(getMovedChannelNotification({ actorName: 'Moderator', previousChannelName: 'General', channelName: 'Raid', wasSharing: true })).toEqual({
  status: 'info',
  title: 'Moved to Raid',
  detail: 'Moderator moved you from General to Raid. Screen sharing was stopped.',
});

expect(getMovedChannelNotification({ actorName: undefined, previousChannelName: undefined, channelName: 'Raid', wasSharing: false })).toEqual({
  status: 'info',
  title: 'Moved to Raid',
  detail: 'You were moved to Raid.',
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- App.test.tsx --runInBand` from `src/Brmble.Web` if supported by the repo test runner, otherwise run the existing frontend test command for `App.test.tsx`.

Expected: FAIL because `getMovedChannelNotification` does not exist.

- [ ] **Step 3: Implement utility and share stop reason**

Add:

```ts
export interface MovedChannelNotificationInput {
  actorName?: string;
  previousChannelName?: string;
  channelName: string;
  wasSharing: boolean;
}

export function getMovedChannelNotification(input: MovedChannelNotificationInput): ScreenShareEndedNotification {
  const movedBy = input.actorName || 'You were';
  const route = input.previousChannelName
    ? `${movedBy} moved you from ${input.previousChannelName} to ${input.channelName}`
    : input.actorName
      ? `${input.actorName} moved you to ${input.channelName}`
      : `You were moved to ${input.channelName}`;

  return {
    status: 'info',
    title: `Moved to ${input.channelName}`,
    detail: `${route}.${input.wasSharing ? ' Screen sharing was stopped.' : ''}`,
  };
}
```

Extend `LocalShareStopReason` in `useScreenShare.ts` with `'moved-channel'`, and make `getScreenShareEndedNotification('moved-channel')` return `null` because the move notification owns the message.

- [ ] **Step 4: Run utility tests**

Run the same frontend test command from Step 2.

Expected: PASS.

### Task 3: Frontend Event Wiring

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add move notification state**

Add a queued notification state similar to `screenShareEndedNotification`, with IDs like `channel-moved-${sequence}`.

- [ ] **Step 2: Wire `voice.channelChanged` metadata**

Update the event data type to include:

```ts
{ channelId: number; previousChannelId?: number; actorName?: string; reason?: 'moved' | 'unknown' }
```

When `reason === 'moved'` or `actorName` exists:
- Resolve destination and previous channel names from `channelsRef.current`.
- Read `const wasSharing = isSharingRef.current` before any share cleanup.
- If sharing, call `markLocalShareTeardownIntent('moved-channel')`.
- Set/register the move notification.

- [ ] **Step 3: Render the notification**

Render a top-right `<Notification>` using the shared stack and `notifQueue`.

- [ ] **Step 4: Verify no Toast usage**

Search for the new move code and confirm it renders `<Notification position="top-right" ...>` and does not use `Toast`.

### Task 4: Verification

**Files:**
- Build/test only.

- [ ] **Step 1: Run client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterMoveEventTests|FullyQualifiedName~MumbleAdapterCredentialsTests"`

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run the repo frontend test command for `App.test.tsx` from `src/Brmble.Web`.

Expected: PASS.

- [ ] **Step 3: Build frontend**

Run: `npm run build` from `src/Brmble.Web`.

Expected: PASS.

- [ ] **Step 4: Build client**

Run: `dotnet build --no-incremental` from `src/Brmble.Client` after closing running clients.

Expected: PASS with 0 warnings.
