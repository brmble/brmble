# Channel Password Join Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Brmble prompt for a channel password after a password-protected join denial, then retry the same channel join once with that password.

**Architecture:** Extend the existing web join orchestration in `App.tsx` so it tracks one pending join attempt, recognizes password-specific `voice.error` responses, and retries `voice.joinChannel` with an entered password. Extend the native `voice.joinChannel` bridge handler in `MumbleAdapter.cs` to accept an optional password field and route retry attempts through a temporary Mumble access-token handshake without changing normal joins.

**Tech Stack:** React, TypeScript, Vitest, C#, MSTest, MumbleSharp

---

## File Structure

- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Web\src\App.tsx`
  Purpose: Own pending join state, password-prompt detection, and retry orchestration for channel joins.
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Web\src\App.screenShareStart.test.ts`
  Purpose: Add failing frontend regression tests around prompt-and-retry join behavior.
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Client\Services\Voice\MumbleAdapter.cs`
  Purpose: Accept optional join passwords from the bridge, use temporary access tokens for password retries, and clear that token state after the attempt resolves.
- Modify: `C:\PrOgram project\brmble\brmble\tests\Brmble.Client.Tests\Services\MumbleAdapterMoveEventTests.cs`
  Purpose: Add focused native tests around join-password routing and token cleanup without introducing a new test file.

### Task 1: Add frontend regression tests for password-prompt join recovery

**Files:**
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Web\src\App.screenShareStart.test.ts`

- [ ] **Step 1: Add a failing test for password denial prompting and retry**

Add a new test near the existing join-channel tests:

```ts
it('prompts for a channel password after a password-protected join denial and retries once', async () => {
  const { prompt } = await import('./hooks/usePrompt');
  vi.mocked(prompt).mockResolvedValueOnce('secret-token');

  const view = render(React.createElement(App));

  act(() => {
    bridge.emit('voice.connected', {
      username: 'TestUser',
      channelId: 1,
      channels: [
        { id: 1, name: 'General' },
        { id: 2, name: 'Gaming' },
      ],
      users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
    });
  });

  await act(async () => {
    view.getByTestId('sidebar-join-channel-2').click();
    await Promise.resolve();
  });

  expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', { channelId: 2 });

  await act(async () => {
    bridge.emit('voice.error', {
      type: 'permissionDenied',
      message: 'Permission denied: missing channel password token',
    });
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(prompt).toHaveBeenCalledWith({
    title: 'Channel Password',
    message: 'Enter the password for Gaming.',
    placeholder: 'Password',
    confirmLabel: 'Join',
    cancelLabel: 'Cancel',
  });
  expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', { channelId: 2, password: 'secret-token' });
});
```

- [ ] **Step 2: Run the frontend test to verify it fails**

Run: `npm run test -- src/App.screenShareStart.test.ts`

Expected: FAIL because the current `handleJoinChannel` path always sends `{ channelId }` and `voice.error` does not trigger any channel-password prompt or retry logic.

- [ ] **Step 3: Add failing tests for cancel, unrelated denial, and no-loop retry behavior**

Add these tests in the same file:

