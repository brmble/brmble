# LiveKit Token Refresh Revocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh active LiveKit authorization before expiry and promptly remove affected LiveKit participants when voice/channel access changes.

**Architecture:** Add a focused in-memory participant tracker on the server, record participants on successful token issuance, and use lifecycle helpers to revoke only affected participant identities. Add a client-side refresh lease in `useScreenShare` that reuses the existing token endpoint before `expiresAt` and disconnects/cleans up on refresh failure.

**Tech Stack:** ASP.NET Core minimal APIs, MSTest, Moq, React 19, TypeScript, Vitest, LiveKit client SDK.

---

## File Structure

- Create: `src/Brmble.Server/LiveKit/LiveKitParticipantTracker.cs`
  - Owns in-memory active LiveKit participant bookkeeping.
  - Does not authorize requests and does not call LiveKit.
- Create: `tests/Brmble.Server.Tests/LiveKit/LiveKitParticipantTrackerTests.cs`
  - Unit-tests tracker upsert, removal, channel filtering, and pruning.
- Create: `src/Brmble.Server/LiveKit/ILiveKitParticipantRemover.cs`
  - Testable abstraction for removing LiveKit participant identities.
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
  - Implement `ILiveKitParticipantRemover` on existing service.
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`
  - Register `LiveKitParticipantTracker` and `ILiveKitParticipantRemover`.
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
  - Record participant tracker entries on successful `/livekit/token` responses.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
  - Assert successful token issuance records participant bookkeeping.
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
  - Revoke tracked participant records on disconnect and channel move.
  - Keep existing screen-share stop broadcasts for publishers.
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`
  - Assert disconnect and move revoke publishers/viewers correctly.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  - Add refresh scheduling and cleanup around active room leases.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  - Add Vitest coverage for refresh scheduling, success, failure, and timer cleanup.

---

### Task 1: Server Participant Tracker

**Files:**
- Create: `tests/Brmble.Server.Tests/LiveKit/LiveKitParticipantTrackerTests.cs`
- Create: `src/Brmble.Server/LiveKit/LiveKitParticipantTracker.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`

- [ ] **Step 1: Write failing tracker tests**

Create `tests/Brmble.Server.Tests/LiveKit/LiveKitParticipantTrackerTests.cs` with:

```csharp
using Brmble.Server.LiveKit;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitParticipantTrackerTests
{
    [TestMethod]
    public void Upsert_ReplacesExistingParticipantRecord()
    {
        var tracker = new LiveKitParticipantTracker();
        var firstExpiry = DateTimeOffset.UtcNow.AddMinutes(5);
        var secondExpiry = DateTimeOffset.UtcNow.AddMinutes(10);

        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, firstExpiry));
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Publish, secondExpiry));

        var records = tracker.GetSnapshot();

        Assert.AreEqual(1, records.Count);
        Assert.AreEqual(LiveKitAccessMode.Publish, records[0].AccessMode);
        Assert.AreEqual(secondExpiry, records[0].ExpiresAt);
    }

    [TestMethod]
    public void RemoveBySession_RemovesOnlyThatSession()
    {
        var tracker = new LiveKitParticipantTracker();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry));
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@bob:test", 20, 8, LiveKitAccessMode.Subscribe, expiry));

        var removed = tracker.RemoveBySession(7);

        Assert.AreEqual(1, removed.Count);
        Assert.AreEqual("@alice:test", removed[0].MatrixUserId);
        CollectionAssert.AreEquivalent(new[] { "@bob:test" }, tracker.GetSnapshot().Select(r => r.MatrixUserId).ToArray());
    }

    [TestMethod]
    public void RemoveRoomsOtherThan_RemovesOldRoomsAndKeepsCurrentRoom()
    {
        var tracker = new LiveKitParticipantTracker();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Publish, expiry));
        tracker.Upsert(new LiveKitParticipantRecord("channel-2", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry));

        var removed = tracker.RemoveBySessionExceptRoom(7, "channel-2");

        Assert.AreEqual(1, removed.Count);
        Assert.AreEqual("channel-1", removed[0].RoomName);
        Assert.AreEqual("channel-2", tracker.GetSnapshot().Single().RoomName);
    }

    [TestMethod]
    public void PruneExpired_RemovesExpiredRecords()
    {
        var tracker = new LiveKitParticipantTracker();
        var now = DateTimeOffset.UtcNow;
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@old:test", 10, 7, LiveKitAccessMode.Subscribe, now.AddSeconds(-1)));
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@fresh:test", 20, 8, LiveKitAccessMode.Subscribe, now.AddMinutes(5)));

        var removed = tracker.PruneExpired(now);

        Assert.AreEqual(1, removed.Count);
        Assert.AreEqual("@old:test", removed[0].MatrixUserId);
        Assert.AreEqual("@fresh:test", tracker.GetSnapshot().Single().MatrixUserId);
    }

    [TestMethod]
    public void Remove_RemovesByRoomAndIdentity()
    {
        var tracker = new LiveKitParticipantTracker();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(5);
        tracker.Upsert(new LiveKitParticipantRecord("channel-1", "@alice:test", 10, 7, LiveKitAccessMode.Subscribe, expiry));

        var removed = tracker.Remove("channel-1", "@alice:test");

        Assert.IsNotNull(removed);
        Assert.AreEqual("@alice:test", removed.MatrixUserId);
        Assert.AreEqual(0, tracker.GetSnapshot().Count);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter LiveKitParticipantTrackerTests`

