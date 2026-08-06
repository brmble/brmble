import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { confirm } from '../../hooks/usePrompt';
import { MessageDeletionError } from '../../api/messages';

vi.mock('../../hooks/usePrompt', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/usePrompt')>('../../hooks/usePrompt');
  return { ...actual, confirm: vi.fn() };
});

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

describe('ChatPanel image paint background menu', () => {
  const image = {
    type: 'image' as const,
    url: 'https://matrix.example/shared.png',
    filename: 'shared.png',
    mimetype: 'image/png',
    size: 123,
  };
  const imageMessage = {
    id: '$image',
    channelId: '42',
    sender: 'Alice',
    content: '',
    timestamp: new Date(),
    msgType: 'm.image',
    media: [image],
  };

  it('shows the image action and preserves normal message actions', async () => {
    const user = userEvent.setup();
    const onUseAsPaintBackground = vi.fn();
    const { container } = render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[imageMessage]}
        onSendMessage={() => {}}
        onCopyToClipboard={() => {}}
        onUseAsPaintBackground={onUseAsPaintBackground}
      />,
    );

    const imageButton = container.querySelector('.image-attachment');
    expect(imageButton).not.toBeNull();
    fireEvent.load(container.querySelector('.image-attachment__img')!);
    fireEvent.contextMenu(imageButton!, { clientX: 40, clientY: 50 });

    expect(screen.getByRole('button', {
      name: 'Use as paint background',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reply' }))
      .toBeInTheDocument();

    await user.click(screen.getByRole('button', {
      name: 'Use as paint background',
    }));
    expect(onUseAsPaintBackground).toHaveBeenCalledWith(image);
  });

  it('does not expose the action until the image has loaded', () => {
    const { container } = render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[imageMessage]}
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        onUseAsPaintBackground={() => {}}
      />,
    );

    fireEvent.contextMenu(
      container.querySelector('.image-attachment')!,
      { clientX: 40, clientY: 50 },
    );

    expect(screen.queryByRole('button', {
      name: 'Use as paint background',
    })).not.toBeInTheDocument();
  });

  it('does not offer an unsupported GIF as a Paint background', () => {
    const gif = {
      type: 'gif' as const,
      url: 'https://matrix.example/animated.gif',
      filename: 'animated.gif',
      mimetype: 'image/gif',
      size: 123,
    };
    const { container } = render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[{
          ...imageMessage,
          id: '$gif',
          media: [gif],
        }]}
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        onUseAsPaintBackground={() => {}}
      />,
    );

    fireEvent.load(container.querySelector('.image-attachment__img')!);
    fireEvent.contextMenu(container.querySelector('.image-attachment')!, {
      clientX: 40,
      clientY: 50,
    });

    expect(screen.queryByRole('button', {
      name: 'Use as paint background',
    })).not.toBeInTheDocument();
  });

  it('does not show the action for a plain-text message', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[{
          ...imageMessage,
          id: '$text',
          content: 'hello',
          msgType: 'm.text',
          media: undefined,
        }]}
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        onUseAsPaintBackground={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByText('hello'), {
      clientX: 40,
      clientY: 50,
    });
    expect(screen.queryByRole('button', {
      name: 'Use as paint background',
    })).not.toBeInTheDocument();
  });

  it('does not show the action for a redacted image message', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[{ ...imageMessage, redacted: true }]}
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        onUseAsPaintBackground={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByText('Message deleted'), {
      clientX: 40,
      clientY: 50,
    });
    expect(screen.queryByRole('button', {
      name: 'Use as paint background',
    })).not.toBeInTheDocument();
  });

  it('removes the action when the image is unavailable', () => {
    const { container } = render(
      <ChatPanel
        channelId="42"
        channelName="general"
        messages={[imageMessage]}
        onSendMessage={() => {}}
        onMessageContextMenu={() => {}}
        onUseAsPaintBackground={() => {}}
      />,
    );

    fireEvent.error(container.querySelector('.image-attachment__img')!);
    fireEvent.contextMenu(screen.getByText('Failed to load image'), {
      clientX: 40,
      clientY: 50,
    });

    expect(screen.queryByRole('button', {
      name: 'Use as paint background',
    })).not.toBeInTheDocument();
  });
});

