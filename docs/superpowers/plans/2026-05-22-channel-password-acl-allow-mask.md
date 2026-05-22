# Channel Password ACL Allow Mask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin-managed `#password` ACL allow the same permissions shown in Mumble's password ACL reference screenshot.

**Architecture:** Keep the three-rule password ACL block from the previous change. Only update the password token allow mask and managed-token recognition in `MumbleAdapter.BuildSetChannelPasswordRequestBody`.

**Tech Stack:** C#/.NET 10 MSTest for native client ACL request construction.

---

### Task 1: Test Password Token Allow Mask

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Write failing assertions**

Update `SetChannelPassword_BuildRequest_AddsExactlyOrderedPasswordAclBlock` so the `#new-secret` rule expects:

```csharp
0x02 | 0x04 | 0x08 | 0x100 | 0x200 | 0x800
```

This covers Traverse, Enter, Speak, Whisper, Text message, and Listen.

- [ ] **Step 2: Add compatibility test**

Add a test where the old managed token has `allow=6` and changing the password still removes the old token/marker/all block and writes the new allow mask.

- [ ] **Step 3: Run test to verify failure**

Run:

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SetChannelPassword_BuildRequest" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: failure because current token allow mask is only `0x04 | 0x02`.

### Task 2: Update Token Mask Implementation

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1: Split old and new token masks**

Change constants to keep legacy recognition while writing the new mask:

```csharp
private const int LegacyManagedPasswordTokenAllowMask = 0x04 | 0x02;
private const int ManagedPasswordTokenAllowMask = 0x02 | 0x04 | 0x08 | 0x100 | 0x200 | 0x800;
```

- [ ] **Step 2: Recognize both masks**

Update `IsManagedPasswordTokenRule` to accept `allow == ManagedPasswordTokenAllowMask || allow == LegacyManagedPasswordTokenAllowMask`.

- [ ] **Step 3: Keep new writes using only the new mask**

Leave token creation using `allow = ManagedPasswordTokenAllowMask`.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SetChannelPassword_BuildRequest|TryGetManagedChannelPassword" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: all filtered tests pass.

### Task 3: Verify And Commit

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`
- Create: `docs/superpowers/plans/2026-05-22-channel-password-acl-allow-mask.md`

- [ ] **Step 1: Build client**

Run:

```powershell
dotnet build src/Brmble.Client/Brmble.Client.csproj -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: build succeeds with zero errors.

- [ ] **Step 2: Commit relevant files only**

Run:

```powershell
git add -- "src/Brmble.Client/Services/Voice/MumbleAdapter.cs" "tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs" "docs/superpowers/plans/2026-05-22-channel-password-acl-allow-mask.md"
git commit -m "fix: expand channel password acl allows"
```

Expected: commit created on `feature/channel-password-context-menu`; unrelated untracked files remain untouched.

---

## Self-Review

- Spec coverage: covers the screenshot allow permissions, keeps three-rule ordering, and preserves old-mask removal compatibility.
- Placeholder scan: no placeholder steps remain.
- Type consistency: uses existing test and implementation method names.