```ts
it('does not retry when the user cancels the channel password prompt', async () => {
  const { prompt } = await import('./hooks/usePrompt');
  vi.mocked(prompt).mockResolvedValueOnce(null);

  const view = render(React.createElement(App));
  act(() => {
    bridge.emit('voice.connected', {
      username: 'TestUser',
      channelId: 1,
      channels: [{ id: 1, name: 'General' }, { id: 2, name: 'Gaming' }],
      users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
    });
  });

  await act(async () => {
    view.getByTestId('sidebar-join-channel-2').click();
    await Promise.resolve();
  });

  await act(async () => {
    bridge.emit('voice.error', {
      type: 'permissionDenied',
      message: 'Permission denied: password required',
    });
    await Promise.resolve();
+    await Promise.resolve();
  });

  expect(prompt).toHaveBeenCalled();
  expect(bridge.send).not.toHaveBeenCalledWith('voice.joinChannel', { channelId: 2, password: expect.any(String) });
});

it('does not prompt for unrelated permission denials', async () => {
  const { prompt } = await import('./hooks/usePrompt');

  const view = render(React.createElement(App));
  act(() => {
    bridge.emit('voice.connected', {
      username: 'TestUser',
      channelId: 1,
      channels: [{ id: 1, name: 'General' }, { id: 2, name: 'Gaming' }],
      users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
    });
  });

  await act(async () => {
    view.getByTestId('sidebar-join-channel-2').click();
    await Promise.resolve();
  });

  await act(async () => {
    bridge.emit('voice.error', {
      type: 'permissionDenied',
      message: 'Permission denied: missing enter permission',
    });
    await Promise.resolve();
  });

  expect(prompt).not.toHaveBeenCalled();
  expect(bridge.send).toHaveBeenCalledTimes(1);
});

it('does not reopen the password prompt after a second failed retry', async () => {
  const { prompt } = await import('./hooks/usePrompt');
  vi.mocked(prompt).mockResolvedValueOnce('wrong-secret');

  const view = render(React.createElement(App));
  act(() => {
    bridge.emit('voice.connected', {
      username: 'TestUser',
      channelId: 1,
      channels: [{ id: 1, name: 'General' }, { id: 2, name: 'Gaming' }],
      users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
    });
  });

  await act(async () => {
    view.getByTestId('sidebar-join-channel-2').click();
    await Promise.resolve();
  });

  await act(async () => {
    bridge.emit('voice.error', {
      type: 'permissionDenied',
      message: 'Permission denied: password required',
    });
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    bridge.emit('voice.error', {
      type: 'permissionDenied',
      message: 'Permission denied: password required',
    });
    await Promise.resolve();
  });

  expect(prompt).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run the frontend test file again to verify the new tests fail for the expected reason**

Run: `npm run test -- src/App.screenShareStart.test.ts`

Expected: FAIL in the new cases because `App.tsx` still lacks pending password-join state, password-specific denial detection, and retry suppression after one retry.

- [ ] **Step 5: Commit the failing frontend tests**

```bash
git add src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "test: cover channel password join retry flow"
```

### Task 2: Implement the frontend password prompt and retry orchestration

**Files:**
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Web\src\App.tsx`
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Web\src\App.screenShareStart.test.ts`

- [ ] **Step 1: Add join-attempt state and detection helpers in `App.tsx`**

Near the existing pending-channel state in `App.tsx`, add:

```ts
type PendingJoinAttempt = {
  channelId: number;
  channelName: string;
  promptedForPassword: boolean;
};

function isPasswordProtectedJoinError(data: unknown): boolean {
  const d = data as { type?: string; message?: string } | undefined;
  const message = (d?.message ?? '').toLowerCase();
  if (d?.type !== 'permissionDenied') {
    return false;
  }

  return message.includes('password')
    || message.includes('token')
    || message.includes('temporary access');
}
```

And add local state:

```ts
const [pendingJoinAttempt, setPendingJoinAttempt] = useState<PendingJoinAttempt | null>(null);
```

- [ ] **Step 2: Update `handleJoinChannel` to track the channel name and optional password**

Replace the current direct send with helpers like:

```ts
const sendJoinChannel = useCallback((channelId: number, password?: string) => {
  if (password && password.length > 0) {
    bridge.send('voice.joinChannel', { channelId, password });
    return;
  }
  bridge.send('voice.joinChannel', { channelId });
}, []);