const recentOwnMessage = {
  id: '$message', channelId: '42', sender: 'Alice', senderMatrixUserId: '@alice:test',
  content: 'delete me', timestamp: new Date(Date.now() - 3_600_000), msgType: 'm.text' as const,
};

describe('ChatPanel message deletion', () => {
  beforeEach(() => vi.mocked(confirm).mockReset());

  it('shows Delete message for an eligible author', () => {
    render(<ChatPanel channelId="42" channelName="general" matrixRoomId="!general:test" messages={[recentOwnMessage]} currentUserMatrixId="@alice:test" onSendMessage={() => {}} onDeleteMessage={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText('delete me'), { clientX: 50, clientY: 60 });
    expect(screen.getByRole('button', { name: 'Delete message' })).toBeInTheDocument();
  });

  it('hides Delete message for another user without admin permission', () => {
    render(<ChatPanel channelId="42" channelName="general" matrixRoomId="!general:test" messages={[{ ...recentOwnMessage, sender: 'Bob', senderMatrixUserId: '@bob:test' }]} currentUserMatrixId="@alice:test" canModerateRecentMessages={false} onSendMessage={() => {}} onDeleteMessage={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText('delete me'), { clientX: 50, clientY: 60 });
    expect(screen.queryByRole('button', { name: 'Delete message' })).not.toBeInTheDocument();
  });

  it('shows Delete message to an administrator for another author', () => {
    render(<ChatPanel channelId="42" channelName="general" matrixRoomId="!general:test" messages={[{ ...recentOwnMessage, sender: 'Bob', senderMatrixUserId: '@bob:test' }]} currentUserMatrixId="@alice:test" canModerateRecentMessages onSendMessage={() => {}} onDeleteMessage={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText('delete me'), { clientX: 50, clientY: 60 });
    expect(screen.getByRole('button', { name: 'Delete message' })).toBeInTheDocument();
  });

  it('confirms before invoking the delete callback', async () => {
    const user = userEvent.setup();
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(confirm).mockResolvedValue(true);
    render(<ChatPanel channelId="42" channelName="general" matrixRoomId="!general:test" messages={[recentOwnMessage]} currentUserMatrixId="@alice:test" onSendMessage={() => {}} onDeleteMessage={onDeleteMessage} />);
    fireEvent.contextMenu(screen.getByText('delete me'), { clientX: 50, clientY: 60 });
    await user.click(screen.getByRole('button', { name: 'Delete message' }));
    expect(confirm).toHaveBeenCalledWith({
      title: 'Delete message?',
      message: 'This message will be replaced with “Message deleted” for everyone.',
      confirmLabel: 'Delete message', cancelLabel: 'Cancel', destructive: true,
    });
    await waitFor(() => expect(onDeleteMessage).toHaveBeenCalledWith('!general:test', '$message'));
  });

  it('does not invoke deletion when confirmation is canceled', async () => {
    const user = userEvent.setup();
    const onDeleteMessage = vi.fn();
    vi.mocked(confirm).mockResolvedValue(false);
    render(<ChatPanel channelId="42" channelName="general" matrixRoomId="!general:test" messages={[recentOwnMessage]} currentUserMatrixId="@alice:test" onSendMessage={() => {}} onDeleteMessage={onDeleteMessage} />);
    fireEvent.contextMenu(screen.getByText('delete me'));
    await user.click(screen.getByRole('button', { name: 'Delete message' }));
    expect(onDeleteMessage).not.toHaveBeenCalled();
  });

  it('shows a clear server failure and locks duplicate clicks', async () => {
    const user = userEvent.setup();
    let rejectDelete!: (error: Error) => void;
    const onDeleteMessage = vi.fn(() => new Promise<void>((_, reject) => { rejectDelete = reject; }));
    vi.mocked(confirm).mockResolvedValue(true);
    render(<ChatPanel channelId="42" channelName="general" matrixRoomId="!general:test" messages={[recentOwnMessage]} currentUserMatrixId="@alice:test" onSendMessage={() => {}} onDeleteMessage={onDeleteMessage} />);
    fireEvent.contextMenu(screen.getByText('delete me'));
    await user.click(screen.getByRole('button', { name: 'Delete message' }));
    expect(onDeleteMessage).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(screen.getByText('delete me'));
    const lockedAction = screen.getByRole('button', { name: 'Deleting message…' });
    expect(lockedAction).toBeDisabled();
    await user.click(lockedAction);
    expect(onDeleteMessage).toHaveBeenCalledTimes(1);
    rejectDelete(new MessageDeletionError('Messages can only be deleted within 24 hours.', 'expired', 410));
    expect(await screen.findByRole('alert')).toHaveTextContent('Messages can only be deleted within 24 hours.');
  });

  it('uses the room captured before confirmation when navigation changes', async () => {
    const user = userEvent.setup();
    let resolveConfirm!: (accepted: boolean) => void;
    vi.mocked(confirm).mockReturnValue(new Promise(resolve => { resolveConfirm = resolve; }));
    const onDeleteMessage = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ChatPanel channelId="42" channelName="room A" matrixRoomId="!room-a:test" messages={[recentOwnMessage]} currentUserMatrixId="@alice:test" onSendMessage={() => {}} onDeleteMessage={onDeleteMessage} />);
    fireEvent.contextMenu(screen.getByText('delete me'));
    void user.click(screen.getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    rerender(<ChatPanel channelId="43" channelName="room B" matrixRoomId="!room-b:test" messages={[recentOwnMessage]} currentUserMatrixId="@alice:test" onSendMessage={() => {}} onDeleteMessage={onDeleteMessage} />);
    resolveConfirm(true);
    await waitFor(() => expect(onDeleteMessage).toHaveBeenCalledWith('!room-a:test', '$message'));
  });

  it('shows Message deleted in a reply strip when its target is redacted', () => {
    render(<ChatPanel channelId="42" channelName="general" messages={[{ ...recentOwnMessage, redacted: true, content: '' }, { ...recentOwnMessage, id: '$reply', content: 'reply body', replyToEventId: '$message' }]} onSendMessage={() => {}} />);
    expect(screen.getAllByText('Message deleted')).toHaveLength(2);
  });
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

describe('ChatPanel message scrolling', () => {
  it('scrolls to a new message when the user was already at the bottom', () => {
    vi.useFakeTimers();
    try {
      const messages = [{
        id: '$first',
        channelId: '42',
        sender: 'Alice',
        content: 'first',
        timestamp: new Date('2026-01-01T00:00:00Z'),
        msgType: 'm.text' as const,
      }];
      const { container, rerender } = render(
        <ChatPanel
          channelId="42"
          channelName="general"
          messages={messages}
          onSendMessage={() => {}}
        />,
      );
      const messagesContainer = container.querySelector('.chat-messages') as HTMLDivElement;
      Object.defineProperties(messagesContainer, {
        clientHeight: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 100 },
        scrollTop: { configurable: true, writable: true, value: 0 },
      });
      fireEvent.scroll(messagesContainer);
      vi.clearAllMocks();

      Object.defineProperty(messagesContainer, 'scrollHeight', { configurable: true, value: 300 });
      rerender(
        <ChatPanel
          channelId="42"
          channelName="general"
          messages={[...messages, {
            id: '$second',
            channelId: '42',
            sender: 'Bob',
            content: 'second',
            timestamp: new Date('2026-01-01T00:01:00Z'),
            msgType: 'm.text' as const,
          }]}
          onSendMessage={() => {}}
        />,
      );

      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
          timestamp: new Date(),
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
      timestamp: new Date(),
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
