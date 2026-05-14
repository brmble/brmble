import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage } from '../../types';

const confirmMock = vi.fn();

vi.mock('../../hooks/usePrompt', () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}));

vi.mock('../Avatar/Avatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

vi.mock('../ScreenShareGrid', () => ({
  ScreenShareGrid: () => <div data-testid="screen-share-grid" />,
}));

const baseMessage: ChatMessage = {
  id: '$own',
  channelId: '42',
  sender: 'Alice',
  senderMatrixUserId: '@alice:example.com',
  content: 'hello',
  timestamp: new Date('2026-05-14T10:00:00Z'),
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  return render(
    <ChatPanel
      channelId="42"
      channelName="General"
      messages={[baseMessage]}
      currentUsername="Alice"
      onSendMessage={vi.fn()}
      onCopyToClipboard={vi.fn()}
      onDeleteMessage={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

describe('ChatPanel message deletion', () => {
  beforeEach(() => {
    confirmMock.mockReset();
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows Delete for own persisted messages and calls onDeleteMessage after confirmation', async () => {
    const user = userEvent.setup();
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);
    renderPanel({ onDeleteMessage });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('hello') });
    await user.click(screen.getByText('Delete'));

    expect(confirmMock).toHaveBeenCalledWith({
      title: 'Delete this message?',
      message: 'This will remove the message for everyone in this chat.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    await waitFor(() => expect(onDeleteMessage).toHaveBeenCalledWith('42', '$own'));
  });

  it('does not call onDeleteMessage when deletion is cancelled', async () => {
    const user = userEvent.setup();
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(false);
    renderPanel({ onDeleteMessage });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('hello') });
    await user.click(screen.getByText('Delete'));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(onDeleteMessage).not.toHaveBeenCalled();
  });

  it('does not show Delete for other users messages', async () => {
    const user = userEvent.setup();
    renderPanel({
      messages: [{ ...baseMessage, id: '$other', sender: 'Bob', senderMatrixUserId: '@bob:example.com' }],
    });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('hello') });

    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.getByText('Send DM')).toBeInTheDocument();
  });

  it('does not show Delete for pending messages without a Matrix event id', async () => {
    const user = userEvent.setup();
    renderPanel({
      messages: [{ ...baseMessage, id: 'temp-1', pending: true }],
    });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('hello') });

    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('does not show Delete for own messages without a Matrix event id', async () => {
    const user = userEvent.setup();
    renderPanel({
      messages: [{ ...baseMessage, id: 'local-1' }],
    });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('hello') });

    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });
});
