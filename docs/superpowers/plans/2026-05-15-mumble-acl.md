# Mumble ACL Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native-compatible Mumble ACL administration to Brmble, with Mumble as the canonical source of truth and Brmble snapshots used only for UI hydration, broadcasts, and diagnostics.

**Architecture:** Add a focused ACL module in `src/Brmble.Server/Mumble` that wraps the generated ICE `ServerPrx`, maps ICE ACL/group payloads to Brmble DTOs, persists canonical snapshots in SQLite, authorizes every admin write through Mumble effective permissions, validates write payloads server-side, and dispatches refreshed ACL state only to clients that can currently manage the affected channel. Recipient selection for ACL broadcasts should start from currently connected Brmble users or sessions and only then perform any per-recipient Mumble permission verification; do not iterate the full registered-user table for every ACL change. The desktop client calls the server through existing mTLS/BouncyCastle bridge handlers in `MumbleAdapter`, while React renders and edits ACL state from bridge events rather than making direct browser `fetch()` calls. Write requests carry a snapshot hash so stale drafts are rejected instead of overwriting newer Mumble state.

**Tech Stack:** C#/.NET 10, ZeroC Ice generated Mumble bindings, Dapper + SQLite, ASP.NET Core minimal APIs, WebView2 NativeBridge, React 19 + TypeScript + Vitest.

---

## File Structure

**Files to create:**
- `src/Brmble.Server/Mumble/AclDtos.cs` - Brmble-owned ACL DTOs and write result records.
- `src/Brmble.Server/Mumble/AclMapper.cs` - Pure mapping between `MumbleServer.ACL`/`MumbleServer.Group` and DTOs.
- `src/Brmble.Server/Mumble/IMumbleAclService.cs` - Stable ACL service interface and ACL-specific exception types.
- `src/Brmble.Server/Mumble/MumbleAclIceClient.cs` - Thin testable wrapper around generated `MumbleServer.ServerPrx`.
- `src/Brmble.Server/Mumble/MumbleAclService.cs` - Fetch/write/group mutation operations against Mumble ICE.
- `src/Brmble.Server/Mumble/AclSnapshotRepository.cs` - SQLite materialized-view repository for ACL snapshots.
- `src/Brmble.Server/Mumble/AclAuthorizationService.cs` - Server-side check that caller has Mumble `PermissionWrite` on the channel.
- `src/Brmble.Server/Mumble/AclValidationService.cs` - Server-side validation for selectors, permission masks, and non-editable inherited entries.
- `src/Brmble.Server/Mumble/AclEventDispatcher.cs` - Authorized-recipient ACL event dispatch instead of global websocket broadcasts.
- `src/Brmble.Server/Mumble/AclSyncCoordinator.cs` - Refresh, persist, stale-mark, and broadcast orchestration.
- `src/Brmble.Server/Mumble/AclAdminEndpoints.cs` - Minimal API endpoints for ACL reads/writes.
- `tests/Brmble.Server.Tests/Mumble/AclMapperTests.cs` - Mapper unit tests.
- `tests/Brmble.Server.Tests/Mumble/AclSnapshotRepositoryTests.cs` - Snapshot persistence tests.
- `tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs` - ICE wrapper/service behavior tests.
- `tests/Brmble.Server.Tests/Mumble/AclValidationServiceTests.cs` - Server-side ACL input validation tests.
- `tests/Brmble.Server.Tests/Mumble/AclEventDispatcherTests.cs` - ACL broadcast filtering tests.
- `tests/Brmble.Server.Tests/Mumble/AclSyncCoordinatorTests.cs` - write-refresh-persist-broadcast tests.
- `tests/Brmble.Server.Tests/Integration/AclAdminEndpointTests.cs` - endpoint auth and response tests.
- `src/Brmble.Web/src/types/acl.ts` - Shared frontend ACL types.
- `src/Brmble.Web/src/hooks/useAclAdmin.ts` - Bridge-backed ACL data hook.
- `src/Brmble.Web/src/hooks/useAclAdmin.test.tsx` - Hook tests.
- `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx` - Channel ACL/group editor dialog.
- `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css` - Editor styles.
- `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx` - UI behavior tests.

**Files to modify:**
- `src/Brmble.Server/Data/Database.cs` - Add idempotent `acl_snapshots` table migration.
- `src/Brmble.Server/Events/IBrmbleEventBus.cs` - Add targeted user-id broadcast for ACL events.
- `src/Brmble.Server/Events/BrmbleEventBus.cs` - Implement targeted user-id broadcast without exposing `_clients`.
- `src/Brmble.Server/Mumble/MumbleExtensions.cs` - Register ACL services.
- `src/Brmble.Server/Mumble/MumbleIceService.cs` - Set the generated server proxy on `MumbleAclIceClient`.
- `src/Brmble.Server/Program.cs` - Map ACL admin endpoints.
- `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs` - Stub ACL services for endpoint tests where needed.
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` - Add bridge handlers for ACL HTTP calls and websocket forwarding for ACL broadcasts.
- `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs` - Add bridge/websocket parsing coverage.
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` - Open ACL editor from channel context menu and pass current channel metadata.
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx` - Verify ACL menu visibility and editor open behavior.
- `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx` - Replace password placeholder with channel password editing wired to ACL token selector rules.
- `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.css` - Style password controls.
- `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx` - Add an ACL help/diagnostics entry point if the current settings layout still needs one.

---

## Security and Correctness Constraints

- Mumble remains the only authorization authority. `acl_snapshots` are never used to decide whether a user may enter, traverse, speak, or manage a channel.
- Do not broadcast full ACL snapshots through `IBrmbleEventBus.BroadcastAsync`. ACL snapshots can contain token selectors that behave like access secrets. Use `AclEventDispatcher` and targeted websocket sends only.
- Every mutation path must call `AclAuthorizationService.CanManageChannelAclAsync`: full ACL writes, group add/remove, and the channel password-token helper.
- Every write request must include `expectedSnapshotHash`. The server re-fetches the current canonical ACL from Mumble, hashes it, and returns `409 Conflict` if it differs from the expected hash.
- Token selectors are stored in ICE `ACL.group` as raw selector strings such as `#secret`; when discussing the native Mumble UI selector syntax, write it as `@#secret`. Do not describe these as cryptographically hidden passwords.
- Persisting full canonical ACL snapshots in SQLite duplicates raw token selector material on disk. This is an explicit v1 tradeoff for canonical UI hydration, conflict detection, and diagnostics. Log output must continue to redact token selector values, and future hardening can evaluate field-level encryption or a reduced-fidelity cache model if this tradeoff becomes unacceptable.
- The channel password-token helper must preserve the user-supplied token value and must not delete arbitrary local `#...` token rules.
- Audit log every successful and failed ACL mutation with actor user id, channel id, operation name, and result. Redact token selector values from log messages.

### Task 1: Define ACL DTOs and Mapper

**Files:**
- Create: `src/Brmble.Server/Mumble/AclDtos.cs`
- Create: `src/Brmble.Server/Mumble/AclMapper.cs`
- Create: `tests/Brmble.Server.Tests/Mumble/AclMapperTests.cs`

- [ ] **Step 1: Write failing mapper tests**

```csharp
// tests/Brmble.Server.Tests/Mumble/AclMapperTests.cs
using Brmble.Server.Mumble;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclMapperTests
{
    [TestMethod]
    public void FromIce_PreservesRuleOrderAndSelectors()
    {
        var result = new MumbleServer.Server_GetACLResult(
            [
                new MumbleServer.ACL(true, true, false, -1, "admin", MumbleServer.PermissionWrite.value, 0),
                new MumbleServer.ACL(true, false, false, -1, "#secret", MumbleServer.PermissionEnter.value, 0),
                new MumbleServer.ACL(false, true, true, 42, "", 0, MumbleServer.PermissionSpeak.value)
            ],
            [
                new MumbleServer.Group("admin", false, true, true, [1], [2], [1, 3])
            ],
            inherit: true);
        var fetchedAt = new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero);

        var dto = AclMapper.FromIce(channelId: 7, result, fetchedAt, stale: false, warning: null);

        Assert.AreEqual(7, dto.ChannelId);
        Assert.IsTrue(dto.InheritAcls);
        Assert.AreEqual(3, dto.Acls.Count);
        Assert.AreEqual("admin", dto.Acls[0].Group);
        Assert.AreEqual("#secret", dto.Acls[1].Group);
        Assert.AreEqual(42, dto.Acls[2].UserId);
        Assert.IsTrue(dto.Acls[2].Inherited);
        Assert.AreEqual(1, dto.Groups.Count);
        CollectionAssert.AreEqual(new[] { 1, 3 }, dto.Groups[0].Members.ToArray());
    }

    [TestMethod]
    public void ToIce_IgnoresInheritedRulesAndMembersForWrites()
    {
        var request = new AclUpdateRequest(
            InheritAcls: false,
            Groups:
            [
                new AclGroupDto("writers", false, true, true, [5], [6], [5, 9]),
                new AclGroupDto("inherited", true, true, true, [1], [], [1])
            ],
            Acls:
            [
                new AclRuleDto(true, true, false, null, "writers", MumbleServer.PermissionTextMessage.value, 0),
                new AclRuleDto(true, true, true, null, "readonly", MumbleServer.PermissionEnter.value, 0),
                new AclRuleDto(true, false, false, 42, null, 0, MumbleServer.PermissionSpeak.value)
            ]);

        var (acls, groups, inherit) = AclMapper.ToIce(request);

        Assert.IsFalse(inherit);
        Assert.AreEqual(2, acls.Length);
        Assert.AreEqual("writers", acls[0].group);
        Assert.AreEqual(-1, acls[0].userid);
        Assert.AreEqual(42, acls[1].userid);
        Assert.AreEqual("", acls[1].group);
        Assert.AreEqual(1, groups.Length);
        Assert.AreEqual("writers", groups[0].name);
        CollectionAssert.AreEqual(new[] { 5 }, groups[0].add);
        CollectionAssert.AreEqual(new[] { 6 }, groups[0].remove);
        CollectionAssert.AreEqual(Array.Empty<int>(), groups[0].members);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclMapperTests" -v normal`