Expected: FAIL because `LiveKitParticipantTracker` and `LiveKitParticipantRecord` do not exist.

- [ ] **Step 3: Implement tracker**

Create `src/Brmble.Server/LiveKit/LiveKitParticipantTracker.cs` with:

```csharp
using System.Collections.Concurrent;

namespace Brmble.Server.LiveKit;

public sealed record LiveKitParticipantRecord(
    string RoomName,
    string MatrixUserId,
    long UserId,
    int SessionId,
    LiveKitAccessMode AccessMode,
    DateTimeOffset ExpiresAt);

public sealed class LiveKitParticipantTracker
{
    private readonly ConcurrentDictionary<(string RoomName, string MatrixUserId), LiveKitParticipantRecord> _participants = new();

    public void Upsert(LiveKitParticipantRecord record)
        => _participants[(record.RoomName, record.MatrixUserId)] = record;

    public LiveKitParticipantRecord? Remove(string roomName, string matrixUserId)
    {
        return _participants.TryRemove((roomName, matrixUserId), out var record)
            ? record
            : null;
    }

    public IReadOnlyList<LiveKitParticipantRecord> RemoveBySession(int sessionId)
        => RemoveWhere(record => record.SessionId == sessionId);

    public IReadOnlyList<LiveKitParticipantRecord> RemoveBySessionExceptRoom(int sessionId, string roomName)
        => RemoveWhere(record => record.SessionId == sessionId && !string.Equals(record.RoomName, roomName, StringComparison.Ordinal));

    public IReadOnlyList<LiveKitParticipantRecord> PruneExpired(DateTimeOffset now)
        => RemoveWhere(record => record.ExpiresAt <= now);

    public IReadOnlyList<LiveKitParticipantRecord> GetSnapshot()
        => _participants.Values.ToList();

    private IReadOnlyList<LiveKitParticipantRecord> RemoveWhere(Func<LiveKitParticipantRecord, bool> predicate)
    {
        var removed = new List<LiveKitParticipantRecord>();
        foreach (var pair in _participants)
        {
            if (predicate(pair.Value) && _participants.TryRemove(pair.Key, out var record))
            {
                removed.Add(record);
            }
        }

        return removed;
    }
}
```

Modify `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`:

