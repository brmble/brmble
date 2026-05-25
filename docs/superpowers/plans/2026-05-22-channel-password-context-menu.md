# Channel Saved Password Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save per-channel Mumble access-token passwords locally so protected channels can be entered after reconnect without retyping.

**Architecture:** Store saved channel passwords in native app config, encrypted with the existing secure password storage service. The frontend manages a password-protected channel context-menu action through new bridge handlers; native connection sends the unique decrypted saved token values through `Authenticate.tokens` while leaving admin ACL password editing in `Edit Permissions`.

**Tech Stack:** C#/.NET, MSTest, MumbleSharp protocol models, raw Win32/WebView2 bridge, React, TypeScript, Vitest, Testing Library.

---

## File Structure

- Modify `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs` to expose saved channel password methods.
- Modify `src/Brmble.Client/Services/AppConfig/AppConfigService.cs` to store, encrypt, decrypt, list, and remove saved channel passwords.
- Modify `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` to register bridge handlers and pass saved tokens into `MumbleConnection.Connect`.
- Modify `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs` for encrypted storage and duplicate-token behavior.
- Modify `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs` or `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs` for authenticate-token behavior and bridge handler routing.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` to replace the admin ACL `Edit Password` item with user-facing `Edit Saved Password`.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx` to assert context-menu visibility and new bridge calls.
- No new CSS or custom UI components are needed; use the existing shared prompt.

### Task 1: Add App Config Saved Channel Password Model

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`
- Test: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

- [ ] **Step 1: Write failing app config tests**

Add these tests near the other persistence tests in `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`:

```csharp
[TestMethod]
public void SavesAndReloads_ChannelPasswordTokensEncryptedAtRest()
{
    var svc = new AppConfigService(_tempDir, null);

    svc.SaveChannelPassword("server-1", 5, "Secret", "secret-token");
    var rawJson = File.ReadAllText(Path.Combine(_tempDir, "config.json"));
    var svc2 = new AppConfigService(_tempDir, null);

    Assert.IsFalse(rawJson.Contains("secret-token"));
    var saved = svc2.GetChannelPasswords("server-1");
    Assert.AreEqual(1, saved.Count);
    Assert.AreEqual("server-1", saved[0].ServerKey);
    Assert.AreEqual(5u, saved[0].ChannelId);
    Assert.AreEqual("Secret", saved[0].ChannelName);
    Assert.AreEqual("secret-token", saved[0].Password);
}

[TestMethod]
public void SaveChannelPassword_ReplacesExistingChannelPassword()
{
    var svc = new AppConfigService(_tempDir, null);

    svc.SaveChannelPassword("server-1", 5, "Secret", "old-token");
    svc.SaveChannelPassword("server-1", 5, "Renamed Secret", "new-token");

    var saved = svc.GetChannelPasswords("server-1");
    Assert.AreEqual(1, saved.Count);
    Assert.AreEqual("Renamed Secret", saved[0].ChannelName);
    Assert.AreEqual("new-token", saved[0].Password);
}

[TestMethod]
public void RemoveChannelPassword_RemovesOnlyMatchingServerAndChannel()
{
    var svc = new AppConfigService(_tempDir, null);
    svc.SaveChannelPassword("server-1", 5, "Secret", "secret-token");
    svc.SaveChannelPassword("server-1", 6, "Other", "other-token");
    svc.SaveChannelPassword("server-2", 5, "Remote", "remote-token");

    svc.RemoveChannelPassword("server-1", 5);

    CollectionAssert.AreEqual(new[] { "other-token" }, svc.GetChannelAccessTokens("server-1").ToArray());
    CollectionAssert.AreEqual(new[] { "remote-token" }, svc.GetChannelAccessTokens("server-2").ToArray());
}

[TestMethod]
public void GetChannelAccessTokens_DeduplicatesAndSkipsBlankTokens()
{
    var svc = new AppConfigService(_tempDir, null);
    svc.SaveChannelPassword("server-1", 5, "Secret", "same-token");
    svc.SaveChannelPassword("server-1", 6, "Other", "same-token");
    svc.SaveChannelPassword("server-1", 7, "Blank", " ");

    var tokens = svc.GetChannelAccessTokens("server-1");

    CollectionAssert.AreEqual(new[] { "same-token" }, tokens.ToArray());
}
```

- [ ] **Step 2: Run the app config tests and verify they fail**

Run:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter AppConfigServiceTests
```

