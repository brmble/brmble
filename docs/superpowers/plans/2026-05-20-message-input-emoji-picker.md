# Message Input Emoji Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an emoji button to the chat composer that opens a compact picker and inserts supported emoji into the draft at the current textarea cursor position.

**Architecture:** Keep the feature fully local to `MessageInput` so no app-level wiring or transport changes are needed. Reuse `SUPPORTED_REACTIONS` from `chatReactions.ts` as the source of truth, add a focused `MessageInput` test file to drive the behavior, and style the picker as a lightweight popover inside the existing composer wrapper.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, existing Brmble `Icon`, `Tooltip`, and chat composer CSS.

---

## File Structure

### Existing files

- `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`
  - Owns composer draft state, textarea ref, mention behavior, image staging, send behavior, and is the correct integration point for emoji picker state and insertion logic.
- `src/Brmble.Web/src/components/ChatPanel/MessageInput.css`
  - Owns chat composer layout and should absorb the emoji trigger/picker styles.
- `src/Brmble.Web/src/utils/chatReactions.ts`
  - Already exports `SUPPORTED_REACTIONS`, which should remain the single source of truth for picker options.

### New file

- `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx`
  - Focused component tests for opening the picker, insertion at caret, replacing a selected range, focus restoration, dismissal, disabled behavior, and mention/picker interaction.

---

### Task 1: Add failing composer emoji-picker tests

**Files:**
- Create: `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx`
- Reference: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`
- Reference: `src/Brmble.Web/src/utils/chatReactions.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx` with this test scaffold:

```tsx
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';
import { SUPPORTED_REACTIONS } from '../../utils/chatReactions';

function renderMessageInput(
  props: Partial<React.ComponentProps<typeof MessageInput>> = {},
) {
  const onSend = vi.fn();
  render(
    <MessageInput
      onSend={onSend}
      placeholder="Message #general"
      mentionableUsers={[
        { displayName: 'Alice', isOnline: true },
      ]}
      {...props}
    />,
  );

  const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;
  return { onSend, textarea };
}

describe('MessageInput emoji picker', () => {
  it('opens the picker and renders the supported emoji list', async () => {
    const user = userEvent.setup();
    renderMessageInput();

    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));

    for (const emoji of SUPPORTED_REACTIONS) {
      expect(screen.getByRole('button', { name: `Insert ${emoji}` })).toBeInTheDocument();
    }
  });

  it('inserts an emoji at the current caret position and restores focus', async () => {
    const user = userEvent.setup();
    const { textarea } = renderMessageInput();

    await user.type(textarea, 'Hello friend');
    textarea.focus();
    textarea.setSelectionRange(5, 5);

    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(screen.getByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[0]}` }));

    await waitFor(() => expect(textarea).toHaveValue(`Hello${SUPPORTED_REACTIONS[0]} friend`));
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(5 + SUPPORTED_REACTIONS[0].length);
    expect(textarea.selectionEnd).toBe(5 + SUPPORTED_REACTIONS[0].length);
  });

  it('replaces the selected range with the chosen emoji', async () => {
    const user = userEvent.setup();
    const { textarea } = renderMessageInput();

    await user.type(textarea, 'Hello there');
    textarea.focus();
    textarea.setSelectionRange(6, 11);

    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(screen.getByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[1]}` }));

    await waitFor(() => expect(textarea).toHaveValue(`Hello ${SUPPORTED_REACTIONS[1]}`));
  });

  it('closes on escape and outside click', async () => {
    const user = userEvent.setup();
    renderMessageInput();

    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    expect(screen.getByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[0]}` })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[0]}` })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[0]}` })).not.toBeInTheDocument();
    });
  });

  it('does not open when the composer is disabled', async () => {
    const user = userEvent.setup();
    renderMessageInput({ disabled: true });

    const trigger = screen.getByRole('button', { name: 'Insert emoji' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[0]}` })).not.toBeInTheDocument();
  });

  it('closes the picker when mention autocomplete becomes active', async () => {
    const user = userEvent.setup();
    const { textarea } = renderMessageInput();

    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    expect(screen.getByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[0]}` })).toBeInTheDocument();

    await act(async () => {
      textarea.focus();
      await user.type(textarea, '@A');
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: `Insert ${SUPPORTED_REACTIONS[0]}` })).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run:

```bash
npm run test -- src/components/ChatPanel/MessageInput.test.tsx
```

Expected:

```text
FAIL  src/components/ChatPanel/MessageInput.test.tsx
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Insert emoji"
```

- [ ] **Step 3: Commit the failing test**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx
git commit -m "test: add failing message input emoji picker coverage"
```

---

### Task 2: Implement picker state, insertion logic, and dismissal behavior

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`
- Reference: `src/Brmble.Web/src/utils/chatReactions.ts`

- [ ] **Step 1: Import the emoji source and add picker state**

Update the imports and top-level state in `MessageInput.tsx`:

```tsx
import { validateImageFile } from '../../utils/imageUpload';
import { SUPPORTED_REACTIONS } from '../../utils/chatReactions';
import './MessageInput.css';
```

Add state and refs near the existing textarea and wrapper refs:

```tsx
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
```

- [ ] **Step 2: Add the insertion helper and picker toggle helpers**

Add these callbacks below `handleMentionSelect`:

```tsx
  const closeEmojiPicker = useCallback(() => {
    setIsEmojiPickerOpen(false);
  }, []);

  const handleEmojiTriggerClick = useCallback(() => {
    if (disabled) return;
    setIsEmojiPickerOpen((open) => !open);
  }, [disabled]);

  const handleEmojiInsert = useCallback((emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart ?? message.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const before = message.slice(0, selectionStart);
    const after = message.slice(selectionEnd);
    const nextMessage = `${before}${emoji}${after}`;
    const nextCaret = selectionStart + emoji.length;

    setMessage(nextMessage);
    setIsEmojiPickerOpen(false);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }, [message]);
```

- [ ] **Step 3: Close the picker when mentions activate or the user presses escape**

Extend `updateMentionState` so mention activation closes the picker before opening the dropdown:

```tsx
      if (query.length === 0 || !query.startsWith(' ')) {
        setIsEmojiPickerOpen(false);
        setMentionActive(true);
        setMentionQuery(query);
```

Extend `handleKeyDown` so `Escape` closes the emoji picker before falling through:

```tsx
    if (e.key === 'Escape' && isEmojiPickerOpen) {
      e.preventDefault();
      closeEmojiPicker();
      return;
    }
```

Use these dependencies:

```tsx
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
```

and ensure the component scope includes `isEmojiPickerOpen` and `closeEmojiPicker`.

- [ ] **Step 4: Add outside-click dismissal for the picker**

Add a dedicated effect below the existing mention outside-click effect:

```tsx
  useEffect(() => {
    if (!isEmojiPickerOpen) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (emojiPickerRef.current?.contains(target)) return;
      setIsEmojiPickerOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isEmojiPickerOpen]);
```

- [ ] **Step 5: Render the emoji trigger and picker UI**

Insert this block inside the `.message-input-wrapper`, immediately before the existing send button tooltip:

```tsx
        <Tooltip content="Insert emoji">
          <button
            type="button"
            className="btn btn-secondary btn-icon emoji-button"
            onClick={handleEmojiTriggerClick}
            disabled={disabled}
            aria-label="Insert emoji"
            aria-expanded={isEmojiPickerOpen}
            aria-haspopup="dialog"
          >
            <Icon name="palette" size={18} />
          </button>
        </Tooltip>
        {isEmojiPickerOpen && (
          <div
            ref={emojiPickerRef}
            className="message-emoji-picker"
            role="dialog"
            aria-label="Emoji picker"
          >
            {SUPPORTED_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="message-emoji-option"
                onClick={() => handleEmojiInsert(emoji)}
                aria-label={`Insert ${emoji}`}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
        )}
```

- [ ] **Step 6: Run the focused test file to verify it passes**

Run:

```bash
npm run test -- src/components/ChatPanel/MessageInput.test.tsx
```

Expected:

```text
PASS  src/components/ChatPanel/MessageInput.test.tsx
6 tests passed
```

- [ ] **Step 7: Commit the implementation**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx
git commit -m "feat: add message input emoji picker behavior"
```

---

### Task 3: Style the picker and verify composer integration

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.css`
- Verify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`
- Verify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx`

- [ ] **Step 1: Add emoji button and picker styles**

Append these styles to `MessageInput.css`:

```css
.message-input-wrapper {
  position: relative;
}

.emoji-button {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
}

.emoji-button:focus-visible {
  box-shadow: none;
}

.message-emoji-picker {
  position: absolute;
  right: calc(40px + var(--space-sm) + var(--space-xs));
  bottom: calc(100% + var(--space-xs));
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-xs);
  padding: var(--space-xs);
  min-width: 132px;
  background: var(--bg-elevated, var(--bg-secondary));
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 20;
}

.message-emoji-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    transform var(--transition-fast);
}

.message-emoji-option:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-primary);
  transform: translateY(-1px);
}