```csharp
namespace Brmble.Server.LiveKit;

public static class LiveKitExtensions
{
    public static IServiceCollection AddLiveKit(this IServiceCollection services)
    {
        services.AddOptions<LiveKitSettings>()
            .BindConfiguration("LiveKit");
        services.AddSingleton<LiveKitService>();
        services.AddSingleton<ILiveKitRoomQuery>(sp => sp.GetRequiredService<LiveKitService>());
        services.AddSingleton<ScreenShareTracker>();
        services.AddSingleton<LiveKitParticipantTracker>();
        services.AddSingleton<IUserIdMapper, SessionMappingUserIdMapper>();
        services.AddHostedService<ScreenShareReconciliationService>();
        return services;
    }
}
```

- [ ] **Step 4: Run tracker tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter LiveKitParticipantTrackerTests`

Expected: PASS.

- [ ] **Step 5: Commit tracker**

```powershell
git add "src/Brmble.Server/LiveKit/LiveKitParticipantTracker.cs" "src/Brmble.Server/LiveKit/LiveKitExtensions.cs" "tests/Brmble.Server.Tests/LiveKit/LiveKitParticipantTrackerTests.cs"
git commit -m "feat: track active livekit participants"
```

---

### Task 2: Token Endpoint Participant Recording

**Files:**
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`

- [ ] **Step 1: Write failing endpoint test**

Add this test to `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs` before the private records:

```csharp
[TestMethod]
public async Task TokenRequest_WithCurrentChannelAccess_RecordsParticipant()
{
    using var factory = new BrmbleServerFactory();
    using var client = factory.CreateClient();

    var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
    var channelMembership = factory.Services.GetRequiredService<IChannelMembershipService>();
    var participantTracker = factory.Services.GetRequiredService<LiveKitParticipantTracker>();

    sessionMapping.SetNameForSession("TestUser", 7);
    await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "TestUser" });
    channelMembership.Update(7, 1);

    var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "subscribe" });

    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    var record = participantTracker.GetSnapshot().Single();
    Assert.AreEqual("channel-1", record.RoomName);
    Assert.AreEqual("@testuser:localhost", record.MatrixUserId);
    Assert.AreEqual(1L, record.UserId);
    Assert.AreEqual(7, record.SessionId);
    Assert.AreEqual(LiveKitAccessMode.Subscribe, record.AccessMode);
    Assert.IsTrue(record.ExpiresAt > DateTimeOffset.UtcNow);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter TokenRequest_WithCurrentChannelAccess_RecordsParticipant`

Expected: FAIL because no participant is recorded yet.

- [ ] **Step 3: Record participant after token issuance**

Modify the `/livekit/token` endpoint signature in `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs` to accept `LiveKitParticipantTracker participantTracker` after `IChannelMembershipService channelMembership`:

```csharp
IChannelMembershipService channelMembership,
LiveKitParticipantTracker participantTracker,
ILogger<LiveKitService> logger) =>
```

Replace the current `isInRequestedRoom` block with code that also captures the session id:

```csharp
var hasSession = sessionMapping.TryGetSessionByUserId(user.Id, out var sessionId);
var isInRequestedRoom = hasSession
    && channelMembership.TryGetChannel(sessionId, out var channelId)
    && string.Equals(roomName, $"channel-{channelId}", StringComparison.Ordinal);
```

After `metadata is null` handling and before URL construction, add:

```csharp
if (hasSession)
{
    participantTracker.PruneExpired(issuedAt);
    participantTracker.Upsert(new LiveKitParticipantRecord(
        roomName,
        user.MatrixUserId,
        user.Id,
        sessionId,
        accessMode.Value,
        metadata.ExpiresAt));
}
```

- [ ] **Step 4: Run endpoint tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter LiveKitEndpointsTests`

Expected: PASS.

- [ ] **Step 5: Commit endpoint recording**

```powershell
git add "src/Brmble.Server/LiveKit/LiveKitEndpoints.cs" "tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs"
git commit -m "feat: record livekit participants on token issuance"
```

---

### Task 3: Testable LiveKit Participant Removal Interface

**Files:**
- Create: `src/Brmble.Server/LiveKit/ILiveKitParticipantRemover.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`

- [ ] **Step 1: Add interface and wire callback to it**

Create `src/Brmble.Server/LiveKit/ILiveKitParticipantRemover.cs`:

```csharp
namespace Brmble.Server.LiveKit;

