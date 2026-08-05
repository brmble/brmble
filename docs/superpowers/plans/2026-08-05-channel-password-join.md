# Channel Password Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users join password-protected channels immediately and choose whether Brmble remembers the password, without forcing a voice reconnect.

**Architecture:** Add a dedicated password prompt result that returns both the entered password and a remember flag, while leaving the existing string-only prompt API unchanged. The join flow will optionally persist the password and then send `voice.joinChannel` with the password on the current connection; the saved-password editor will only persist or clear the value.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing native Mumble bridge.

## Global Constraints

- Do not use “Save & reconnect” in user-facing password prompts.
- Use “Join channel” for the join flow.
- Use “Remember this password” for persistence.
- Use “Save” for the saved-password editor.
- Canceling never saves, joins, or reconnects.
- An empty password in the saved-password editor clears the saved value.
- An empty password submitted from the join prompt is treated as cancel/no-op.
- Do not change password encryption, ACL administration, or reconnect-time token loading.

---

## File map

- Modify `src/Brmble.Web/src/hooks/usePrompt.tsx`: add a typed password prompt that returns password plus remember choice.
- Modify `src/Brmble.Web/src/hooks/usePrompt.test.tsx`: verify checkbox rendering, defaults, and structured result.
- Modify `src/Brmble.Web/src/App.tsx`: use the new prompt for channel joins and retry prompts; send a direct `voice.joinChannel` and optionally save.
- Modify `src/Brmble.Web/src/App.screenShareStart.test.ts`: cover remembered and one-time joins, cancellation, and retry behavior.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`: make saved-password editing save-only.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`: verify save/clear without reconnect and updated copy.

### Task 1: Add the structured password prompt

**Files:**
- Modify: `src/Brmble.Web/src/hooks/usePrompt.tsx`
- Test: `src/Brmble.Web/src/hooks/usePrompt.test.tsx`

**Interfaces:**
- Produces `PasswordPromptResult = { password: string; remember: boolean }`.
- Produces `promptPassword(options): Promise<PasswordPromptResult | null>`.
- `PasswordPromptOptions` includes the existing title/message/input options plus `rememberLabel?: string` and `rememberDefaultChecked?: boolean`.
- Existing `prompt(options): Promise<string | null>` behavior remains unchanged.

- [ ] **Step 1: Write the failing tests**

Add tests that call `promptPassword` through the existing `PromptHarness` and assert:

```tsx
it('returns the password and checked remember choice', async () => {
  const user = userEvent.setup();
  render(<PromptHarness />);

  let result!: Promise<PasswordPromptResult | null>;
  await act(async () => {
    result = promptPassword({
      title: 'Channel Password',
      message: 'Enter the password.',
      placeholder: 'Password',
      confirmLabel: 'Join channel',
      rememberLabel: 'Remember this password',
      rememberDefaultChecked: true,
      isPassword: true,
    });
  });

  const input = screen.getByPlaceholderText('Password');
  const remember = screen.getByRole('checkbox', { name: 'Remember this password' });
  expect(remember).toBeChecked();
  await user.clear(input);
  await user.type(input, 'secret-token');
  await user.click(screen.getByRole('checkbox', { name: 'Remember this password' }));
  await user.click(screen.getByRole('button', { name: 'Join channel' }));

  await expect(result).resolves.toEqual({ password: 'secret-token', remember: false });
});

it('returns null when the password prompt is canceled', async () => {
  render(<PromptHarness />);
  let result!: Promise<PasswordPromptResult | null>;
  await act(async () => {
    result = promptPassword({
      title: 'Channel Password',
      message: 'Enter the password.',
      rememberLabel: 'Remember this password',
    });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await expect(result).resolves.toBeNull();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `src/Brmble.Web`:

```text
npm run test -- src/hooks/usePrompt.test.tsx
```

Expected: FAIL because `promptPassword` and the remember checkbox do not exist yet.

- [ ] **Step 3: Implement the minimal prompt API and UI**

Keep the current `prompt` resolver and rendering path intact. Add a separate password-prompt resolver and option state so the new API returns `{ password, remember }`; render a labeled native checkbox below the password field when `rememberLabel` is supplied. Initialize it from `rememberDefaultChecked` on open, and resolve `null` through the same cancel/Escape/overlay paths. Clear the input and checkbox state after submit or cancel. Preserve the existing password reveal toggle and Enter-to-submit behavior.

- [ ] **Step 4: Run the focused tests to verify they pass**

```text
npm run test -- src/hooks/usePrompt.test.tsx
```

Expected: PASS, including the existing string-only prompt test.

- [ ] **Step 5: Commit the prompt API**

```text
git add -- src/Brmble.Web/src/hooks/usePrompt.tsx src/Brmble.Web/src/hooks/usePrompt.test.tsx
git commit -m "feat: add remember option to password prompts"
```

### Task 2: Switch channel joining to direct password authentication

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/App.screenShareStart.test.ts`

**Interfaces:**
- Consumes `promptPassword(options): Promise<PasswordPromptResult | null>` from Task 1.
- Produces join behavior that sends `voice.joinChannel` with `{ channelId, password }` and never sends `voice.reconnect` from a password prompt.

- [ ] **Step 1: Write failing integration tests**