const handleJoinChannel = async (channelId: number) => {
  const selfVoiceChannelId = users.find(u => u.self)?.channelId;
  if (selfVoiceChannelId === channelId) {
    return;
  }

  const channel = channels.find(c => c.id === channelId);
  if (!channel) {
    return;
  }

  if (isSharing && sharingChannelId && String(channelId) !== sharingChannelId) {
    const shouldMove = await confirm({
      title: 'Screen share active',
      message: 'Moving to another channel will end your screen share. Move and stop sharing?',
      confirmLabel: 'Move',
      cancelLabel: 'Stay Here',
    });
    if (!shouldMove) {
      return;
    }
    await stopSharing();
    setSharingChannelId(undefined);
  }

  startPendingAction(channelId);
  setPendingJoinAttempt({ channelId, channelName: channel.name, promptedForPassword: false });
  sendJoinChannel(channelId);
};
```

- [ ] **Step 3: Handle password-specific `voice.error` events in the existing voice error path**

In the existing `onVoiceError` flow inside `App.tsx`, add logic shaped like:

```ts
if (
  pendingJoinAttempt
  && !pendingJoinAttempt.promptedForPassword
  && isPasswordProtectedJoinError(data)
) {
  setPendingJoinAttempt(current => current ? { ...current, promptedForPassword: true } : current);
  void (async () => {
    const password = await prompt({
      title: 'Channel Password',
      message: `Enter the password for ${pendingJoinAttempt.channelName}.`,
      placeholder: 'Password',
      confirmLabel: 'Join',
      cancelLabel: 'Cancel',
    });

    if (!password) {
      clearPendingAction();
      setPendingJoinAttempt(null);
      return;
    }

    startPendingAction(pendingJoinAttempt.channelId);
    sendJoinChannel(pendingJoinAttempt.channelId, password);
  })();
  return;
}
```

Also clear the join attempt after success or terminal failure:

```ts
setPendingJoinAttempt(null);
```

Wire that into:

- `onVoiceChannelJoined`
- `onVoiceDisconnected`
- the non-password `voice.error` path after surfacing the error

- [ ] **Step 4: Re-run the frontend test file and verify all join tests pass**

Run: `npm run test -- src/App.screenShareStart.test.ts`

Expected: PASS, including the new password prompt tests and the pre-existing screen-share join tests.

- [ ] **Step 5: Commit the frontend implementation**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "feat: prompt for channel password on join denial"
```

### Task 3: Add native regression tests for optional join passwords

**Files:**
- Modify: `C:\PrOgram project\brmble\brmble\tests\Brmble.Client.Tests\Services\MumbleAdapterMoveEventTests.cs`

- [ ] **Step 1: Add a failing test that the bridge join handler accepts an optional password**

Add a test like this:

```csharp
[TestMethod]
public async Task RegisterHandlers_VoiceJoinChannel_WithPassword_UsesPasswordJoinPath()
{
    var bridge = NativeBridgeTestHarness.Create();
    var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
    adapter.RegisterHandlers(bridge);

    var joinCalls = new List<(uint ChannelId, string? Password)>();
    adapter.OnJoinChannelRequestedForTest = (channelId, password) => joinCalls.Add((channelId, password));

    await NativeBridgeTestHarness.InvokeHandlerAsync(bridge, "voice.joinChannel", """
        { "channelId": 5, "password": "secret-token" }
        """);

    Assert.AreEqual(1, joinCalls.Count);
    Assert.AreEqual(5u, joinCalls[0].ChannelId);
    Assert.AreEqual("secret-token", joinCalls[0].Password);
}
```

If the test harness needs a seam, add one in the implementation task rather than bypassing the bridge handler in the test.

- [ ] **Step 2: Add a failing test that normal joins remain unchanged**

Add:

```csharp
[TestMethod]
public void JoinChannel_WithoutPassword_DoesNotStoreTemporaryToken()
{
    var adapter = MumbleAdapterTestHarness.Create();

    adapter.JoinChannel(5);

    Assert.IsNull(GetField<string?>(adapter, "_pendingJoinPassword"));
}
```

- [ ] **Step 3: Run the native test file to verify the new tests fail**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter MumbleAdapterMoveEventTests`

Expected: FAIL because the current `voice.joinChannel` bridge handler ignores any password field and `MumbleAdapter` has no temporary join-password state.

- [ ] **Step 4: Commit the failing native tests**

```bash
git add tests/Brmble.Client.Tests/Services/MumbleAdapterMoveEventTests.cs
git commit -m "test: cover native channel password join handling"
```

### Task 4: Implement native temporary-token join support

**Files:**
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Client\Services\Voice\MumbleAdapter.cs`
- Modify: `C:\PrOgram project\brmble\brmble\tests\Brmble.Client.Tests\Services\MumbleAdapterMoveEventTests.cs`

- [ ] **Step 1: Add a narrow native seam for password-aware joins**

In `MumbleAdapter.cs`, replace the single-argument method with an overload:

```csharp
public void JoinChannel(uint channelId)
    => JoinChannel(channelId, password: null);

internal void JoinChannel(uint channelId, string? password)
{
    if (Connection is not { State: ConnectionStates.Connected })
        return;

    _pendingLocalJoinChannelId = channelId;
    _pendingJoinPassword = string.IsNullOrWhiteSpace(password) ? null : password;
    Connection.SendControl(PacketType.UserState, new UserState { ChannelId = channelId });
    SendPermissionQuery(new PermissionQuery { ChannelId = channelId });
}
```

Add a private field near the other join-state fields:

```csharp
private string? _pendingJoinPassword;
```

- [ ] **Step 2: Update the bridge handler to pass the optional password**

Change the handler block to:

```csharp
bridge.RegisterHandler("voice.joinChannel", data =>
{
    if (data.TryGetProperty("channelId", out var id))
    {
        var password = data.TryGetProperty("password", out var pw) ? pw.GetString() : null;
        JoinChannel(id.GetUInt32(), password);
    }
    return Task.CompletedTask;
});
```

- [ ] **Step 3: Apply the temporary token only for the pending password join**

Use the existing Mumble token support already passed to `connection.Connect(username, password, Array.Empty<string>(), "Brmble")` as the model and add a focused helper such as:

```csharp
internal virtual void ApplyTemporaryAccessTokenForPendingJoin()
{
    if (string.IsNullOrWhiteSpace(_pendingJoinPassword) || Connection is null)
        return;

    Connection.SendControl(PacketType.Authenticate, new Authenticate
    {
        Username = LocalUser?.Name ?? _reconnectUsername ?? string.Empty,
        Password = string.Empty,
        Tokens = { _pendingJoinPassword }
    });
}
```

Then call it immediately before the join `UserState` send when `_pendingJoinPassword` is present.

After the join attempt resolves, clear the token state in the same places that clear `_pendingLocalJoinChannelId`, for example:

```csharp
_pendingJoinPassword = null;
```

at:

- successful self move handling
- failed permission-denied handling
- disconnect / reconnect reset paths

- [ ] **Step 4: Re-run the native tests and verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter MumbleAdapterMoveEventTests`

Expected: PASS, with normal joins unchanged and password joins routed through the optional password path.

- [ ] **Step 5: Commit the native implementation**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterMoveEventTests.cs
git commit -m "feat: support temporary token retries for channel joins"
```

### Task 5: Final verification pass

**Files:**
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Web\src\App.tsx`
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Web\src\App.screenShareStart.test.ts`
- Modify: `C:\PrOgram project\brmble\brmble\src\Brmble.Client\Services\Voice\MumbleAdapter.cs`
- Modify: `C:\PrOgram project\brmble\brmble\tests\Brmble.Client.Tests\Services\MumbleAdapterMoveEventTests.cs`

- [ ] **Step 1: Run the frontend regression file one more time**

Run: `npm run test -- src/App.screenShareStart.test.ts`

Expected: PASS with the new channel-password tests and no regressions in existing screen-share join behavior.

- [ ] **Step 2: Run the native regression file one more time**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter MumbleAdapterMoveEventTests`

Expected: PASS with the new password-aware join coverage.

- [ ] **Step 3: Review the diff for accidental persistence or logging of channel passwords**

Run: `git diff -- src/Brmble.Web/src/App.tsx src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

Expected: the password only appears as ephemeral prompt input and bridge payload data, with no config writes, reconnect-password assignment, or diagnostic logging.

- [ ] **Step 4: Commit the final verification touch-ups if needed**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterMoveEventTests.cs
git commit -m "test: verify channel password join flow"
```

## Self-Review

### Spec coverage

- Fail-then-prompt join flow: covered in Task 1 and Task 2.
- Retry once with the same channel id and entered password: covered in Task 2 and Task 4.
- No prompt for unrelated permission failures: covered in Task 1 and Task 2.
- Ephemeral password handling only: covered in Task 2, Task 4, and Task 5.
- Native optional `voice.joinChannel` password contract: covered in Task 3 and Task 4.

### Placeholder scan

The plan names concrete files, bridge events, tests, commands, and code targets. There are no `TODO`/`TBD` placeholders.

### Type consistency

- Frontend payload uses `bridge.send('voice.joinChannel', { channelId, password })`.
- Native bridge handler reads `channelId` and optional `password`.
- Frontend pending state uses `PendingJoinAttempt`.
- Native temporary state uses `_pendingJoinPassword`.