public interface ILiveKitParticipantRemover
{
    Task RemoveParticipant(string roomName, string participantIdentity);
}
```

Modify `src/Brmble.Server/LiveKit/LiveKitService.cs` class declaration:

```csharp
public class LiveKitService : ILiveKitRoomQuery, ILiveKitParticipantRemover
```

Modify `src/Brmble.Server/LiveKit/LiveKitExtensions.cs` registrations:

```csharp
services.AddSingleton<ILiveKitRoomQuery>(sp => sp.GetRequiredService<LiveKitService>());
services.AddSingleton<ILiveKitParticipantRemover>(sp => sp.GetRequiredService<LiveKitService>());
```

Modify `src/Brmble.Server/Mumble/MumbleServerCallback.cs` field and constructor parameter from `LiveKitService liveKitService` to:

```csharp
private readonly ILiveKitParticipantRemover _liveKitParticipantRemover;
```

Constructor parameter:

```csharp
ILiveKitParticipantRemover liveKitParticipantRemover,
```

Constructor assignment:

```csharp
_liveKitParticipantRemover = liveKitParticipantRemover;
```

Replace existing `_liveKitService.RemoveParticipant(...)` calls with:

```csharp
await _liveKitParticipantRemover.RemoveParticipant(roomName, mapping.MatrixUserId);
```

Modify `CreateCallback` in `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs` to accept the interface:

```csharp
ILiveKitParticipantRemover? liveKitParticipantRemover = null,
```

And pass this default to the callback constructor:

```csharp
liveKitParticipantRemover ?? new Mock<ILiveKitParticipantRemover>().Object,
```

- [ ] **Step 2: Run server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "MumbleServerCallbackTests|LiveKitServiceRemoveParticipantTests"`

Expected: PASS. This is a refactor to make the next task testable.

- [ ] **Step 3: Commit interface refactor**

```powershell
git add "src/Brmble.Server/LiveKit/ILiveKitParticipantRemover.cs" "src/Brmble.Server/LiveKit/LiveKitService.cs" "src/Brmble.Server/LiveKit/LiveKitExtensions.cs" "src/Brmble.Server/Mumble/MumbleServerCallback.cs" "tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs"
git commit -m "refactor: abstract livekit participant removal"
```

---

### Task 4: Server Lifecycle Revocation

**Files:**
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`

- [ ] **Step 1: Write failing disconnect revocation tests**

Add these tests to `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`:

```csharp
[TestMethod]
public async Task DispatchUserDisconnected_RevokesViewerOnlyParticipantWithoutShareStopped()
{
    var bus = new Mock<IBrmbleEventBus>();
    var capturedMessages = new List<object>();
    bus.Setup(b => b.BroadcastAsync(It.IsAny<object>()))
        .Callback<object>(msg => capturedMessages.Add(msg))
        .Returns(Task.CompletedTask);

    var mapping = new Mock<ISessionMappingService>();
    mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
    {
        { 42, new SessionMapping("@alice:test", "Alice", 100L) }
    });

    var participantTracker = new LiveKitParticipantTracker();
    participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

    var remover = new Mock<ILiveKitParticipantRemover>();
    remover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>())).Returns(Task.CompletedTask);

    var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, liveKitParticipantRemover: remover.Object, liveKitParticipantTracker: participantTracker);

    await callback.DispatchUserDisconnected(new MumbleUser("Alice", "abc", 42));

    remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Once);
    Assert.AreEqual(0, participantTracker.GetSnapshot().Count);
    Assert.IsFalse(capturedMessages.Any(m => JsonSerializer.Serialize(m).Contains("screenShare.stopped")));
}