Update the existing password-join tests so the expected prompt uses `Join channel` and `Remember this password`. Reuse each test's existing connected-app setup and protected `Gaming` channel click, then add assertions for both choices:

```tsx
it('joins immediately and saves a remembered password', async () => {
  promptPasswordMock.mockResolvedValue({ password: 'secret-token', remember: true });
  await waitFor(() => expect(bridge.send).toHaveBeenCalledWith('voice.saveChannelPassword', {
    channelId: 2,
    channelName: 'Gaming',
    password: 'secret-token',
  }));
  expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', {
    channelId: 2,
    password: 'secret-token',
  });
  expect(bridge.send).not.toHaveBeenCalledWith('voice.reconnect', expect.anything());
});

it('joins immediately without saving when remember is unchecked', async () => {
  promptPasswordMock.mockResolvedValue({ password: 'one-time-token', remember: false });
  await waitFor(() => expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', {
    channelId: 2,
    password: 'one-time-token',
  }));
  expect(bridge.send).not.toHaveBeenCalledWith('voice.saveChannelPassword', expect.anything());
  expect(bridge.send).not.toHaveBeenCalledWith('voice.reconnect', expect.anything());
});
```

Update the retry test to mock the structured result and assert a direct `voice.joinChannel`; retain the assertion that canceling performs no bridge action.

- [ ] **Step 2: Run the focused tests to verify they fail**

```text
npm run test -- src/App.screenShareStart.test.ts
```

Expected: FAIL because the app still calls the old string prompt and `voice.reconnect`.

- [ ] **Step 3: Implement the minimal join-flow change**

Replace the password prompt calls in `handleJoinChannel` and the rejected-join retry path with `promptPassword`. Replace `saveChannelPasswordAndReconnect` with a helper that:

```ts
const joinChannelWithPassword = (channelId: number, channelName: string, password: string, remember: boolean) => {
  const normalized = password.trim();
  if (!normalized) return;
  if (remember) {
    bridge.send('voice.saveChannelPassword', { channelId, channelName, password: normalized });
  }
  bridge.send('voice.joinChannel', { channelId, password: normalized });
};
```

Use `remember: true` as the prompt default, and return immediately when the prompt is canceled or the normalized password is empty. Do not issue a reconnect in this helper.

- [ ] **Step 4: Run the focused tests to verify they pass**

```text
npm run test -- src/App.screenShareStart.test.ts
```

Expected: PASS for remembered joins, one-time joins, canceled prompts, and rejected-join retry behavior.

- [ ] **Step 5: Commit the join-flow change**

```text
git add -- src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "feat: join password channels without reconnecting"
```

### Task 3: Make saved-password editing save-only

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Test: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

**Interfaces:**
- Consumes the existing string-only `prompt` API because this editor does not need a remember checkbox.
- Produces only `voice.saveChannelPassword`; it never sends `voice.reconnect`.

- [ ] **Step 1: Write failing tests**

Change the existing editor expectations to:

```tsx
expect(promptMock).toHaveBeenCalledWith({
  title: 'Saved Channel Password',
  message: 'Enter the password for Secret. Leave blank to forget the saved password.',
  placeholder: 'Password',
  defaultValue: '',
  confirmLabel: 'Save',
  cancelLabel: 'Cancel',
  isPassword: true,
});
expect(bridgeMock.send).not.toHaveBeenCalledWith('voice.reconnect', expect.anything());
```

Apply the same no-reconnect assertion to the clear-value test, while retaining the cancel and latest-value-prefill tests.

- [ ] **Step 2: Run the focused tests to verify they fail**

```text
npm run test -- src/components/Sidebar/ChannelTree.test.tsx
```

Expected: FAIL because the component still advertises and sends reconnect.

- [ ] **Step 3: Implement save-only editor behavior**

Change the editor copy and confirm label, leave `voice.saveChannelPassword` unchanged for both non-empty and empty values, and remove the `voice.reconnect` bridge send. Keep cancel behavior and channel-menu cleanup unchanged.

- [ ] **Step 4: Run the focused tests to verify they pass**

```text
npm run test -- src/components/Sidebar/ChannelTree.test.tsx
```

Expected: PASS, including save, clear, cancel, and prefill cases.

- [ ] **Step 5: Commit the editor change**

```text
git add -- src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
git commit -m "feat: save channel passwords without reconnecting"
```

### Task 4: Run complete verification

**Files:**
- Test: `src/Brmble.Web/src/hooks/usePrompt.test.tsx`
- Test: `src/Brmble.Web/src/App.screenShareStart.test.ts`
- Test: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Run all affected frontend tests**

```text
npm run test -- src/hooks/usePrompt.test.tsx src/App.screenShareStart.test.ts src/components/Sidebar/ChannelTree.test.tsx
```

Expected: PASS with no reconnect expectation failures.

- [ ] **Step 2: Run the frontend type check and build**

```text
npm run type-check
npm run build
```

Expected: both commands complete successfully.

- [ ] **Step 3: Review the final diff**

```text
git diff HEAD~3 -- src/Brmble.Web/src/hooks/usePrompt.tsx src/Brmble.Web/src/hooks/usePrompt.test.tsx src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
```

Confirm that password values are not logged, no password prompt sends `voice.reconnect`, and existing non-password prompt callers remain unchanged.
