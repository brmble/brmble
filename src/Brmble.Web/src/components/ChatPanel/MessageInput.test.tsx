import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

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
    // Focus and caret are restored in a requestAnimationFrame after the value
    // update, so poll for them rather than asserting synchronously (the rAF may
    // not have fired yet on slower environments — this was flaky on CI).
    await waitFor(() => {
      expect(textarea).toHaveFocus();
      expect(textarea.selectionStart).toBe(5 + SUPPORTED_REACTIONS[0].length);
      expect(textarea.selectionEnd).toBe(5 + SUPPORTED_REACTIONS[0].length);
    });
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

describe('MessageInput typing callbacks', () => {
  it('starts typing for a non-empty draft and stops when the draft becomes empty', async () => {
    const user = userEvent.setup();
    const onTypingStart = vi.fn();
    const onTypingStop = vi.fn();
    const { textarea } = renderMessageInput({
      matrixRoomId: '!room:example.com',
      onTypingStart,
      onTypingStop,
      typingTargetId: '42',
    });

    await user.type(textarea, 'H');
    expect(onTypingStart).toHaveBeenCalledWith('42');

    await user.clear(textarea);
    expect(onTypingStop).toHaveBeenCalledWith('42');
  });

  it('stops typing on blur without changing the draft', async () => {
    const user = userEvent.setup();
    const onTypingStop = vi.fn();
    const { textarea } = renderMessageInput({
      onTypingStop,
      typingTargetId: '42',
    });

    await user.type(textarea, 'Hello');
    await user.tab();
    expect(onTypingStop).toHaveBeenCalledWith('42');
    expect(textarea).toHaveValue('Hello');
  });

  it('stops typing after a successful send', async () => {
    const user = userEvent.setup();
    const onTypingStart = vi.fn();
    const onTypingStop = vi.fn();
    const { textarea, onSend } = renderMessageInput({
      onTypingStart,
      onTypingStop,
      typingTargetId: '42',
    });

    await user.type(textarea, 'Hello again');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledWith('Hello again', undefined);
    expect(onTypingStop).toHaveBeenCalledWith('42');
  });

  it('does not start typing when only an image is staged', async () => {
    const onTypingStart = vi.fn();
    renderMessageInput({ onTypingStart, typingTargetId: '42' });

    const file = new File(['image'], 'typing.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('combobox'), {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(onTypingStart).not.toHaveBeenCalled();
  });

  it('stops typing for the previously started target when the conversation changes', async () => {
    const onTypingStart = vi.fn();
    const onTypingStop = vi.fn();
    const onSend = vi.fn();
    const { rerender } = render(
      <MessageInput
        onSend={onSend}
        placeholder="Message #general"
        mentionableUsers={[{ displayName: 'Alice', isOnline: true }]}
        onTypingStart={onTypingStart}
        onTypingStop={onTypingStop}
        typingTargetId="42"
      />,
    );
    const textarea = screen.getByRole('combobox') as HTMLTextAreaElement;

    await userEvent.type(textarea, 'Hello');
    expect(onTypingStart).toHaveBeenCalledWith('42');

    rerender(
      <MessageInput
        onSend={onSend}
        placeholder="Message #other"
        mentionableUsers={[{ displayName: 'Alice', isOnline: true }]}
        onTypingStart={onTypingStart}
        onTypingStop={onTypingStop}
        typingTargetId="84"
      />,
    );

    expect(onTypingStop).toHaveBeenCalledWith('42');
  });
});

describe('MessageInput edit mode', () => {
  it('shows an editing header, prefills the composer, and clears on cancel', async () => {
    const user = userEvent.setup();
    const onClearEdit = vi.fn();

    renderMessageInput({
      editState: {
        eventId: '$msg',
        originalContent: 'Existing text',
        currentContent: 'Existing text',
      },
      onClearEdit,
    });

    const textarea = screen.getByRole('combobox');
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeInTheDocument();
    await waitFor(() => expect(textarea).toHaveValue('Existing text'));

    await user.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(onClearEdit).toHaveBeenCalled();
  });

  it('disables send until the edit meaningfully changes the current message text', async () => {
    const user = userEvent.setup();

    renderMessageInput({
      editState: {
        eventId: '$msg',
        originalContent: 'hello',
        currentContent: 'hello',
      },
    });

    const textarea = screen.getByRole('combobox');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    await waitFor(() => expect(textarea).toHaveValue('hello'));
    expect(sendButton).toBeDisabled();

    await user.type(textarea, ' ');
    expect(sendButton).toBeDisabled();

    await user.type(textarea, ' again');
    expect(sendButton).toBeEnabled();
  });

  it('delegates edit saves to onSaveEdit and clears only on success', async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn().mockResolvedValue(true);
    const onClearEdit = vi.fn();

    renderMessageInput({
      editState: {
        eventId: '$msg',
        originalContent: 'hello',
        currentContent: 'hello',
      },
      onSaveEdit,
      onClearEdit,
    });

    const textarea = screen.getByRole('combobox');
    await user.clear(textarea);
    await user.type(textarea, 'hello again{Enter}');

    await waitFor(() => {
      expect(onSaveEdit).toHaveBeenCalledWith('$msg', 'hello again');
    });
    expect(onClearEdit).toHaveBeenCalled();
  });

  it('keeps edit mode and composer contents when edit save fails', async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn().mockResolvedValue(false);
    const onClearEdit = vi.fn();

    renderMessageInput({
      editState: {
        eventId: '$msg',
        originalContent: 'hello',
        currentContent: 'hello',
      },
      onSaveEdit,
      onClearEdit,
    });

    const textarea = screen.getByRole('combobox');
    await user.clear(textarea);
    await user.type(textarea, 'still editing{Enter}');

    await waitFor(() => {
      expect(onSaveEdit).toHaveBeenCalledWith('$msg', 'still editing');
    });
    expect(onClearEdit).not.toHaveBeenCalled();
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    expect(textarea).toHaveValue('still editing');
  });
});