[TestMethod]
public async Task DispatchUserDisconnected_RevokesPublisherAndViewerRecords()
{
    var bus = new Mock<IBrmbleEventBus>();
    bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
    var mapping = new Mock<ISessionMappingService>();
    mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
    {
        { 42, new SessionMapping("@alice:test", "Alice", 100L) }
    });

    var tracker = new ScreenShareTracker();
    tracker.Start("channel-5", "Alice", 100L, "@alice:test");
    var participantTracker = new LiveKitParticipantTracker();
    participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Publish, DateTimeOffset.UtcNow.AddMinutes(5)));
    participantTracker.Upsert(new LiveKitParticipantRecord("channel-9", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

    var remover = new Mock<ILiveKitParticipantRemover>();
    remover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>())).Returns(Task.CompletedTask);
    var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, screenShareTracker: tracker, liveKitParticipantRemover: remover.Object, liveKitParticipantTracker: participantTracker);

    await callback.DispatchUserDisconnected(new MumbleUser("Alice", "abc", 42));

    remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Once);
    remover.Verify(r => r.RemoveParticipant("channel-9", "@alice:test"), Times.Once);
    Assert.IsNull(tracker.GetActive("channel-5"));
    Assert.AreEqual(0, participantTracker.GetSnapshot().Count);
}
```

Update `CreateCallback` parameters in the test file to include:

```csharp
LiveKitParticipantTracker? liveKitParticipantTracker = null,
```

Pass the tracker to `new MumbleServerCallback(...)` after the participant remover argument:

```csharp
liveKitParticipantTracker ?? new LiveKitParticipantTracker(),
```

- [ ] **Step 2: Run disconnect tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "DispatchUserDisconnected_RevokesViewerOnlyParticipantWithoutShareStopped|DispatchUserDisconnected_RevokesPublisherAndViewerRecords"`

Expected: FAIL because `MumbleServerCallback` does not accept or use `LiveKitParticipantTracker` yet.

- [ ] **Step 3: Implement disconnect revocation helper**

Modify `src/Brmble.Server/Mumble/MumbleServerCallback.cs` constructor dependencies by adding:

```csharp
private readonly LiveKitParticipantTracker _liveKitParticipantTracker;
```

Constructor parameter after `ILiveKitParticipantRemover liveKitParticipantRemover`:

```csharp
LiveKitParticipantTracker liveKitParticipantTracker,
```

Constructor assignment:

```csharp
_liveKitParticipantTracker = liveKitParticipantTracker;
```

Add this private helper inside the class:

```csharp
private async Task RevokeParticipants(IReadOnlyList<LiveKitParticipantRecord> records)
{
    foreach (var record in records)
    {
        await _liveKitParticipantRemover.RemoveParticipant(record.RoomName, record.MatrixUserId);
    }
}
```

In `DispatchUserDisconnected`, after the existing share stop loop and before `_sessionMapping.RemoveSession(...)`, add:

```csharp
var revokedRecords = _liveKitParticipantTracker.RemoveBySession(user.SessionId);
await RevokeParticipants(revokedRecords);
```