Expected: FAIL with compiler errors that `AclMapper`, `AclUpdateRequest`, `AclGroupDto`, and `AclRuleDto` do not exist.

- [ ] **Step 3: Add ACL DTO records**

```csharp
// src/Brmble.Server/Mumble/AclDtos.cs
namespace Brmble.Server.Mumble;

public sealed record AclChannelSnapshotDto(
    int ChannelId,
    bool InheritAcls,
    IReadOnlyList<AclGroupDto> Groups,
    IReadOnlyList<AclRuleDto> Acls,
    DateTimeOffset FetchedAt,
    bool Stale,
    string? Warning,
    string SnapshotHash = "");

public sealed record AclGroupDto(
    string Name,
    bool Inherited,
    bool Inherit,
    bool Inheritable,
    IReadOnlyList<int> Add,
    IReadOnlyList<int> Remove,
    IReadOnlyList<int> Members);

public sealed record AclRuleDto(
    bool ApplyHere,
    bool ApplySubs,
    bool Inherited,
    int? UserId,
    string? Group,
    int Allow,
    int Deny);

public sealed record AclUpdateRequest(
    bool InheritAcls,
    IReadOnlyList<AclGroupDto> Groups,
    IReadOnlyList<AclRuleDto> Acls,
    string? ExpectedSnapshotHash = null);

public sealed record AclGroupMemberRequest(int Session, string Group);

public sealed record AclWriteResult(
    bool Success,
    AclChannelSnapshotDto? Snapshot,
    string? Warning,
    string? Error);
```

- [ ] **Step 4: Add mapper implementation**

```csharp
// src/Brmble.Server/Mumble/AclMapper.cs
namespace Brmble.Server.Mumble;

public static class AclMapper
{
    public static AclChannelSnapshotDto FromIce(
        int channelId,
        MumbleServer.Server_GetACLResult result,
        DateTimeOffset fetchedAt,
        bool stale,
        string? warning)
    {
        return new AclChannelSnapshotDto(
            ChannelId: channelId,
            InheritAcls: result.inherit,
            Groups: result.groups.Select(ToDto).ToArray(),
            Acls: result.acls.Select(ToDto).ToArray(),
            FetchedAt: fetchedAt,
            Stale: stale,
            Warning: warning);
    }

    public static (MumbleServer.ACL[] Acls, MumbleServer.Group[] Groups, bool Inherit) ToIce(AclUpdateRequest request)
    {
        var acls = request.Acls
            .Where(rule => !rule.Inherited)
            .Select(ToIce)
            .ToArray();
        var groups = request.Groups
            .Where(group => !group.Inherited)
            .Select(ToIce)
            .ToArray();
        return (acls, groups, request.InheritAcls);
    }

    private static AclRuleDto ToDto(MumbleServer.ACL acl)
    {
        return new AclRuleDto(
            ApplyHere: acl.applyHere,
            ApplySubs: acl.applySubs,
            Inherited: acl.inherited,
            UserId: acl.userid >= 0 ? acl.userid : null,
            Group: acl.userid >= 0 ? null : acl.group,
            Allow: acl.allow,
            Deny: acl.deny);
    }

    private static AclGroupDto ToDto(MumbleServer.Group group)
    {
        return new AclGroupDto(
            Name: group.name,
            Inherited: group.inherited,
            Inherit: group.inherit,
            Inheritable: group.inheritable,
            Add: group.add,
            Remove: group.remove,
            Members: group.members);
    }

    private static MumbleServer.ACL ToIce(AclRuleDto rule)
    {
        var usesUser = rule.UserId is not null;
        return new MumbleServer.ACL(
            rule.ApplyHere,
            rule.ApplySubs,
            inherited: false,
            userid: usesUser ? rule.UserId!.Value : -1,
            group: usesUser ? "" : rule.Group ?? "",
            allow: rule.Allow,
            deny: rule.Deny);
    }

    private static MumbleServer.Group ToIce(AclGroupDto group)
    {
        return new MumbleServer.Group(
            group.Name,
            inherited: false,
            inherit: group.Inherit,
            inheritable: group.Inheritable,
            add: group.Add.ToArray(),
            remove: group.Remove.ToArray(),
            members: Array.Empty<int>());
    }
}
```