Expected: compile failure because `SaveChannelPassword`, `GetChannelPasswords`, `RemoveChannelPassword`, `GetChannelAccessTokens`, and the saved password record do not exist.

- [ ] **Step 3: Add interface members and public record**

In `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`, add the record after `RegistrationInfo` and add methods to the interface:

```csharp
public record SavedChannelPassword(string ServerKey, uint ChannelId, string ChannelName, string Password);
```

```csharp
IReadOnlyList<SavedChannelPassword> GetChannelPasswords(string serverKey);
IReadOnlyList<string> GetChannelAccessTokens(string serverKey);
void SaveChannelPassword(string serverKey, uint channelId, string channelName, string password);
void RemoveChannelPassword(string serverKey, uint channelId);
```

- [ ] **Step 4: Add storage field and load/save support**

In `AppConfigService`, add this field near `_profileRegistrations`:

```csharp
private List<SavedChannelPassword> _channelPasswords = new();
```

In `Load()`, after `_profileRegistrations = data?.ProfileRegistrations ?? new();`, add:

```csharp
_channelPasswords = (data?.ChannelPasswords ?? new List<SavedChannelPassword>())
    .Select(p => p with { Password = TryDecryptPassword(p.Password, _passwordStorage) })
    .ToList();
```

In both reset paths inside `catch`, add:

```csharp
_channelPasswords = new();
```

In `Save()`, add before constructing `ConfigData`:

```csharp
var encryptedChannelPasswords = _channelPasswords.Select(p => p with
{
    Password = string.IsNullOrEmpty(p.Password) || _passwordStorage.IsEncrypted(p.Password)
        ? p.Password
        : TryEncryptPassword(p.Password)
}).ToList();
```

Add `ChannelPasswords = encryptedChannelPasswords` to the `ConfigData` initializer.

Add this property to the `ConfigData` record:

```csharp
public List<SavedChannelPassword> ChannelPasswords { get; init; } = [];
```

- [ ] **Step 5: Add saved-password methods**

In `AppConfigService`, add methods after `GetSettings()`:

```csharp
public IReadOnlyList<SavedChannelPassword> GetChannelPasswords(string serverKey)
{
    lock (_lock)
    {
        return _channelPasswords
            .Where(p => string.Equals(p.ServerKey, serverKey, StringComparison.Ordinal))
            .ToList();
    }
}

public IReadOnlyList<string> GetChannelAccessTokens(string serverKey)
{
    lock (_lock)
    {
        return _channelPasswords
            .Where(p => string.Equals(p.ServerKey, serverKey, StringComparison.Ordinal))
            .Select(p => p.Password.Trim())
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }
}

public void SaveChannelPassword(string serverKey, uint channelId, string channelName, string password)
{
    lock (_lock)
    {
        _channelPasswords.RemoveAll(p => string.Equals(p.ServerKey, serverKey, StringComparison.Ordinal) && p.ChannelId == channelId);
        _channelPasswords.Add(new SavedChannelPassword(serverKey, channelId, channelName, password));
        Save();
    }
}

public void RemoveChannelPassword(string serverKey, uint channelId)
{
    lock (_lock)
    {
        _channelPasswords.RemoveAll(p => string.Equals(p.ServerKey, serverKey, StringComparison.Ordinal) && p.ChannelId == channelId);
        Save();
    }
}
```

- [ ] **Step 6: Run app config tests**