- [ ] **Step 4: Run disconnect revocation tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "DispatchUserDisconnected_RevokesViewerOnlyParticipantWithoutShareStopped|DispatchUserDisconnected_RevokesPublisherAndViewerRecords"`

Expected: PASS.

- [ ] **Step 5: Write failing channel move revocation tests**

Add this test to `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`:

```csharp
[TestMethod]
public async Task DispatchUserStateChanged_RevokesOldRoomParticipantAndKeepsNewRoomParticipant()
{
    var bus = new Mock<IBrmbleEventBus>();
    bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
    var channelMembership = new Mock<IChannelMembershipService>();
    var mapping = new Mock<ISessionMappingService>();
    mapping.Setup(m => m.GetSnapshot()).Returns(new Dictionary<int, SessionMapping>
    {
        { 42, new SessionMapping("@alice:test", "Alice", 100L) }
    });

    var screenShareTracker = new ScreenShareTracker();
    screenShareTracker.Start("channel-5", "Alice", 100L, "@alice:test");
    var participantTracker = new LiveKitParticipantTracker();
    participantTracker.Upsert(new LiveKitParticipantRecord("channel-5", "@alice:test", 100L, 42, LiveKitAccessMode.Publish, DateTimeOffset.UtcNow.AddMinutes(5)));
    participantTracker.Upsert(new LiveKitParticipantRecord("channel-10", "@alice:test", 100L, 42, LiveKitAccessMode.Subscribe, DateTimeOffset.UtcNow.AddMinutes(5)));

    var remover = new Mock<ILiveKitParticipantRemover>();
    remover.Setup(r => r.RemoveParticipant(It.IsAny<string>(), It.IsAny<string>())).Returns(Task.CompletedTask);
    var callback = CreateCallback([], mapping: mapping.Object, bus: bus.Object, channelMembership: channelMembership.Object, screenShareTracker: screenShareTracker, liveKitParticipantRemover: remover.Object, liveKitParticipantTracker: participantTracker);

    await callback.DispatchUserStateChanged(new MumbleUser("Alice", "abc", 42), 10);

    remover.Verify(r => r.RemoveParticipant("channel-5", "@alice:test"), Times.Once);
    remover.Verify(r => r.RemoveParticipant("channel-10", "@alice:test"), Times.Never);
    Assert.IsNull(screenShareTracker.GetActive("channel-5"));
    Assert.AreEqual("channel-10", participantTracker.GetSnapshot().Single().RoomName);
}
```

- [ ] **Step 6: Run channel move test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter DispatchUserStateChanged_RevokesOldRoomParticipantAndKeepsNewRoomParticipant`

Expected: FAIL because channel move currently removes publisher share participants but not viewer-only tracker records.

- [ ] **Step 7: Implement channel move revocation**

In `DispatchUserStateChanged`, keep `_channelMembership.Update(user.SessionId, channelId);` and existing share-stop behavior. After the share room loop, add:

```csharp
var revokedRecords = _liveKitParticipantTracker.RemoveBySessionExceptRoom(user.SessionId, currentRoom);
await RevokeParticipants(revokedRecords);
```

When updating existing `_liveKitParticipantRemover.RemoveParticipant` calls in this method, call through the same participant remover field:

```csharp
await _liveKitParticipantRemover.RemoveParticipant(roomName, mapping.MatrixUserId);
```

If this causes duplicate removal for publisher records, remove the direct call inside the share loop and let `RevokeParticipants(revokedRecords)` remove tracked participants once. Keep the screen-share tracker stop and event broadcast inside the share loop.

- [ ] **Step 8: Run lifecycle tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter MumbleServerCallbackTests`

Expected: PASS.

- [ ] **Step 9: Commit lifecycle revocation**

```powershell
git add "src/Brmble.Server/Mumble/MumbleServerCallback.cs" "tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs"
git commit -m "feat: revoke livekit participants on voice changes"
```

---

### Task 5: Client Refresh Scheduling Tests

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Add fake timer cleanup to test setup**

Modify the import line in `src/Brmble.Web/src/hooks/useScreenShare.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Add this after the existing `beforeEach` block:

```ts
  afterEach(() => {
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Write failing refresh success test**

Add this test inside the `describe('useScreenShare', () => { ... })` block:

```ts
  it('refreshes token before expiry and keeps the room connected on success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'subscribe', requestId: 1 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1', accessMode: 'subscribe', requestId: 2 });

    await act(async () => {
      tokenHandlers[1]?.({ token: 'viewer-jwt-2', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:20:00.000Z', requestId: 2 });
      await Promise.resolve();
    });

    expect(mockRoom.disconnect).not.toHaveBeenCalled();
    expect(result.current.watchingShares).toHaveLength(1);
  });
```

- [ ] **Step 3: Write failing refresh failure test**

Add this test inside the same `describe` block:

```ts
  it('disconnects and clears watching state when token refresh fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    const tokenErrorHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.tokenError') tokenErrorHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
      tokenErrorHandlers[1]?.({ error: 'forbidden', requestId: 2 });
      await Promise.resolve();
    });

    expect(mockRoom.disconnect).toHaveBeenCalled();
    expect(result.current.watchingShares).toEqual([]);
    expect(result.current.error).toBe('LiveKit access could not be renewed');
  });