- [ ] **Step 5: Run mapper tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclMapperTests" -v normal`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Mumble/AclDtos.cs src/Brmble.Server/Mumble/AclMapper.cs tests/Brmble.Server.Tests/Mumble/AclMapperTests.cs
git commit -m "feat: add mumble acl dto mapping"
```

---

### Task 2: Add ICE ACL Client and Mumble ACL Service

**Files:**
- Create: `src/Brmble.Server/Mumble/IMumbleAclService.cs`
- Create: `src/Brmble.Server/Mumble/MumbleAclIceClient.cs`
- Create: `src/Brmble.Server/Mumble/MumbleAclService.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleIceService.cs`
- Create: `tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs`

- [ ] **Step 1: Write failing service tests**

```csharp
// tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleAclServiceTests
{
    [TestMethod]
    public async Task GetChannelAclAsync_ReturnsMappedCanonicalSnapshot()
    {
        var ice = new Mock<IMumbleAclIceClient>();
        ice.Setup(i => i.GetAclAsync(9))
            .ReturnsAsync(new MumbleServer.Server_GetACLResult(
                [new MumbleServer.ACL(true, true, false, -1, "all", MumbleServer.PermissionEnter.value, 0)],
                [],
                inherit: true));
        var service = new MumbleAclService(ice.Object, NullLogger<MumbleAclService>.Instance);

        var snapshot = await service.GetChannelAclAsync(9);

        Assert.AreEqual(9, snapshot.ChannelId);
        Assert.AreEqual("all", snapshot.Acls[0].Group);
        Assert.IsFalse(snapshot.Stale);
        Assert.IsNull(snapshot.Warning);
    }

    [TestMethod]
    public async Task SetChannelAclAsync_WritesOnlyLocalRules()
    {
        var ice = new Mock<IMumbleAclIceClient>();
        var service = new MumbleAclService(ice.Object, NullLogger<MumbleAclService>.Instance);
        var request = new AclUpdateRequest(
            InheritAcls: true,
            Groups: [],
            Acls:
            [
                new AclRuleDto(true, true, false, null, "#secret", MumbleServer.PermissionEnter.value, 0),
                new AclRuleDto(true, true, true, null, "inherited", MumbleServer.PermissionWrite.value, 0)
            ]);

        await service.SetChannelAclAsync(4, request);

        ice.Verify(i => i.SetAclAsync(
            4,
            It.Is<MumbleServer.ACL[]>(rules => rules.Length == 1 && rules[0].group == "#secret"),
            It.Is<MumbleServer.Group[]>(groups => groups.Length == 0),
            true), Times.Once);
    }

    [TestMethod]
    public async Task HasWritePermissionAsync_DelegatesToMumblePermissionWrite()
    {
        var ice = new Mock<IMumbleAclIceClient>();
        ice.Setup(i => i.HasPermissionAsync(12, 5, MumbleServer.PermissionWrite.value)).ReturnsAsync(true);
        var service = new MumbleAclService(ice.Object, NullLogger<MumbleAclService>.Instance);

        Assert.IsTrue(await service.HasWritePermissionAsync(sessionId: 12, channelId: 5));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MumbleAclServiceTests" -v normal`

Expected: FAIL with compiler errors for the new service types.

- [ ] **Step 3: Add interfaces and exceptions**

```csharp
// src/Brmble.Server/Mumble/IMumbleAclService.cs
namespace Brmble.Server.Mumble;

public interface IMumbleAclService
{
    Task<AclChannelSnapshotDto> GetChannelAclAsync(int channelId);
    Task SetChannelAclAsync(int channelId, AclUpdateRequest request);
    Task AddUserToGroupAsync(int channelId, int sessionId, string group);
    Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group);
    Task<bool> HasWritePermissionAsync(int sessionId, int channelId);
}

public interface IMumbleAclIceClient
{
    Task<MumbleServer.Server_GetACLResult> GetAclAsync(int channelId);
    Task SetAclAsync(int channelId, MumbleServer.ACL[] acls, MumbleServer.Group[] groups, bool inherit);
    Task AddUserToGroupAsync(int channelId, int sessionId, string group);
    Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group);
    Task<bool> HasPermissionAsync(int sessionId, int channelId, int permission);
}

public sealed class MumbleAclException : Exception
{
    public MumbleAclException(string message, Exception? inner = null) : base(message, inner) { }
}

public sealed class MumbleAclUnavailableException : Exception
{
    public MumbleAclUnavailableException(string message) : base(message) { }
}
```

- [ ] **Step 4: Add ICE client wrapper**

```csharp
// src/Brmble.Server/Mumble/MumbleAclIceClient.cs
namespace Brmble.Server.Mumble;

public sealed class MumbleAclIceClient : IMumbleAclIceClient
{
    private volatile MumbleServer.ServerPrx? _serverProxy;

    internal void SetServerProxy(MumbleServer.ServerPrx proxy) => _serverProxy = proxy;

    private MumbleServer.ServerPrx GetProxy()
    {
        return _serverProxy ?? throw new MumbleAclUnavailableException("Mumble ICE server proxy is not available.");
    }

    public Task<MumbleServer.Server_GetACLResult> GetAclAsync(int channelId)
        => GetProxy().getACLAsync(channelId);

    public Task SetAclAsync(int channelId, MumbleServer.ACL[] acls, MumbleServer.Group[] groups, bool inherit)
        => GetProxy().setACLAsync(channelId, acls, groups, inherit);

    public Task AddUserToGroupAsync(int channelId, int sessionId, string group)
        => GetProxy().addUserToGroupAsync(channelId, sessionId, group);

    public Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group)
        => GetProxy().removeUserFromGroupAsync(channelId, sessionId, group);

    public Task<bool> HasPermissionAsync(int sessionId, int channelId, int permission)
        => GetProxy().hasPermissionAsync(sessionId, channelId, permission);
}
```

- [ ] **Step 5: Add MumbleAclService**

```csharp
// src/Brmble.Server/Mumble/MumbleAclService.cs
namespace Brmble.Server.Mumble;

public sealed class MumbleAclService : IMumbleAclService
{
    private readonly IMumbleAclIceClient _ice;
    private readonly ILogger<MumbleAclService> _logger;

    public MumbleAclService(IMumbleAclIceClient ice, ILogger<MumbleAclService> logger)
    {
        _ice = ice;
        _logger = logger;
    }

    public async Task<AclChannelSnapshotDto> GetChannelAclAsync(int channelId)
    {
        try
        {
            var result = await _ice.GetAclAsync(channelId);
            return AclMapper.FromIce(channelId, result, DateTimeOffset.UtcNow, stale: false, warning: null);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException)
        {
            _logger.LogWarning(ex, "Failed to fetch Mumble ACL for channel {ChannelId}", channelId);
            throw new MumbleAclException($"Failed to fetch ACL for channel {channelId}.", ex);
        }
    }

    public async Task SetChannelAclAsync(int channelId, AclUpdateRequest request)
    {
        try
        {
            var (acls, groups, inherit) = AclMapper.ToIce(request);
            await _ice.SetAclAsync(channelId, acls, groups, inherit);
        }
        catch (Exception ex) when (ex is not MumbleAclUnavailableException)
        {
            _logger.LogWarning(ex, "Failed to write Mumble ACL for channel {ChannelId}", channelId);
            throw new MumbleAclException($"Failed to write ACL for channel {channelId}.", ex);
        }
    }

    public Task AddUserToGroupAsync(int channelId, int sessionId, string group)
        => _ice.AddUserToGroupAsync(channelId, sessionId, group);

    public Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group)
        => _ice.RemoveUserFromGroupAsync(channelId, sessionId, group);

    public Task<bool> HasWritePermissionAsync(int sessionId, int channelId)
        => _ice.HasPermissionAsync(sessionId, channelId, MumbleServer.PermissionWrite.value);
}
```

- [ ] **Step 6: Register services and set proxy**

In `src/Brmble.Server/Mumble/MumbleExtensions.cs`, add registrations before `AddHostedService<MumbleIceService>()`:

```csharp
services.AddSingleton<MumbleAclIceClient>();
services.AddSingleton<IMumbleAclIceClient>(sp => sp.GetRequiredService<MumbleAclIceClient>());
services.AddSingleton<IMumbleAclService, MumbleAclService>();
```

In `src/Brmble.Server/Mumble/MumbleIceService.cs`, add a constructor parameter:

```csharp
MumbleAclIceClient aclIceClient,
```

Store it in a private field:

```csharp
private readonly MumbleAclIceClient _aclIceClient;
```

Assign it in the constructor:

```csharp
_aclIceClient = aclIceClient;
```

After `_registrationService.SetServerProxy(serverProxy);`, add:

```csharp
_aclIceClient.SetServerProxy(serverProxy);
```

- [ ] **Step 7: Run service tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MumbleAclServiceTests" -v normal`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Server/Mumble/IMumbleAclService.cs src/Brmble.Server/Mumble/MumbleAclIceClient.cs src/Brmble.Server/Mumble/MumbleAclService.cs src/Brmble.Server/Mumble/MumbleExtensions.cs src/Brmble.Server/Mumble/MumbleIceService.cs tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs
git commit -m "feat: wrap mumble ice acl operations"
```

---

### Task 3: Persist ACL Snapshots as a Non-Authoritative Cache

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs`
- Create: `src/Brmble.Server/Mumble/AclSnapshotRepository.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`
- Create: `tests/Brmble.Server.Tests/Mumble/AclSnapshotRepositoryTests.cs`

- [ ] **Step 1: Write failing repository tests**

```csharp
// tests/Brmble.Server.Tests/Mumble/AclSnapshotRepositoryTests.cs
using Brmble.Server.Data;
using Brmble.Server.Mumble;
using Microsoft.Data.Sqlite;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclSnapshotRepositoryTests
{
    private SqliteConnection _keepAlive = null!;
    private Database _db = null!;
    private AclSnapshotRepository _repo = null!;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "acl_snapshots_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        _repo = new AclSnapshotRepository(_db);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive.Dispose();

    [TestMethod]
    public async Task UpsertAndGetAsync_RoundTripsSnapshot()
    {
        var snapshot = new AclChannelSnapshotDto(
            ChannelId: 3,
            InheritAcls: true,
            Groups: [new AclGroupDto("admin", false, true, true, [1], [], [1])],
            Acls: [new AclRuleDto(true, true, false, null, "#secret", MumbleServer.PermissionEnter.value, 0)],
            FetchedAt: new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero),
            Stale: false,
            Warning: null);

        await _repo.UpsertAsync(snapshot);
        var loaded = await _repo.GetAsync(3);

        Assert.IsNotNull(loaded);
        Assert.AreEqual("#secret", loaded!.Acls[0].Group);
        Assert.IsFalse(string.IsNullOrWhiteSpace(loaded.SnapshotHash));
        Assert.IsFalse(loaded.Stale);
    }

    [TestMethod]
    public async Task MarkStaleAsync_PreservesPayloadAndStoresReason()
    {
        var snapshot = new AclChannelSnapshotDto(4, true, [], [], DateTimeOffset.UtcNow, false, null);
        await _repo.UpsertAsync(snapshot);

        await _repo.MarkStaleAsync(4, "refresh failed");
        var loaded = await _repo.GetAsync(4);

        Assert.IsNotNull(loaded);
        Assert.IsTrue(loaded!.Stale);
        Assert.AreEqual("refresh failed", loaded.Warning);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclSnapshotRepositoryTests" -v normal`

Expected: FAIL with `AclSnapshotRepository` not found or SQLite table missing.

- [ ] **Step 3: Add database migration**

In `src/Brmble.Server/Data/Database.cs`, add this SQL to the existing `conn.Execute("""...""")` block:

```sql
CREATE TABLE IF NOT EXISTS acl_snapshots (
    channel_id      INTEGER PRIMARY KEY,
    payload_json    TEXT NOT NULL,
    payload_hash    TEXT NOT NULL,
    fetched_at      TEXT NOT NULL,
    is_stale        INTEGER NOT NULL DEFAULT 0,
    stale_reason    TEXT
);
```

- [ ] **Step 4: Add snapshot repository**

```csharp
// src/Brmble.Server/Mumble/AclSnapshotRepository.cs
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Brmble.Server.Data;
using Dapper;

namespace Brmble.Server.Mumble;

public interface IAclSnapshotRepository
{
    Task UpsertAsync(AclChannelSnapshotDto snapshot);
    Task<AclChannelSnapshotDto?> GetAsync(int channelId);
    Task MarkStaleAsync(int channelId, string reason);
}

public static class AclSnapshotHasher
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Compute(AclChannelSnapshotDto snapshot)
    {
        var canonical = snapshot with
        {
            FetchedAt = DateTimeOffset.UnixEpoch,
            Stale = false,
            Warning = null,
            SnapshotHash = ""
        };
        var json = JsonSerializer.Serialize(canonical, JsonOptions);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }
}

public sealed class AclSnapshotRepository : IAclSnapshotRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Database _db;

    public AclSnapshotRepository(Database db)
    {
        _db = db;
    }

    public async Task UpsertAsync(AclChannelSnapshotDto snapshot)
    {
        var hash = AclSnapshotHasher.Compute(snapshot);
        var canonical = snapshot with { Stale = false, Warning = null, SnapshotHash = hash };
        var json = JsonSerializer.Serialize(canonical, JsonOptions);
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            """
            INSERT INTO acl_snapshots (channel_id, payload_json, payload_hash, fetched_at, is_stale, stale_reason)
            VALUES (@ChannelId, @PayloadJson, @PayloadHash, @FetchedAt, 0, NULL)
            ON CONFLICT(channel_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                payload_hash = excluded.payload_hash,
                fetched_at = excluded.fetched_at,
                is_stale = 0,
                stale_reason = NULL
            """,
            new
            {
                snapshot.ChannelId,
                PayloadJson = json,
                PayloadHash = hash,
                FetchedAt = snapshot.FetchedAt.UtcDateTime.ToString("O")
            });
    }

    public async Task<AclChannelSnapshotDto?> GetAsync(int channelId)
    {
        using var conn = _db.CreateConnection();
        var row = await conn.QuerySingleOrDefaultAsync<Row>(
            """
            SELECT channel_id AS ChannelId, payload_json AS PayloadJson, payload_hash AS PayloadHash, is_stale AS IsStale, stale_reason AS StaleReason
            FROM acl_snapshots
            WHERE channel_id = @ChannelId
            """,
            new { ChannelId = channelId });
        if (row is null)
            return null;

        var snapshot = JsonSerializer.Deserialize<AclChannelSnapshotDto>(row.PayloadJson, JsonOptions);
        return snapshot is null
            ? null
            : snapshot with { Stale = row.IsStale != 0, Warning = row.StaleReason, SnapshotHash = row.PayloadHash };
    }

    public async Task MarkStaleAsync(int channelId, string reason)
    {
        using var conn = _db.CreateConnection();
        await conn.ExecuteAsync(
            """
            UPDATE acl_snapshots
            SET is_stale = 1, stale_reason = @Reason
            WHERE channel_id = @ChannelId
            """,
            new { ChannelId = channelId, Reason = reason });
    }

    private sealed record Row(int ChannelId, string PayloadJson, string PayloadHash, int IsStale, string? StaleReason);
}
```

- [ ] **Step 5: Register repository**

In `src/Brmble.Server/Mumble/MumbleExtensions.cs`, add:

```csharp
services.AddSingleton<IAclSnapshotRepository, AclSnapshotRepository>();
```

- [ ] **Step 6: Run repository tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclSnapshotRepositoryTests" -v normal`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/Data/Database.cs src/Brmble.Server/Mumble/AclSnapshotRepository.cs src/Brmble.Server/Mumble/MumbleExtensions.cs tests/Brmble.Server.Tests/Mumble/AclSnapshotRepositoryTests.cs
git commit -m "feat: persist mumble acl snapshots"
```

---

### Task 4: Add Authorization and Sync Coordinator

**Files:**
- Create: `src/Brmble.Server/Mumble/AclAuthorizationService.cs`
- Create: `src/Brmble.Server/Mumble/AclEventDispatcher.cs`
- Create: `src/Brmble.Server/Mumble/AclSyncCoordinator.cs`
- Modify: `src/Brmble.Server/Events/IBrmbleEventBus.cs`
- Modify: `src/Brmble.Server/Events/BrmbleEventBus.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`
- Create: `tests/Brmble.Server.Tests/Mumble/AclEventDispatcherTests.cs`
- Create: `tests/Brmble.Server.Tests/Mumble/AclSyncCoordinatorTests.cs`

- [ ] **Step 1: Write failing coordinator tests**

```csharp
// tests/Brmble.Server.Tests/Mumble/AclSyncCoordinatorTests.cs
using Brmble.Server.Events;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class AclSyncCoordinatorTests
{
    [TestMethod]
    public async Task RefreshAsync_FetchesPersistsAndReturnsCanonicalSnapshot()
    {
        var service = new Mock<IMumbleAclService>();
        var repo = new Mock<IAclSnapshotRepository>();
        var dispatcher = new Mock<IAclEventDispatcher>();
        var snapshot = new AclChannelSnapshotDto(2, true, [], [], DateTimeOffset.UtcNow, false, null);
        service.Setup(s => s.GetChannelAclAsync(2)).ReturnsAsync(snapshot);
        repo.Setup(r => r.UpsertAsync(snapshot)).Returns(Task.CompletedTask);
        var coordinator = new AclSyncCoordinator(service.Object, repo.Object, dispatcher.Object, NullLogger<AclSyncCoordinator>.Instance);

        var result = await coordinator.RefreshAsync(2, broadcastWhenChanged: true);

        Assert.AreSame(snapshot, result);
        repo.Verify(r => r.UpsertAsync(snapshot), Times.Once);
        dispatcher.Verify(d => d.DispatchAclChangedAsync(2, snapshot), Times.Once);
    }

    [TestMethod]
    public async Task WriteAndRefreshAsync_WhenRefreshFailsMarksSnapshotStale()
    {
        var service = new Mock<IMumbleAclService>();
        var repo = new Mock<IAclSnapshotRepository>();
        var dispatcher = new Mock<IAclEventDispatcher>();
        var current = new AclChannelSnapshotDto(8, true, [], [], DateTimeOffset.UtcNow, false, null);
        var currentHash = AclSnapshotHasher.Compute(current);
        var request = new AclUpdateRequest(true, [], [], currentHash);
        service.Setup(s => s.SetChannelAclAsync(8, request)).Returns(Task.CompletedTask);
        service.SetupSequence(s => s.GetChannelAclAsync(8))
            .ReturnsAsync(current)
            .ThrowsAsync(new MumbleAclException("refresh failed"));
        repo.Setup(r => r.MarkStaleAsync(8, It.IsAny<string>())).Returns(Task.CompletedTask);
        var coordinator = new AclSyncCoordinator(service.Object, repo.Object, dispatcher.Object, NullLogger<AclSyncCoordinator>.Instance);

        var result = await coordinator.WriteAndRefreshAsync(8, request);

        Assert.IsFalse(result.Success);
        Assert.IsNotNull(result.Warning);
        repo.Verify(r => r.MarkStaleAsync(8, It.Is<string>(reason => reason.Contains("refresh failed"))), Times.Once);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclSyncCoordinatorTests" -v normal`

Expected: FAIL because coordinator and authorization service do not exist.

- [ ] **Step 3: Add authorization service**

```csharp
// src/Brmble.Server/Mumble/AclAuthorizationService.cs
using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public interface IAclAuthorizationService
{
    Task<bool> CanManageChannelAclAsync(long userId, int channelId);
}

public sealed class AclAuthorizationService : IAclAuthorizationService
{
    private readonly IMumbleAclService _aclService;
    private readonly ISessionMappingService _sessionMapping;

    public AclAuthorizationService(IMumbleAclService aclService, ISessionMappingService sessionMapping)
    {
        _aclService = aclService;
        _sessionMapping = sessionMapping;
    }

    public async Task<bool> CanManageChannelAclAsync(long userId, int channelId)
    {
        if (!_sessionMapping.TryGetSessionByUserId(userId, out var sessionId))
            return false;
        return await _aclService.HasWritePermissionAsync(sessionId, channelId);
    }
}
```

- [ ] **Step 4: Add targeted websocket broadcast support**

In `src/Brmble.Server/Events/IBrmbleEventBus.cs`, add:

```csharp
Task<IReadOnlySet<long>> GetConnectedUserIdsAsync();
Task BroadcastToUsersAsync(IReadOnlySet<long> userIds, object message);
```

In `src/Brmble.Server/Events/BrmbleEventBus.cs`, implement it with the same send/remove behavior as `BroadcastAsync`, but filter `_clients` by `userIds.Contains(kvp.Value)` before sending. Also add a lightweight way for ACL code to derive the currently connected Brmble user ids without exposing the raw `_clients` dictionary. Keep `BroadcastAsync` for existing non-sensitive events; ACL code must not use it.

- [ ] **Step 5: Add ACL event dispatcher**

```csharp
// src/Brmble.Server/Mumble/AclEventDispatcher.cs
using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public interface IAclEventDispatcher
{
    Task DispatchAclChangedAsync(int channelId, AclChannelSnapshotDto snapshot);
}

public sealed class AclEventDispatcher : IAclEventDispatcher
{
    private readonly IAclAuthorizationService _authorization;
    private readonly IBrmbleEventBus _eventBus;

    public AclEventDispatcher(
        IAclAuthorizationService authorization,
        IBrmbleEventBus eventBus)
    {
        _authorization = authorization;
        _eventBus = eventBus;
    }

    public async Task DispatchAclChangedAsync(int channelId, AclChannelSnapshotDto snapshot)
    {
        var connectedUserIds = await _eventBus.GetConnectedUserIdsAsync();
        if (connectedUserIds.Count == 0)
            return;

        var allowed = new HashSet<long>();
        foreach (var userId in connectedUserIds)
        {
            if (await _authorization.CanManageChannelAclAsync(userId, channelId))
                allowed.Add(userId);
        }

        if (allowed.Count == 0)
            return;

        await _eventBus.BroadcastToUsersAsync(
            allowed,
            new { type = "acl.changed", channelId, snapshot });
    }
}
```

- [ ] **Step 6: Add sync coordinator**

```csharp
// src/Brmble.Server/Mumble/AclSyncCoordinator.cs

namespace Brmble.Server.Mumble;

public interface IAclSyncCoordinator
{
    Task<AclChannelSnapshotDto> RefreshAsync(int channelId, bool broadcastWhenChanged);
    Task<AclWriteResult> WriteAndRefreshAsync(int channelId, AclUpdateRequest request);
    Task<AclWriteResult> AddUserToGroupAndRefreshAsync(int channelId, int sessionId, string group);
    Task<AclWriteResult> RemoveUserFromGroupAndRefreshAsync(int channelId, int sessionId, string group);
}

public sealed class AclSyncCoordinator : IAclSyncCoordinator
{
    private readonly IMumbleAclService _aclService;
    private readonly IAclSnapshotRepository _snapshots;
    private readonly IAclEventDispatcher _events;
    private readonly ILogger<AclSyncCoordinator> _logger;

    public AclSyncCoordinator(
        IMumbleAclService aclService,
        IAclSnapshotRepository snapshots,
        IAclEventDispatcher events,
        ILogger<AclSyncCoordinator> logger)
    {
        _aclService = aclService;
        _snapshots = snapshots;
        _events = events;
        _logger = logger;
    }

    public async Task<AclChannelSnapshotDto> RefreshAsync(int channelId, bool broadcastWhenChanged)
    {
        var snapshot = await _aclService.GetChannelAclAsync(channelId);
        snapshot = snapshot with { SnapshotHash = AclSnapshotHasher.Compute(snapshot) };
        await _snapshots.UpsertAsync(snapshot);
        if (broadcastWhenChanged)
            await _events.DispatchAclChangedAsync(channelId, snapshot);
        return snapshot;
    }

    public async Task<AclWriteResult> WriteAndRefreshAsync(int channelId, AclUpdateRequest request)
    {
        var current = await _aclService.GetChannelAclAsync(channelId);
        var currentHash = AclSnapshotHasher.Compute(current);
        if (!string.Equals(request.ExpectedSnapshotHash, currentHash, StringComparison.OrdinalIgnoreCase))
            return new AclWriteResult(false, current with { SnapshotHash = currentHash }, null, "ACL changed since it was opened.");

        await _aclService.SetChannelAclAsync(channelId, request);
        try
        {
            var snapshot = await RefreshAsync(channelId, broadcastWhenChanged: true);
            return new AclWriteResult(true, snapshot, null, null);
        }
        catch (Exception ex)
        {
            const string warning = "ACL change may have succeeded in Mumble, but Brmble could not refresh canonical ACL state.";
            _logger.LogWarning(ex, "ACL write for channel {ChannelId} succeeded before refresh failed", channelId);
            await _snapshots.MarkStaleAsync(channelId, warning);
            return new AclWriteResult(false, null, warning, ex.Message);
        }
    }

    public async Task<AclWriteResult> AddUserToGroupAndRefreshAsync(int channelId, int sessionId, string group)
    {
        try
        {
            await _aclService.AddUserToGroupAsync(channelId, sessionId, group);
            var snapshot = await RefreshAsync(channelId, broadcastWhenChanged: true);
            return new AclWriteResult(true, snapshot, null, null);
        }
        catch (Exception ex)
        {
            await _snapshots.MarkStaleAsync(channelId, "ACL group add may have succeeded, but refresh failed.");
            return new AclWriteResult(false, null, "ACL group add may have succeeded, but refresh failed.", ex.Message);
        }
    }

    public async Task<AclWriteResult> RemoveUserFromGroupAndRefreshAsync(int channelId, int sessionId, string group)
    {
        try
        {
            await _aclService.RemoveUserFromGroupAsync(channelId, sessionId, group);
            var snapshot = await RefreshAsync(channelId, broadcastWhenChanged: true);
            return new AclWriteResult(true, snapshot, null, null);
        }
        catch (Exception ex)
        {
            await _snapshots.MarkStaleAsync(channelId, "ACL group remove may have succeeded, but refresh failed.");
            return new AclWriteResult(false, null, "ACL group remove may have succeeded, but refresh failed.", ex.Message);
        }
    }
}
```

- [ ] **Step 7: Register services**

In `src/Brmble.Server/Mumble/MumbleExtensions.cs`, add:

```csharp
services.AddSingleton<IAclAuthorizationService, AclAuthorizationService>();
services.AddSingleton<IAclEventDispatcher, AclEventDispatcher>();
services.AddSingleton<IAclSyncCoordinator, AclSyncCoordinator>();
```

- [ ] **Step 8: Run coordinator and event dispatcher tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclSyncCoordinatorTests|FullyQualifiedName~AclEventDispatcherTests" -v normal`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Server/Events/IBrmbleEventBus.cs src/Brmble.Server/Events/BrmbleEventBus.cs src/Brmble.Server/Mumble/AclAuthorizationService.cs src/Brmble.Server/Mumble/AclEventDispatcher.cs src/Brmble.Server/Mumble/AclSyncCoordinator.cs src/Brmble.Server/Mumble/MumbleExtensions.cs tests/Brmble.Server.Tests/Mumble/AclEventDispatcherTests.cs tests/Brmble.Server.Tests/Mumble/AclSyncCoordinatorTests.cs
git commit -m "feat: coordinate acl refresh and broadcasts"
```

---

### Task 5: Add ACL Admin Endpoints

**Files:**
- Create: `src/Brmble.Server/Mumble/AclAdminEndpoints.cs`
- Create: `src/Brmble.Server/Mumble/AclValidationService.cs`
- Modify: `src/Brmble.Server/Program.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`
- Create: `tests/Brmble.Server.Tests/Mumble/AclValidationServiceTests.cs`
- Create: `tests/Brmble.Server.Tests/Integration/AclAdminEndpointTests.cs`

- [ ] **Step 1: Write failing endpoint tests**

```csharp
// tests/Brmble.Server.Tests/Integration/AclAdminEndpointTests.cs
using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Mumble;
using Microsoft.Extensions.DependencyInjection;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AclAdminEndpointTests
{
    [TestMethod]
    public async Task GetChannelAcl_Unauthenticated_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/acl/channels/4");

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task GetChannelAcl_WithoutMumbleWritePermission_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory("cert_acl_forbidden");
        await SeedUser(factory, "cert_acl_forbidden", "Alice");
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(It.IsAny<long>(), 4)).ReturnsAsync(false);
        var client = factory.CreateClient();

        var response = await client.GetAsync("/acl/channels/4");

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task PutChannelAcl_ReturnsRefreshedCanonicalSnapshot()
    {
        using var factory = new BrmbleServerFactory("cert_acl_admin");
        var user = await SeedUser(factory, "cert_acl_admin", "Admin");
        var snapshot = new AclChannelSnapshotDto(4, true, [], [], DateTimeOffset.UtcNow, false, null);
        factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 4)).ReturnsAsync(true);
        factory.AclCoordinatorMock.Setup(c => c.WriteAndRefreshAsync(4, It.IsAny<AclUpdateRequest>()))
            .ReturnsAsync(new AclWriteResult(true, snapshot, null, null));
        var client = factory.CreateClient();

        var response = await client.PutAsJsonAsync("/acl/channels/4", new AclUpdateRequest(true, [], [], "known-hash"));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<AclWriteResult>();
        Assert.IsTrue(result!.Success);
        Assert.AreEqual(4, result.Snapshot!.ChannelId);
    }

    private static async Task<User> SeedUser(BrmbleServerFactory factory, string certHash, string name)
    {
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<UserRepository>();
        return await repo.Insert(certHash, name);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclAdminEndpointTests" -v normal`

Expected: FAIL because endpoint mapping and test factory ACL mocks do not exist.

- [ ] **Step 3: Add ACL validation service**

```csharp
// src/Brmble.Server/Mumble/AclValidationService.cs
namespace Brmble.Server.Mumble;

public sealed class AclValidationService
{
    private const int KnownPermissionMask =
        MumbleServer.PermissionWrite.value |
        MumbleServer.PermissionTraverse.value |
        MumbleServer.PermissionEnter.value |
        MumbleServer.PermissionSpeak.value |
        MumbleServer.PermissionWhisper.value |
        MumbleServer.PermissionTextMessage.value |
        MumbleServer.PermissionMakeChannel.value |
        MumbleServer.PermissionLinkChannel.value |
        MumbleServer.PermissionMove.value |
        MumbleServer.PermissionKick.value |
        MumbleServer.PermissionBan.value |
        MumbleServer.PermissionRegister.value |
        MumbleServer.PermissionRegisterSelf.value |
        MumbleServer.PermissionMakeTempChannel.value |
        MumbleServer.PermissionMuteDeafen.value |
        MumbleServer.ResetUserContent.value;

    public (bool Valid, string? Error) ValidateUpdate(AclUpdateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.ExpectedSnapshotHash))
            return (false, "Expected snapshot hash is required.");

        foreach (var group in request.Groups)
        {
            if (group.Inherited)
                return (false, "Inherited groups cannot be submitted as local edits.");
            if (string.IsNullOrWhiteSpace(group.Name))
                return (false, "Group name cannot be empty.");
        }

        foreach (var rule in request.Acls)
        {
            if (rule.Inherited)
                return (false, "Inherited ACL rules cannot be submitted as local edits.");
            if (rule.UserId is null && string.IsNullOrWhiteSpace(rule.Group))
                return (false, "ACL rule must target a user id or selector.");
            if (rule.UserId is not null && !string.IsNullOrWhiteSpace(rule.Group))
                return (false, "ACL rule cannot target both a user id and selector.");
            if (((rule.Allow | rule.Deny) & ~KnownPermissionMask) != 0)
                return (false, "ACL rule contains unknown permission bits.");
        }

        return (true, null);
    }
}
```

- [ ] **Step 4: Add endpoints**

```csharp
// src/Brmble.Server/Mumble/AclAdminEndpoints.cs
using Brmble.Server.Auth;

namespace Brmble.Server.Mumble;

public static class AclAdminEndpoints
{
    public static IEndpointRouteBuilder MapAclAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/acl/channels/{channelId:int}");

        group.MapGet("", async (
            int channelId,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            IAclSnapshotRepository snapshots,
            IAclSyncCoordinator coordinator) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
                return auth.Result;

            var cached = await snapshots.GetAsync(channelId);
            var canonical = await coordinator.RefreshAsync(channelId, broadcastWhenChanged: cached is not null);
            return Results.Ok(new { snapshot = canonical, cached });
        });

        group.MapPut("", async (
            int channelId,
            AclUpdateRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            AclValidationService validation,
            IAclSyncCoordinator coordinator,
            ILoggerFactory loggerFactory) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
                return auth.Result;

            var valid = validation.ValidateUpdate(request);
            if (!valid.Valid)
                return Results.BadRequest(new { error = valid.Error });

            var result = await coordinator.WriteAndRefreshAsync(channelId, request);
            loggerFactory.CreateLogger("Brmble.Server.Mumble.AclAudit")
                .LogInformation("ACL setChannel actor={UserId} channel={ChannelId} success={Success}", auth.User!.Id, channelId, result.Success);
            if (result.Success)
                return Results.Ok(result);
            if (result.Error == "ACL changed since it was opened.")
                return Results.Conflict(result);
            return Results.Accepted(value: result);
        });

        group.MapPost("groups/add", async (
            int channelId,
            AclGroupMemberRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            IAclSyncCoordinator coordinator,
            ILoggerFactory loggerFactory) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
                return auth.Result;
            if (request.Session <= 0 || string.IsNullOrWhiteSpace(request.Group))
                return Results.BadRequest(new { error = "Session and group are required." });

            var result = await coordinator.AddUserToGroupAndRefreshAsync(channelId, request.Session, request.Group);
            loggerFactory.CreateLogger("Brmble.Server.Mumble.AclAudit")
                .LogInformation("ACL groupAdd actor={UserId} channel={ChannelId} targetSession={Session} success={Success}", auth.User!.Id, channelId, request.Session, result.Success);
            return result.Success ? Results.Ok(result) : Results.Accepted(value: result);
        });

        group.MapPost("groups/remove", async (
            int channelId,
            AclGroupMemberRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            IAclAuthorizationService authorization,
            IAclSyncCoordinator coordinator,
            ILoggerFactory loggerFactory) =>
        {
            var auth = await ResolveAuthorizedUser(httpContext, certHashExtractor, userRepo, authorization, channelId);
            if (auth.Result is not null)
                return auth.Result;
            if (request.Session <= 0 || string.IsNullOrWhiteSpace(request.Group))
                return Results.BadRequest(new { error = "Session and group are required." });

            var result = await coordinator.RemoveUserFromGroupAndRefreshAsync(channelId, request.Session, request.Group);
            loggerFactory.CreateLogger("Brmble.Server.Mumble.AclAudit")
                .LogInformation("ACL groupRemove actor={UserId} channel={ChannelId} targetSession={Session} success={Success}", auth.User!.Id, channelId, request.Session, result.Success);
            return result.Success ? Results.Ok(result) : Results.Accepted(value: result);
        });

        return app;
    }

    private static async Task<(User? User, IResult? Result)> ResolveAuthorizedUser(
        HttpContext httpContext,
        ICertificateHashExtractor certHashExtractor,
        UserRepository userRepo,
        IAclAuthorizationService authorization,
        int channelId)
    {
        var certHash = certHashExtractor.GetCertHash(httpContext);
        if (string.IsNullOrWhiteSpace(certHash))
            return (null, Results.Unauthorized());

        var user = await userRepo.GetByCertHash(certHash);
        if (user is null)
            return (null, Results.Unauthorized());

        if (!await authorization.CanManageChannelAclAsync(user.Id, channelId))
            return (null, Results.Forbid());

        return (user, null);
    }
}
```

- [ ] **Step 5: Register validation and map endpoints**

In `src/Brmble.Server/Mumble/MumbleExtensions.cs`, add:

```csharp
services.AddSingleton<AclValidationService>();
```

In `src/Brmble.Server/Program.cs`, add after `app.MapDmEndpoints();`:

```csharp
app.MapAclAdminEndpoints();
```

- [ ] **Step 6: Update test factory for ACL mocks**

In `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`, add public properties:

```csharp
public Mock<IAclAuthorizationService> AclAuthorizationMock { get; } = new();
public Mock<IAclSyncCoordinator> AclCoordinatorMock { get; } = new();
```

Replace the default registrations with these interface mocks in `ConfigureTestServices`. Do not mock sealed concrete ACL classes.

- [ ] **Step 7: Run endpoint and validation tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AclAdminEndpointTests|FullyQualifiedName~AclValidationServiceTests" -v normal`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Server/Mumble/AclAdminEndpoints.cs src/Brmble.Server/Mumble/AclValidationService.cs src/Brmble.Server/Mumble/MumbleExtensions.cs src/Brmble.Server/Program.cs tests/Brmble.Server.Tests/Mumble/AclValidationServiceTests.cs tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs tests/Brmble.Server.Tests/Integration/AclAdminEndpointTests.cs
git commit -m "feat: expose acl admin endpoints"
```

---

### Task 6: Add Desktop Bridge ACL Calls and WebSocket Forwarding

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Add failing parser/forwarding tests**

```csharp
// tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
// Add to existing MumbleAdapterParseTests class.

[TestMethod]
public void HandleWebSocketAclChanged_ForwardsToBridge()
{
    var bridge = new FakeBridge();
    var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://api.example.com");
    var json = """
        {
          "type": "acl.changed",
          "channelId": 4,
          "snapshot": {
            "channelId": 4,
            "inheritAcls": true,
            "groups": [],
            "acls": [],
            "fetchedAt": "2026-05-15T12:00:00Z",
            "stale": false,
            "warning": null
          }
        }
        """;

    MumbleAdapterTestHarness.InvokeHandleWebSocketMessage(adapter, json);

    Assert.IsTrue(bridge.Sent.Any(m => m.Type == "acl.changed"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "HandleWebSocketAclChanged" -v normal`

Expected: FAIL because `acl.changed` is not forwarded yet.

- [ ] **Step 3: Add bridge handlers**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, inside `RegisterHandlers`, add handlers with the same BouncyCastle TLS pattern used by `dm.getOrCreateRoom` and LiveKit:

```csharp
bridge.RegisterHandler("acl.getChannel", async data =>
{
    var channelId = data.TryGetProperty("channelId", out var cid) && cid.ValueKind == System.Text.Json.JsonValueKind.Number
        ? cid.GetInt32()
        : 0;
    if (channelId <= 0 || _apiUrl is null)
    {
        _bridge?.Send("acl.error", new { channelId, error = "Not connected or invalid channel" });
        _bridge?.NotifyUiThread();
        return;
    }

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null)
    {
        _bridge?.Send("acl.error", new { channelId, error = "No client certificate" });
        _bridge?.NotifyUiThread();
        return;
    }

    var uri = new Uri(new Uri(_apiUrl, UriKind.Absolute), $"acl/channels/{channelId}");
    var result = await GetViaBcTls(cert, uri);
    _bridge?.Send(result.Success ? "acl.channel" : "acl.error", new { channelId, body = result.Body, statusCode = result.StatusCode, error = result.Error });
    _bridge?.NotifyUiThread();
});

bridge.RegisterHandler("acl.setChannel", async data =>
{
    var channelId = data.TryGetProperty("channelId", out var cid) && cid.ValueKind == System.Text.Json.JsonValueKind.Number
        ? cid.GetInt32()
        : 0;
    if (channelId <= 0 || _apiUrl is null)
    {
        _bridge?.Send("acl.error", new { channelId, error = "Not connected or invalid channel" });
        _bridge?.NotifyUiThread();
        return;
    }

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null)
    {
        _bridge?.Send("acl.error", new { channelId, error = "No client certificate" });
        _bridge?.NotifyUiThread();
        return;
    }

    var requestJson = data.TryGetProperty("request", out var request)
        ? request.GetRawText()
        : "{\"inheritAcls\":true,\"groups\":[],\"acls\":[]}";
    var uri = new Uri(new Uri(_apiUrl, UriKind.Absolute), $"acl/channels/{channelId}");
    var result = await PutViaBcTls(cert, uri, requestJson);
    _bridge?.Send(result.Success ? "acl.writeResult" : "acl.error", new { channelId, body = result.Body, statusCode = result.StatusCode, error = result.Error });
    _bridge?.NotifyUiThread();
});
```

Also add `PutViaBcTls` by mirroring `PostViaBcTls` and changing the request line to `PUT`.

- [ ] **Step 4: Forward websocket ACL changes**

In `HandleWebSocketMessage`, add a case:

```csharp
case "acl.changed":
    _bridge?.Send("acl.changed", System.Text.Json.JsonSerializer.Deserialize<object>(json));
    _bridge?.NotifyUiThread();
    break;
```

- [ ] **Step 5: Run client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "HandleWebSocketAclChanged" -v normal`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "feat: bridge acl admin requests"
```

---

### Task 7: Add React ACL Hook and Editor UI

**Files:**
- Create: `src/Brmble.Web/src/types/acl.ts`
- Create: `src/Brmble.Web/src/hooks/useAclAdmin.ts`
- Create: `src/Brmble.Web/src/hooks/useAclAdmin.test.tsx`
- Create: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Create: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css`
- Create: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`

- [ ] **Step 1: Write failing hook test**

```typescript
// src/Brmble.Web/src/hooks/useAclAdmin.test.tsx
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAclAdmin } from './useAclAdmin';
import bridge from '../bridge';

vi.mock('../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('useAclAdmin', () => {
  it('requests channel ACL and stores bridge snapshot', () => {
    let channelHandler: ((data: unknown) => void) | undefined;
    vi.mocked(bridge.on).mockImplementation((type, handler) => {
      if (type === 'acl.channel') channelHandler = handler;
    });
    const { result } = renderHook(() => useAclAdmin(4));

    act(() => result.current.refresh());
    expect(bridge.send).toHaveBeenCalledWith('acl.getChannel', { channelId: 4 });

    act(() => channelHandler?.({
      channelId: 4,
      body: JSON.stringify({
        snapshot: {
          channelId: 4,
          inheritAcls: true,
          groups: [],
          acls: [],
          fetchedAt: '2026-05-15T12:00:00Z',
          stale: false,
          warning: null,
          snapshotHash: 'known-hash',
        },
      }),
    }));

    expect(result.current.snapshot?.channelId).toBe(4);
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run hook test to verify it fails**

Run: `npm run test -- src/hooks/useAclAdmin.test.tsx`

Expected: FAIL because `useAclAdmin` does not exist.

- [ ] **Step 3: Add frontend ACL types**

```typescript
// src/Brmble.Web/src/types/acl.ts
export interface AclChannelSnapshot {
  channelId: number;
  inheritAcls: boolean;
  groups: AclGroup[];
  acls: AclRule[];
  fetchedAt: string;
  stale: boolean;
  warning: string | null;
  snapshotHash: string;
}

export interface AclGroup {
  name: string;
  inherited: boolean;
  inherit: boolean;
  inheritable: boolean;
  add: number[];
  remove: number[];
  members: number[];
}

export interface AclRule {
  applyHere: boolean;
  applySubs: boolean;
  inherited: boolean;
  userId: number | null;
  group: string | null;
  allow: number;
  deny: number;
}

export interface AclUpdateRequest {
  inheritAcls: boolean;
  groups: AclGroup[];
  acls: AclRule[];
  expectedSnapshotHash: string;
}

export const Permission = {
  Write: 0x01,
  Traverse: 0x02,
  Enter: 0x04,
  Speak: 0x08,
  MuteDeafen: 0x10,
  Move: 0x20,
  MakeChannel: 0x40,
  LinkChannel: 0x80,
  Whisper: 0x100,
  TextMessage: 0x200,
  MakeTempChannel: 0x400,
  Kick: 0x10000,
  Ban: 0x20000,
  Register: 0x40000,
  RegisterSelf: 0x80000,
  ResetUserContent: 0x100000,
} as const;
```

- [ ] **Step 4: Add bridge-backed hook**

```typescript
// src/Brmble.Web/src/hooks/useAclAdmin.ts
import { useEffect, useState } from 'react';
import bridge from '../bridge';
import type { AclChannelSnapshot, AclUpdateRequest } from '../types/acl';

interface BridgeResponse {
  channelId?: number;
  body?: string;
  error?: string;
  statusCode?: number;
  snapshot?: AclChannelSnapshot;
}

export function useAclAdmin(channelId: number | null) {
  const [snapshot, setSnapshot] = useState<AclChannelSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleChannel = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId || !payload.body) return;
      const parsed = JSON.parse(payload.body) as { snapshot: AclChannelSnapshot };
      setSnapshot(parsed.snapshot);
      setLoading(false);
      setError(null);
    };
    const handleChanged = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId || !payload.snapshot) return;
      setSnapshot(payload.snapshot);
      setError(null);
    };
    const handleError = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId) return;
      setError(payload.error ?? `ACL request failed with status ${payload.statusCode ?? 'unknown'}`);
      setLoading(false);
      setSaving(false);
    };
    const handleWriteResult = (data: unknown) => {
      const payload = data as BridgeResponse;
      if (payload.channelId !== channelId || !payload.body) return;
      const parsed = JSON.parse(payload.body) as { snapshot?: AclChannelSnapshot; warning?: string };
      if (parsed.snapshot) setSnapshot(parsed.snapshot);
      setError(parsed.warning ?? null);
      setSaving(false);
    };

    bridge.on('acl.channel', handleChannel);
    bridge.on('acl.changed', handleChanged);
    bridge.on('acl.error', handleError);
    bridge.on('acl.writeResult', handleWriteResult);
    return () => {
      bridge.off('acl.channel', handleChannel);
      bridge.off('acl.changed', handleChanged);
      bridge.off('acl.error', handleError);
      bridge.off('acl.writeResult', handleWriteResult);
    };
  }, [channelId]);

  const refresh = () => {
    if (channelId == null) return;
    setLoading(true);
    setError(null);
    bridge.send('acl.getChannel', { channelId });
  };

  const save = (request: Omit<AclUpdateRequest, 'expectedSnapshotHash'>) => {
    if (channelId == null || !snapshot?.snapshotHash) return;
    setSaving(true);
    setError(null);
    bridge.send('acl.setChannel', {
      channelId,
      request: {
        ...request,
        groups: request.groups.filter(group => !group.inherited),
        acls: request.acls.filter(rule => !rule.inherited),
        expectedSnapshotHash: snapshot.snapshotHash,
      },
    });
  };

  return { snapshot, loading, saving, error, refresh, save };
}
```

- [ ] **Step 5: Add editor component**

Create `AclEditorDialog.tsx` with a first complete editor slice: inheritance toggle, ordered rules table, token selector editing, allow/deny numeric masks, and save from canonical/draft state.

```tsx
// src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx
import { useEffect, useState } from 'react';
import type { AclRule, AclUpdateRequest } from '../../types/acl';
import { Permission } from '../../types/acl';
import { useAclAdmin } from '../../hooks/useAclAdmin';
import './AclEditorDialog.css';

type AclDraft = Omit<AclUpdateRequest, 'expectedSnapshotHash'>;

interface AclEditorDialogProps {
  channelId: number;
  channelName: string;
  isOpen: boolean;
  onClose: () => void;
}

const permissionRows = [
  ['Enter', Permission.Enter],
  ['Traverse', Permission.Traverse],
  ['Speak', Permission.Speak],
  ['Text', Permission.TextMessage],
  ['Write', Permission.Write],
] as const;

export function AclEditorDialog({ channelId, channelName, isOpen, onClose }: AclEditorDialogProps) {
  const { snapshot, loading, saving, error, refresh, save } = useAclAdmin(isOpen ? channelId : null);
  const [draft, setDraft] = useState<AclDraft | null>(null);

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, channelId]);

  useEffect(() => {
    if (!snapshot) return;
    setDraft({
      inheritAcls: snapshot.inheritAcls,
      groups: snapshot.groups,
      acls: snapshot.acls,
    });
  }, [snapshot]);

  if (!isOpen) return null;

  const addTokenRule = () => {
    setDraft(current => {
      const base = current ?? { inheritAcls: true, groups: [], acls: [] };
      const rule: AclRule = {
        applyHere: true,
        applySubs: false,
        inherited: false,
        userId: null,
        group: '#token',
        allow: Permission.Enter | Permission.Traverse,
        deny: 0,
      };
      return { ...base, acls: [...base.acls, rule] };
    });
  };

  const updateRule = (index: number, patch: Partial<AclRule>) => {
    setDraft(current => {
      if (!current) return current;
      const acls = current.acls.map((rule, i) => i === index ? { ...rule, ...patch } : rule);
      return { ...current, acls };
    });
  };

  const localRules = draft?.acls.filter(rule => !rule.inherited) ?? [];
  const inheritedRules = draft?.acls.filter(rule => rule.inherited) ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="acl-editor glass-panel animate-slide-up" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="acl-editor-header">
          <div>
            <h2 className="heading-title">Permissions for {channelName}</h2>
            <p>Rules are saved to Mumble, then refreshed from canonical server state.</p>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        {loading && <div className="acl-banner">Loading ACL state...</div>}
        {error && <div className="acl-banner acl-banner-warning">{error}</div>}
        {snapshot?.stale && <div className="acl-banner acl-banner-warning">Cached ACL state is stale. Refresh before editing.</div>}

        {draft && (
          <>
            <label className="acl-toggle">
              <input
                type="checkbox"
                checked={draft.inheritAcls}
                onChange={e => setDraft({ ...draft, inheritAcls: e.target.checked })}
              />
              Inherit ACLs from parent channel
            </label>

            <div className="acl-toolbar">
              <button className="btn btn-secondary" type="button" onClick={addTokenRule}>Add Token Rule</button>
              <button className="btn btn-secondary" type="button" onClick={refresh} disabled={loading || saving}>Refresh</button>
            </div>

            <div className="acl-rule-list">
              {localRules.map((rule, index) => (
                <div className="acl-rule-row" key={`${rule.group ?? rule.userId}-${index}`}>
                  <input
                    className="brmble-input"
                    value={rule.userId == null ? rule.group ?? '' : String(rule.userId)}
                    onChange={e => updateRule(index, { group: e.target.value, userId: null })}
                    aria-label="Selector"
                  />
                  <label><input type="checkbox" checked={rule.applyHere} onChange={e => updateRule(index, { applyHere: e.target.checked })} /> Here</label>
                  <label><input type="checkbox" checked={rule.applySubs} onChange={e => updateRule(index, { applySubs: e.target.checked })} /> Subs</label>
                  <div className="acl-permissions">
                    {permissionRows.map(([label, bit]) => (
                      <label key={label}>
                        <input
                          type="checkbox"
                          checked={(rule.allow & bit) !== 0}
                          onChange={e => updateRule(index, { allow: e.target.checked ? rule.allow | bit : rule.allow & ~bit })}
                        />
                        Allow {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {inheritedRules.length > 0 && (
              <details className="acl-inherited">
                <summary>{inheritedRules.length} inherited rules</summary>
                {inheritedRules.map((rule, index) => (
                  <div className="acl-rule-row inherited" key={`inherited-${index}`}>
                    <span>{rule.group ?? `User ${rule.userId}`}</span>
                    <span>allow {rule.allow}</span>
                    <span>deny {rule.deny}</span>
                  </div>
                ))}
              </details>
            )}
          </>
        )}

        <div className="acl-editor-footer">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" disabled={!draft || saving || snapshot?.stale} onClick={() => draft && save(draft)}>
            {saving ? 'Saving...' : 'Save ACLs'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add focused styles**

```css
/* src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css */
.acl-editor {
  width: min(920px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 32px));
  overflow: auto;
  padding: var(--space-lg);
}

.acl-editor-header,
.acl-editor-footer,
.acl-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.acl-editor-header p {
  margin: var(--space-2xs) 0 0;
  color: var(--text-muted);
}

.acl-banner {
  margin: var(--space-md) 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: var(--bg-overlay);
  color: var(--text-secondary);
}

.acl-banner-warning {
  color: var(--accent-danger);
}

.acl-toggle {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  margin: var(--space-md) 0;
}

.acl-rule-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: var(--space-md) 0;
}

.acl-rule-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) auto auto minmax(260px, 2fr);
  gap: var(--space-sm);
  align-items: start;
  padding: var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.acl-rule-row.inherited {
  opacity: 0.72;
}

.acl-permissions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-sm);
}

.acl-inherited {
  margin-top: var(--space-md);
  color: var(--text-muted);
}
```

- [ ] **Step 7: Add component test**

```tsx
// src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AclEditorDialog } from './AclEditorDialog';

const refresh = vi.fn();
const save = vi.fn();

vi.mock('../../hooks/useAclAdmin', () => ({
  useAclAdmin: () => ({
    snapshot: {
      channelId: 4,
      inheritAcls: true,
      groups: [],
      acls: [],
      fetchedAt: '2026-05-15T12:00:00Z',
      stale: false,
      warning: null,
      snapshotHash: 'known-hash',
    },
    loading: false,
    saving: false,
    error: null,
    refresh,
    save,
  }),
}));

describe('AclEditorDialog', () => {
  it('adds a token rule draft', async () => {
    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Add Token Rule'));

    expect(await screen.findByDisplayValue('#token')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run web tests**

Run: `npm run test -- src/hooks/useAclAdmin.test.tsx src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Web/src/types/acl.ts src/Brmble.Web/src/hooks/useAclAdmin.ts src/Brmble.Web/src/hooks/useAclAdmin.test.tsx src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx
git commit -m "feat: add acl editor foundation"
```

---

### Task 8: Integrate ACL Editor in Channel Tree

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Write failing UI integration tests**

```tsx
// src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
// Add to existing test file.

it('shows Edit Permissions for editable channel context menu', () => {
  usePermissionsMock.mockReturnValue({
    hasPermission: vi.fn((channelId: number, permission: number) => channelId === 5 && permission === 0x01),
    Permission: { Write: 0x01, MakeChannel: 0x40, Move: 0x20, Kick: 0x10000, Ban: 0x20000, MuteDeafen: 0x10 },
    requestPermissions: vi.fn(),
  });

  render(<ChannelTree channels={[{ id: 5, name: 'Secret', parent: 0 }]} users={[]} currentChannelId={5} connected />);
  fireEvent.contextMenu(screen.getByText('Secret'));

  expect(screen.getByText('Edit Permissions')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx`

Expected: FAIL because the menu item and editor are not integrated.

- [ ] **Step 3: Add ACL editor state and menu item**

In `ChannelTree.tsx`, import the editor:

```tsx
import { AclEditorDialog } from '../AclEditor/AclEditorDialog';
```

Add state near `editChannelDialog`:

```tsx
const [aclEditorChannel, setAclEditorChannel] = useState<{ id: number; name: string } | null>(null);
```

In the channel context menu builder, add:

```tsx
if (hasPermission(channelContextMenu.channelId, Permission.Write)) {
  adminItems.push({
    type: 'item' as const,
    label: 'Edit Permissions',
    onClick: () => {
      const channel = channels.find(c => c.id === channelContextMenu.channelId);
      setAclEditorChannel({ id: channelContextMenu.channelId, name: channel?.name ?? 'Channel' });
    },
  });
}
```

Render the dialog near the other channel dialogs:

```tsx
{aclEditorChannel && (
  <AclEditorDialog
    isOpen={true}
    channelId={aclEditorChannel.id}
    channelName={aclEditorChannel.name}
    onClose={() => setAclEditorChannel(null)}
  />
)}
```

- [ ] **Step 4: Run channel tree integration tests**

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
git commit -m "feat: integrate channel acl editor"
```

---

### Task 9: Add Safe Channel Password Token Helper

**Files:**
- Modify: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx`
- Modify: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.css`
- Modify: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.test.tsx`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Write failing password-token tests**

Add a client test that starts from an ACL snapshot containing three token selectors: `#old-secret`, `#vip`, and `#event`, plus a Brmble-owned marker rule that identifies `#old-secret` as the current channel-password token. Invoke `acl.setChannelPassword` with `password = "new-secret"` and assert the outgoing `PUT /acl/channels/{channelId}` body removes or replaces only the previously marked password token rule, preserves `#vip` and `#event`, writes a selector for `#new-secret`, and includes the original `expectedSnapshotHash`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SetChannelPassword" -v normal`

Expected: FAIL because `acl.setChannelPassword` is not implemented.

- [ ] **Step 3: Replace password placeholder with ACL-backed token field**

In `EditChannelDialog.tsx`, extend props:

```tsx
initialPassword?: string;
onSave: (name: string, description: string, password: string) => void;
```

Add state:

```tsx
const [password, setPassword] = useState(initialPassword);
```

Reset it in the existing `useEffect`:

```tsx
setPassword(initialPassword);
```

Change submit:

```tsx
onSave(name, description, password);
```

Replace the password placeholder block with:

```tsx
<div className="form-group">
  <label htmlFor="channel-password">Password Token</label>
  <input
    id="channel-password"
    className="brmble-input"
    type="password"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    placeholder="Empty means no password token rule"
  />
  <p className="edit-channel-hint">
    Saving a password creates or updates Brmble's managed native Mumble token selector rule. Other token rules are left unchanged.
  </p>
</div>
```

Update `ChannelTree.tsx` call sites to pass the third `password` argument through a new bridge event:

```tsx
bridge.send('acl.setChannelPassword', {
  channelId: editChannelDialog!.id,
  password,
});
```

Implement `acl.setChannelPassword` in `MumbleAdapter` as a thin client-side composition:

1. Request current ACL with `GET /acl/channels/{channelId}`.
2. Parse `snapshot` and keep `snapshot.snapshotHash`.
3. Identify Brmble's currently managed password token by looking for a Brmble-owned marker rule that points at exactly one local, non-inherited token selector rule.
4. Remove or replace only that previously marked password token rule. Preserve every other token selector, including unrelated `#vip`, `#staff`, and `#event` rules.
5. If the password is non-empty, add a local rule with `group = $"#{password}"` granting `Enter | Traverse`, and add or update the Brmble-owned marker rule so future edits can identify the managed token without touching unrelated native `#...` rules.
6. Save the whole `AclUpdateRequest` with `expectedSnapshotHash = snapshot.snapshotHash` using `PUT /acl/channels/{channelId}`.

This keeps password management on the native ACL path and avoids a second Brmble-only password system while still preserving the user-supplied token value. The Brmble-owned marker must be a distinct rule Brmble can identify deterministically without overloading the token value itself or requiring a separate SQLite source of truth. The UI label must describe this as a token-backed channel password, not a hidden or hashed secret.

- [ ] **Step 4: Run password-token and integration UI tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SetChannelPassword" -v normal`

Expected: PASS.

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx src/components/EditChannelDialog/EditChannelDialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.css src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.test.tsx src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "feat: add safe channel password token helper"
```

---

### Task 10: Full Verification

**Files:**
- All files touched by Tasks 1-9.

- [ ] **Step 1: Run server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v normal`

Expected: PASS.

- [ ] **Step 2: Run client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v normal`

Expected: PASS.

- [ ] **Step 3: Run web tests**

Run: `npm run test -- src/hooks/useAclAdmin.test.tsx src/components/AclEditor/AclEditorDialog.test.tsx src/components/Sidebar/ChannelTree.test.tsx src/components/EditChannelDialog/EditChannelDialog.test.tsx`

Expected: PASS.

- [ ] **Step 4: Build web**

Run: `npm run build`

Expected: TypeScript build and Vite build succeed.

- [ ] **Step 5: Build .NET solution**

Run: `dotnet build`

Expected: Build succeeds.

- [ ] **Step 6: Manual validation**

1. Start Brmble server and connect to a Mumble server with ICE enabled.
2. Connect as a registered user who has Mumble `Write` permission on a test channel.
3. Open the channel context menu and choose `Edit Permissions`.
4. Verify inherited ACLs render but cannot be edited.
5. Add a `#test-token` rule with `Enter` and `Traverse`, save, and verify the UI updates from refreshed canonical state.
6. Open native Mumble, verify the ACL appears on the same channel with the same order and flags.
7. Change the ACL in native Mumble, reopen the Brmble ACL editor, and verify Brmble replaces stale data with canonical state.
8. Use the channel password-token helper and verify it only modifies the Brmble-managed `#brmble-password` rule while preserving other `#...` token rules.
9. Remove Mumble ICE availability, open ACL editor, and verify editing is unavailable with a clear error.
10. Try the endpoint as a connected user without `Write` permission and verify `403 Forbidden`.

- [ ] **Step 7: Final commit**

```bash
git status --short
git add src tests docs
git commit -m "feat: add native mumble acl administration"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Server-side ACL service fetches and writes Mumble canonical state through ICE.
- [x] DTOs preserve native Mumble concepts: channel groups, inherited rules, rule order, user selectors, group/token selectors, allow/deny masks, `applyHere`, and `applySubs`.
- [x] Snapshots are persisted as non-authoritative cache only.
- [x] Every write refreshes canonical state from Mumble before UI success.
- [x] Refresh failure after write marks snapshot stale and returns warning state.
- [x] ACL broadcasts use targeted `IBrmbleEventBus.BroadcastToUsersAsync` through `AclEventDispatcher`; full snapshots are never sent through global broadcast.
- [x] Write requests carry `expectedSnapshotHash` and stale drafts return conflict instead of overwriting newer Mumble ACL state.
- [x] Server-side validation rejects inherited edits, empty selectors/groups, conflicting user/group targets, and unknown permission bits.
- [x] Out-of-band edits are handled by refresh on screen open.
- [x] Runtime permission enforcement remains Mumble-owned; server authorization checks Mumble `PermissionWrite`, and UI permissions remain separate from ACL editor state.
- [x] Channel password support uses a single Brmble-managed native token selector rule and preserves unrelated native token rules.

**Placeholder scan:**
- [x] No placeholder marker entries.
- [x] No empty "write tests" steps.
- [x] Each task includes concrete test commands and expected outcomes.
- [x] Known implementation choices with tradeoffs are called out explicitly.

**Type consistency:**
- [x] `AclChannelSnapshotDto` maps to `AclChannelSnapshot`.
- [x] `AclUpdateRequest` maps to frontend `AclUpdateRequest`.
- [x] Server event type `acl.changed` maps to bridge event `acl.changed`.
- [x] Token selectors are carried in ICE DTOs as raw group selector strings like `#secret`, while documentation names native UI syntax as `@#secret`.

**Risk notes for implementers:**
- Keep Mumble as the only authority. Do not add local join allow/deny checks from snapshots.
- Do not write inherited ACL rules or inherited groups back to Mumble as local rules.
- Do not rely on browser `fetch()` for ACL admin calls because mTLS and self-signed server TLS are already solved in `MumbleAdapter` through BouncyCastle helpers.
- Do not log token selector values. Log actor, channel id, operation, and result with selector values redacted.
- Do not mock sealed concrete ACL services. Mock `IAclSnapshotRepository`, `IAclAuthorizationService`, `IAclEventDispatcher`, and `IAclSyncCoordinator`.