Run:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter AppConfigServiceTests
```

Expected: all `AppConfigServiceTests` pass.

### Task 2: Send Saved Tokens During Mumble Authentication

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Write failing authenticate-token test**

In `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`, add a test near the existing temporary access token test:

```csharp
[TestMethod]
public async Task Connect_SendsSavedChannelPasswordsAsAuthenticateTokens()
{
    using var harness = await MumbleProtocolTestHarness.StartAsync();
    var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
    appConfig.SaveChannelPassword("127.0.0.1:" + harness.Port, 5, "Secret", "secret-token");
    appConfig.SaveChannelPassword("127.0.0.1:" + harness.Port, 6, "Other", "secret-token");
    var adapter = new MumbleAdapter(new TestNativeBridge(), IntPtr.Zero, appConfigService: appConfig);

    adapter.Connect("127.0.0.1", harness.Port, "tester", "");
    var authenticate = await harness.ReadAuthenticateAsync();

    Assert.AreEqual(1, authenticate.Tokens.Count);
    Assert.AreEqual("secret-token", authenticate.Tokens.Single());
}
```

If the existing harness method names differ, use the local helper that reads the `Authenticate` packet and asserts username/password in the same file. Keep the assertion on `Tokens` exactly as above.

- [ ] **Step 2: Run the focused native test and verify it fails**

Run:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter Connect_SendsSavedChannelPasswordsAsAuthenticateTokens
```

Expected: compile failure until `TestAppConfigService` implements the new interface methods, then assertion failure because `MumbleAdapter.Connect` still passes `Array.Empty<string>()`.

- [ ] **Step 3: Update test app config fake**

In `MumbleAdapterParseTests.cs`, update `TestAppConfigService` to store saved channel passwords:

```csharp
private readonly List<SavedChannelPassword> _channelPasswords = new();

public IReadOnlyList<SavedChannelPassword> GetChannelPasswords(string serverKey)
    => _channelPasswords.Where(p => p.ServerKey == serverKey).ToList();

public IReadOnlyList<string> GetChannelAccessTokens(string serverKey)
    => _channelPasswords
        .Where(p => p.ServerKey == serverKey)
        .Select(p => p.Password.Trim())
        .Where(p => !string.IsNullOrWhiteSpace(p))
        .Distinct(StringComparer.Ordinal)
        .ToList();

public void SaveChannelPassword(string serverKey, uint channelId, string channelName, string password)
{
    _channelPasswords.RemoveAll(p => p.ServerKey == serverKey && p.ChannelId == channelId);
    _channelPasswords.Add(new SavedChannelPassword(serverKey, channelId, channelName, password));
}

public void RemoveChannelPassword(string serverKey, uint channelId)
    => _channelPasswords.RemoveAll(p => p.ServerKey == serverKey && p.ChannelId == channelId);
```

- [ ] **Step 4: Add server key helper and pass tokens into Connect**

In `MumbleAdapter.cs`, add helper near `Connect`:

```csharp
private static string BuildServerKey(string host, int port)
    => $"{host.Trim().ToLowerInvariant()}:{port}";
```

In `Connect`, replace:

```csharp
connection.Connect(username, password, Array.Empty<string>(), "Brmble");
```

with:

```csharp
var serverKey = BuildServerKey(host, port);
var accessTokens = _appConfigService?.GetChannelAccessTokens(serverKey).ToArray() ?? Array.Empty<string>();
connection.Connect(username, password, accessTokens, "Brmble");
```

- [ ] **Step 5: Run focused native test**

Run:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter Connect_SendsSavedChannelPasswordsAsAuthenticateTokens
```

Expected: test passes.

### Task 3: Add Native Bridge Handlers For Saved Passwords

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`

- [ ] **Step 1: Write failing bridge handler tests**

Add tests to `MumbleAdapterBridgeTests.cs` using the existing bridge invocation helpers in that file:

```csharp
[TestMethod]
public async Task SaveChannelPassword_HandlerStoresPasswordForActiveServer()
{
    var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
    var bridge = new TestNativeBridge();
    var adapter = new MumbleAdapter(bridge, IntPtr.Zero, appConfigService: appConfig);
    adapter.RegisterHandlers(bridge);
    adapter.SetActiveServerForTests("example.test", 64738);

    await bridge.InvokeHandler("voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
    {
        channelId = 5,
        channelName = "Secret",
        password = "secret-token"
    }));

    var saved = appConfig.GetChannelPasswords("example.test:64738");
    Assert.AreEqual(1, saved.Count);
    Assert.AreEqual("secret-token", saved[0].Password);
}

[TestMethod]
public async Task SaveChannelPassword_HandlerRemovesPasswordWhenBlank()
{
    var appConfig = new TestAppConfigService(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString()));
    appConfig.SaveChannelPassword("example.test:64738", 5, "Secret", "secret-token");
    var bridge = new TestNativeBridge();
    var adapter = new MumbleAdapter(bridge, IntPtr.Zero, appConfigService: appConfig);
    adapter.RegisterHandlers(bridge);
    adapter.SetActiveServerForTests("example.test", 64738);

    await bridge.InvokeHandler("voice.saveChannelPassword", JsonSerializer.SerializeToElement(new
    {
        channelId = 5,
        channelName = "Secret",
        password = ""
    }));

    Assert.AreEqual(0, appConfig.GetChannelPasswords("example.test:64738").Count);
}
```

If no `SetActiveServerForTests` exists, add it as an `internal` method in Step 3. If `TestNativeBridge` uses a different handler invocation method, follow the existing pattern in the same test file.

- [ ] **Step 2: Run focused bridge tests and verify failure**

Run:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SaveChannelPassword_Handler
```

Expected: compile or test failure because the handler and test helper do not exist.

- [ ] **Step 3: Add active server helper**

In `MumbleAdapter.cs`, add this internal helper near reconnect fields or other test helpers:

```csharp
internal void SetActiveServerForTests(string host, int port)
{
    _reconnectHost = host;
    _reconnectPort = port;
}
```

- [ ] **Step 4: Add bridge handler**

In `RegisterHandlers`, near `voice.joinChannel`, add:

```csharp
bridge.RegisterHandler("voice.saveChannelPassword", data =>
{
    if (_appConfigService == null || string.IsNullOrWhiteSpace(_reconnectHost))
    {
        return Task.CompletedTask;
    }

    if (!data.TryGetProperty("channelId", out var id) || !data.TryGetProperty("channelName", out var nameEl))
    {
        return Task.CompletedTask;
    }

    var channelId = id.GetUInt32();
    var channelName = nameEl.GetString() ?? "Channel";
    var password = data.TryGetProperty("password", out var pw) ? pw.GetString() ?? "" : "";
    var serverKey = BuildServerKey(_reconnectHost, _reconnectPort);

    if (string.IsNullOrWhiteSpace(password))
    {
        _appConfigService.RemoveChannelPassword(serverKey, channelId);
    }
    else
    {
        _appConfigService.SaveChannelPassword(serverKey, channelId, channelName, password.Trim());
    }

    return Task.CompletedTask;
});
```

- [ ] **Step 5: Run focused bridge tests**

Run:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SaveChannelPassword_Handler
```

Expected: tests pass.

### Task 4: Replace Frontend Context Menu Behavior

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Test: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Replace existing frontend tests**

Remove the tests added for `Edit Password` / `acl.setChannelPassword` in `ChannelTree.test.tsx`. Add these tests in the same admin context-menu describe block:

```tsx
  it('shows Edit Saved Password for password-protected channels without admin permission', () => {
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn(() => false),
      Permission: { Write: 0x01, MakeChannel: 0x40, Move: 0x20, Kick: 0x10000, Ban: 0x20000, MuteDeafen: 0x10 },
      requestPermissions: vi.fn(),
    });

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));

    expect(screen.getByText('Edit Saved Password')).toBeInTheDocument();
  });

  it('does not show Edit Saved Password for unrestricted channels', () => {
    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Open', parent: 0 }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Open'));

    expect(screen.queryByText('Edit Saved Password')).not.toBeInTheDocument();
  });

  it('saves a channel password through the saved-token bridge handler', async () => {
    promptMock.mockResolvedValue('new-secret');

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Saved Password'));

    expect(promptMock).toHaveBeenCalledWith({
      title: 'Saved Channel Password',
      message: 'Enter the password for Secret. Leave blank to forget the saved password.',
      placeholder: 'Password',
      confirmLabel: 'Save',
      cancelLabel: 'Cancel',
      isPassword: true,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.saveChannelPassword', {
      channelId: 5,
      channelName: 'Secret',
      password: 'new-secret',
    });
    expect(bridgeMock.send).not.toHaveBeenCalledWith('acl.setChannelPassword', expect.anything());
  });

  it('removes a saved channel password when prompt is saved empty', async () => {
    promptMock.mockResolvedValue('');

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Saved Password'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.saveChannelPassword', {
      channelId: 5,
      channelName: 'Secret',
      password: '',
    });
  });

  it('does not save channel password when prompt is canceled', async () => {
    promptMock.mockResolvedValue(null);

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Saved Password'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).not.toHaveBeenCalledWith('voice.saveChannelPassword', expect.anything());
  });
```