```

- [ ] **Step 4: Write failing timer cleanup test**

Add this test inside the same `describe` block:

```ts
  it('cancels pending token refresh when viewer disconnects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
    const tokenHandlers: Array<(data: unknown) => void> = [];
    let shareStartedHandler: ((data: unknown) => void) | null = null;

    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandlers.push(handler);
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
    });

    await act(async () => {
      const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
      tokenHandlers[0]?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: '2026-05-11T12:10:00.000Z', requestId: 1 });
      await promise;
    });

    await act(async () => {
      await result.current.disconnectViewer();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000);
    });

    const tokenRequests = (bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.requestToken');
    expect(tokenRequests).toHaveLength(1);
  });
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm run test -- src/hooks/useScreenShare.test.ts` from `src/Brmble.Web`.

Expected: FAIL because refresh scheduling is not implemented.

- [ ] **Step 6: Commit failing client tests only after confirming failure is expected**

Do not commit failing tests yet. Continue to Task 6 in the same working tree state.

---

### Task 6: Client Refresh Implementation

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Add refresh state refs and helpers**

In `src/Brmble.Web/src/hooks/useScreenShare.ts`, add these near the other type definitions:

```ts
type ActiveTokenLease = {
  roomName: string;
  accessMode: LiveKitAccessMode;
  url: string;
  expiresAt: string;
  generation: number;
};

const TOKEN_REFRESH_SAFETY_WINDOW_MS = 2 * 60 * 1000;
const MIN_TOKEN_REFRESH_DELAY_MS = 5 * 1000;
```

Inside `useScreenShare`, add refs near `pendingTokenRequestRef`:

```ts
  const activeTokenLeaseRef = useRef<ActiveTokenLease | null>(null);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add helper callbacks after `requestToken`:

```ts
  const clearTokenRefreshTimer = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
  }, []);

  const clearTokenLease = useCallback(() => {
    clearTokenRefreshTimer();
    activeTokenLeaseRef.current = null;
  }, [clearTokenRefreshTimer]);
```

- [ ] **Step 2: Add refresh scheduling callback**

Add this callback after `clearTokenLease`:

```ts
  const scheduleTokenRefresh = useCallback((lease: ActiveTokenLease) => {
    clearTokenRefreshTimer();

    const expiresAtMs = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }

    const delayMs = Math.max(MIN_TOKEN_REFRESH_DELAY_MS, expiresAtMs - Date.now() - TOKEN_REFRESH_SAFETY_WINDOW_MS);
    tokenRefreshTimerRef.current = setTimeout(() => {
      void (async () => {
        const currentLease = activeTokenLeaseRef.current;
        if (!currentLease || currentLease.generation !== lease.generation) {
          return;
        }

        try {
          const refreshed = await requestToken(currentLease.roomName, currentLease.accessMode);
          if (!refreshed.expiresAt || activeTokenLeaseRef.current?.generation !== currentLease.generation) {
            return;
          }

          const nextLease = { ...currentLease, url: refreshed.url, expiresAt: refreshed.expiresAt };
          activeTokenLeaseRef.current = nextLease;
          scheduleTokenRefresh(nextLease);
        } catch {
          if (activeTokenLeaseRef.current?.generation !== currentLease.generation) {
            return;
          }

          setError('LiveKit access could not be renewed');
          const room = roomRef.current;
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          clearTokenLease();
          invalidateRoomLifecycle();
          cancelPendingViewerAttempts();
          clearWatchingState();
          if (isSharingRef.current) {
            await stopLocalShare('interrupted', room);
          }
          try { await room?.disconnect(); } catch { /* ignore */ }
        }
      })();
    }, delayMs);
  }, [cancelPendingViewerAttempts, clearTokenLease, clearTokenRefreshTimer, clearWatchingState, invalidateRoomLifecycle, requestToken, stopLocalShare]);
```

