import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IntersectionObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('ChatPanel typing indicator', () => {
  it('renders the typing indicator above the composer when text is present', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[]}
        onSendMessage={() => {}}
        typingIndicatorText="Alice is typing..."
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Alice is typing...');
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(status.compareDocumentPosition(sendButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the typing status element when there is no typing text', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[]}
        onSendMessage={() => {}}
        typingIndicatorText={null}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ChatPanel edit flow', () => {
  it('sends a Matrix replacement event when saving an edited message', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue({ event_id: '$edit' });
    const matrixClient = {
      sendMessage,
      getRoom: vi.fn().mockReturnValue(null),
    } as never;

    render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[{
          id: '$msg',
          channelId: '42',
          sender: 'Alice',
          senderMatrixUserId: '@alice:example.com',
          content: 'hello',
          timestamp: new Date('2026-05-22T11:02:00.000Z'),
          msgType: 'm.text',
        }]}
        currentUsername="Alice"
        currentUserMatrixId="@alice:example.com"
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        matrixClient={matrixClient}
        matrixRoomId="!room:example.com"
      />,
    );

    const message = screen.getByText('hello');
    fireEvent.contextMenu(message, { clientX: 50, clientY: 60 });
    await user.click(screen.getByRole('button', { name: 'Edit message' }));

    const textarea = screen.getByRole('combobox');
    await waitFor(() => expect(textarea).toHaveValue('hello'));
    await user.clear(textarea);
    await user.type(textarea, 'hello again{Enter}');

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('!room:example.com', expect.objectContaining({
        msgtype: 'm.text',
        body: '* hello again',
        'm.new_content': {
          msgtype: 'm.text',
          body: 'hello again',
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: '$msg',
        },
      }));
    });
  });

  it('still attempts to save an in-progress edit when live eligibility props change after edit mode opens', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue({ event_id: '$edit' });
    const matrixClient = {
      sendMessage,
      getRoom: vi.fn().mockReturnValue(null),
    } as never;

    const message = {
      id: '$msg',
      channelId: '42',
      sender: 'Alice',
      senderMatrixUserId: '@alice:example.com',
      content: 'hello',
      timestamp: new Date('2026-05-22T11:02:00.000Z'),
      msgType: 'm.text' as const,
    };

    const { rerender } = render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[message]}
        currentUsername="Alice"
        currentUserMatrixId="@alice:example.com"
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        matrixClient={matrixClient}
        matrixRoomId="!room:example.com"
      />,
    );

    fireEvent.contextMenu(screen.getByText('hello'), { clientX: 50, clientY: 60 });
    await user.click(screen.getByRole('button', { name: 'Edit message' }));

    rerender(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[message]}
        currentUsername="Alice"
        currentUserMatrixId={undefined}
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        matrixClient={matrixClient}
        matrixRoomId="!room:example.com"
      />,
    );

    const textarea = screen.getByRole('combobox');
    await waitFor(() => expect(textarea).toHaveValue('hello'));
    await user.clear(textarea);
    await user.type(textarea, 'hello again{Enter}');

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith('!room:example.com', expect.objectContaining({
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: '$msg',
        },
      }));
    });
  });
});