- [ ] **Step 2: Run focused frontend test and verify failure**

Run:

```bash
npm test -- src/components/Sidebar/ChannelTree.test.tsx
```

Working directory:

```text
src/Brmble.Web
```

Expected: tests fail because the menu still shows the admin `Edit Password` action and sends `acl.setChannelPassword`.

- [ ] **Step 3: Replace context-menu implementation**

In `ChannelTree.tsx`, in `channelMenuItems`, remove the `Edit Password` `adminItems.push` block that sends `acl.setChannelPassword`.

Before the admin permission checks, add:

```tsx
    const channel = channels.find(c => c.id === channelContextMenu.channelId);

    if (channel?.hasPasswordRestriction) {
      items.push({
        type: 'item' as const,
        label: 'Edit Saved Password',
        onClick: async () => {
          const password = await prompt({
            title: 'Saved Channel Password',
            message: `Enter the password for ${channelContextMenu.channelName}. Leave blank to forget the saved password.`,
            placeholder: 'Password',
            confirmLabel: 'Save',
            cancelLabel: 'Cancel',
            isPassword: true,
          });

          if (password === null) {
            setChannelContextMenu(null);
            return;
          }

          bridge.send('voice.saveChannelPassword', {
            channelId: channelContextMenu.channelId,
            channelName: channelContextMenu.channelName,
            password,
          });
          setChannelContextMenu(null);
        },
      });
    }
```

In the existing `Edit` handler, reuse `channel` from above or rename the inner local variable to avoid duplicate declarations.

- [ ] **Step 4: Run focused frontend test**

Run:

```bash
npm test -- src/components/Sidebar/ChannelTree.test.tsx
```

Working directory:

```text
src/Brmble.Web
```

Expected: `ChannelTree` tests pass.

### Task 5: Final Verification

**Files:**
- No additional file edits expected.

- [ ] **Step 1: Run native client tests touched by this change**

Run:

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "AppConfigServiceTests|Connect_SendsSavedChannelPasswordsAsAuthenticateTokens|SaveChannelPassword_Handler"
```

Expected: all selected tests pass.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm test -- src/components/Sidebar/ChannelTree.test.tsx
```

Working directory:

```text
src/Brmble.Web
```

Expected: all `ChannelTree` tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm run build
```

Working directory:

```text
src/Brmble.Web
```

Expected: Vite build completes with no TypeScript errors.

- [ ] **Step 4: Run full .NET build**

Run:

```bash
dotnet build
```

Expected: solution builds successfully.

- [ ] **Step 5: Check git status**

Run:

```bash
git status --short --branch
```

Expected: changes are on `feature/channel-password-context-menu`; unrelated untracked files are still untouched.

---

## Self-Review

- Spec coverage: The plan removes the admin ACL context-menu path, adds a non-admin saved-password action, stores encrypted per-channel password metadata, sends unique tokens through `Authenticate.tokens`, and preserves temporary join behavior.
- Placeholder scan: No placeholders remain. Where existing test helper names may differ, the plan explicitly says to use the local equivalent and keep the asserted behavior unchanged.
- Type consistency: `SavedChannelPassword`, `SaveChannelPassword`, `RemoveChannelPassword`, `GetChannelPasswords`, `GetChannelAccessTokens`, and `voice.saveChannelPassword` are used consistently across native and frontend tasks.