If TypeScript reports use-before-declaration because `stopLocalShare`, `cancelPendingViewerAttempts`, or `clearWatchingState` are declared later, move this callback below those callback declarations and keep the same body.

- [ ] **Step 3: Store lease after initial room token**

In `ensureRoom`, replace:

```ts
const { token, url } = await requestToken(roomName, accessMode);
```

With:

```ts
const tokenResponse = await requestToken(roomName, accessMode);
const { token, url } = tokenResponse;
```

After `await room.connect(url, token);` and after the lifecycle generation check succeeds, add:

```ts
      if (tokenResponse.expiresAt) {
        const lease = {
          roomName,
          accessMode,
          url,
          expiresAt: tokenResponse.expiresAt,
          generation: roomLifecycleGenerationRef.current,
        };
        activeTokenLeaseRef.current = lease;
        scheduleTokenRefresh(lease);
      } else {
        clearTokenLease();
      }
```

Add `scheduleTokenRefresh` and `clearTokenLease` to the `ensureRoom` dependency array.

- [ ] **Step 4: Clear lease on all disconnect paths**

In `maybeDisconnectRoom`, after setting `roomReconnectUpgradeRef.current = false;`, add:

```ts
      clearTokenLease();
```

In `RoomEvent.Disconnected`, after `roomAccessModeRef.current = null;`, add:

```ts
        clearTokenLease();
```

In the `room.connect` catch block, after `roomReconnectUpgradeRef.current = false;`, add:

```ts
          clearTokenLease();
```

In `disconnectViewer`, before `await maybeDisconnectRoom();` in the no-user-id cleanup path, add:

```ts
    clearTokenLease();
```

In the unmount cleanup effect, before `invalidateRoomLifecycle();`, add:

```ts
      clearTokenLease();
```

Add `clearTokenLease` to dependency arrays for callbacks/effects that use it.

- [ ] **Step 5: Run client tests**

Run: `npm run test -- src/hooks/useScreenShare.test.ts` from `src/Brmble.Web`.

Expected: PASS.

- [ ] **Step 6: Commit client refresh**

```powershell
git add "src/Brmble.Web/src/hooks/useScreenShare.ts" "src/Brmble.Web/src/hooks/useScreenShare.test.ts"
git commit -m "feat: refresh livekit tokens before expiry"
```

---

### Task 7: Final Verification

**Files:**
- Verify all modified server and frontend files.

- [ ] **Step 1: Run server test suite**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS.

- [ ] **Step 2: Run frontend hook tests**

Run: `npm run test -- src/hooks/useScreenShare.test.ts` from `src/Brmble.Web`.

Expected: PASS.

- [ ] **Step 3: Build frontend**

Run: `npm run build` from `src/Brmble.Web`.

Expected: PASS with Vite production build output.

- [ ] **Step 4: Build solution**

Run: `dotnet build`

Expected: PASS.

- [ ] **Step 5: Check working tree**

Run: `git status --short --branch`

Expected: branch is `fix/livekit-token-refresh-revocation`; only unrelated pre-existing untracked files may remain (`%USERPROFILE%/`, `.opencode/plans/`, `nul`, `src/Brmble.Web/nul`).

- [ ] **Step 6: Commit verification fixes if any were required**

If verification required code changes, commit them:

```powershell
git add "src/Brmble.Server" "tests/Brmble.Server.Tests" "src/Brmble.Web/src/hooks/useScreenShare.ts" "src/Brmble.Web/src/hooks/useScreenShare.test.ts"
git commit -m "fix: stabilize livekit token revocation"
```

If no changes were required, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: participant tracking, token endpoint recording, disconnect/move revocation, viewer-only revocation, refresh before expiry, refresh failure cleanup, and verification are each covered by a task.
- Scope: permission-loss without a concrete event source is covered by reuse of the revocation helper when such events exist; current implementation enforces future denial through the existing token endpoint and early removal through observed disconnect/move events.
- Type consistency: `LiveKitParticipantRecord`, `LiveKitParticipantTracker`, and `ILiveKitParticipantRemover` are introduced before use in later tasks.
