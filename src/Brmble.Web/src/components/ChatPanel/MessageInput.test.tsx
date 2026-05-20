import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