.message-emoji-option:focus-visible {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
}
```

- [ ] **Step 2: Run the focused test file again after styling**

Run:

```bash
npm run test -- src/components/ChatPanel/MessageInput.test.tsx
```

Expected:

```text
PASS  src/components/ChatPanel/MessageInput.test.tsx
6 tests passed
```

- [ ] **Step 3: Run the existing related chat component test to catch regressions**

Run:

```bash
npm run test -- src/components/ChatPanel/MessageBubble.test.tsx
```

Expected:

```text
PASS  src/components/ChatPanel/MessageBubble.test.tsx
2 tests passed
```

- [ ] **Step 4: Build the web app for integration verification**

Run:

```bash
npm run build
```

Expected:

```text
vite build
✓ built successfully
```

- [ ] **Step 5: Commit the styling and verification pass**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageInput.css src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx
git commit -m "style: polish message input emoji picker"
```

---

## Self-Review

### Spec coverage

- Emoji button at end of input bar: covered by Task 2 Step 5 and Task 3 Step 1.
- Reuse supported reaction emojis: covered by Task 1 Step 1 and Task 2 Step 1.
- Insert at current cursor position: covered by Task 1 Step 1 and Task 2 Step 2.
- Replace selected text: covered by Task 1 Step 1 and Task 2 Step 2.
- Restore focus after insertion: covered by Task 1 Step 1 and Task 2 Step 2.
- Close on outside click and `Escape`: covered by Task 1 Step 1, Task 2 Step 3, and Task 2 Step 4.
- Close when mentions activate: covered by Task 1 Step 1 and Task 2 Step 3.
- Disabled composer disables emoji access: covered by Task 1 Step 1 and Task 2 Step 5.
- Preserve existing composer behavior: regression checked by Task 3 Steps 2-4.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Every code-changing step includes concrete code.
- Every verification step includes a concrete command and expected result.

### Type consistency

- Picker state uses `isEmojiPickerOpen` consistently across tests, logic, and render.
- Insertion callback is named `handleEmojiInsert` consistently.
- Trigger button accessible label is `Insert emoji` consistently in tests and UI.
- Emoji option accessible labels follow `Insert ${emoji}` consistently in tests and UI.
