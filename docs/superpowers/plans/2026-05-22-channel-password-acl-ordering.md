# Channel Password ACL Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin-managed channel passwords write exactly three ordered managed ACLs: `@all` deny, `#password` allow, marker rule.

**Architecture:** Keep the behavior inside `MumbleAdapter.BuildSetChannelPasswordRequestBody`, which already owns the ACL rewrite for admin password changes. Tests in `MumbleAdapterParseTests` verify ordering, deny mask, changing, and clearing behavior without touching live Mumble.

**Tech Stack:** C#/.NET 10 MSTest for native client ACL request construction.

---

### Task 1: Add Failing Tests For Three-Rule Password Blocks

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Write failing tests**

Add tests around `BuildSetChannelPasswordRequestBody` that assert:

```csharp
// Expected ordered groups after setting password on an open channel:
// 1. "all" with deny mask Traverse | Enter | Speak | Whisper | TextMessage | MakeTempChannel | Listen
// 2. "#new-secret" with allow mask Traverse | Enter
// 3. "__brmble_password_marker__:#new-secret" with allow=0 deny=0
```

Also add tests that clearing removes all three managed rules and changing replaces the old trio with the new trio.

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SetChannelPassword_BuildRequest" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: at least one new test fails because the current implementation writes `deny=6` and adds `__brmble_password_open_block__`.

### Task 2: Update ACL Rewrite Logic

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1: Replace managed open-block model**

Update the helper logic so managed password removal finds the marker rule, its matching `#password` rule before it, and the adjacent preceding managed `all` deny rule. Remove all three together. Also remove legacy `__brmble_password_open_block__` rules when encountered.

- [ ] **Step 2: Add new managed deny mask**

Use this deny mask for the managed `all` rule:

```csharp
private const int ManagedPasswordAllDenyMask =
    0x02 | // Traverse
    0x04 | // Enter
    0x08 | // Speak
    0x100 | // Whisper
    0x200 | // Text message
    0x400 | // Make temporary channel
    0x800; // Listen
```

- [ ] **Step 3: Add rules in required order**

When a non-blank password is supplied, append exactly:

```csharp
all deny rule
token allow rule
marker rule
```

Do not add `__brmble_password_open_block__` for new writes.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SetChannelPassword_BuildRequest|TryGetManagedChannelPassword" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: all filtered tests pass.

### Task 3: Verify And Commit

**Files:**
- Modified files from Tasks 1 and 2

- [ ] **Step 1: Run native focused verification**

Run:

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SetChannelPassword_BuildRequest|TryGetManagedChannelPassword" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: pass with zero failures.

- [ ] **Step 2: Run client build verification**

Run:

```powershell
dotnet build src/Brmble.Client/Brmble.Client.csproj -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: build succeeds with zero errors.

- [ ] **Step 3: Commit relevant files only**

Run:

```powershell
git add -- "src/Brmble.Client/Services/Voice/MumbleAdapter.cs" "tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs" "docs/superpowers/plans/2026-05-22-channel-password-acl-ordering.md"
git commit -m "fix: order channel password acl block"
```

Expected: commit created on `feature/channel-password-context-menu`; unrelated untracked files remain untouched.

---

## Self-Review

- Spec coverage: covers adding, changing, clearing, ordering, deny-mask semantics, and legacy open-block cleanup.
- Placeholder scan: no placeholder steps remain.
- Type consistency: uses existing `BuildSetChannelPasswordRequestBody` and existing MSTest file names.
