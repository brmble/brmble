import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from './MessageBubble';
import { ServiceStatusProvider } from '../../hooks/useServiceStatus';

const paint = vi.hoisted(() => ({
  getSummary: vi.fn(),
}));

vi.mock('../../api/paint', () => ({ paintApi: paint }));

const baseMessage = {
  sender: 'Alice',
  content: 'hello',
  timestamp: new Date(),
  messageId: 'msg1',
  isOwnMessage: false,
};

function renderBubble(props: Partial<React.ComponentProps<typeof MessageBubble>>) {
  return render(
    <ServiceStatusProvider>
      <MessageBubble {...baseMessage} {...props} />
    </ServiceStatusProvider>
  );
}

describe('MessageBubble', () => {
  it('renders deleted placeholder when message is redacted', () => {
    renderBubble({ content: '', redacted: true });
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(screen.getByText('Message deleted')).toHaveClass('message-text--deleted');
  });

  it('renders an edited indicator next to edited messages', () => {
    renderBubble({ edited: true, timestamp: new Date('2026-05-22T10:15:00') });
    expect(screen.getByText(/\(edited\)$/)).toBeInTheDocument();
  });

  it('renders reaction badges and handles toggles', async () => {
    const onToggleReaction = vi.fn();
    const reactions = { '👍': ['user1', 'user2'], '😂': ['user1'] };

    renderBubble({
      reactions,
      currentUserMatrixId: 'user1',
      onToggleReaction,
    });

    const thumbsUp = screen.getByRole('button', { name: /👍 2/ });
    expect(thumbsUp).toHaveClass('reacted');

    const laugh = screen.getByRole('button', { name: /😂 1/ });
    expect(laugh).toHaveClass('reacted');

    await userEvent.click(thumbsUp);
    expect(onToggleReaction).toHaveBeenCalledWith('msg1', '👍', true);
  });

  it('renders the oversized mumble indicator for image messages', () => {
    renderBubble({
      content: '',
      media: [{ type: 'image', url: 'blob://image', mimetype: 'image/png', size: 123 }],
      mumbleDelivery: 'too-large',
    });

    expect(screen.getByLabelText('Image was not sent to the Mumble client')).toBeInTheDocument();
  });

  it('shows the oversized mumble tooltip copy on hover', async () => {
    const user = userEvent.setup();

    renderBubble({
      content: '',
      media: [{ type: 'image', url: 'blob://image', mimetype: 'image/png', size: 123 }],
      mumbleDelivery: 'too-large',
    });

    await user.hover(screen.getByLabelText('Image was not sent to the Mumble client'));

    expect(await screen.findByText('Image is too large to send to the Mumble client.')).toBeInTheDocument();
  });

  it('does not show failed-send overlay for too-large mumble state by itself', () => {
    renderBubble({
      content: '',
      media: [{ type: 'image', url: 'blob://image', mimetype: 'image/png', size: 123 }],
      mumbleDelivery: 'too-large',
    });

    expect(screen.queryByText('Failed to send')).not.toBeInTheDocument();
  });

  it('drives paint invitation actions from the server summary instead of embedded identities', async () => {
    const user = userEvent.setup();
    const onJoinPaint = vi.fn().mockResolvedValue(undefined);
    const onOpenPaint = vi.fn();
    paint.getSummary
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        channelId: 5,
        hostUserId: 7,
        status: 'active',
        canJoin: true,
        isParticipant: false,
      })
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        channelId: 5,
        hostUserId: 7,
        status: 'active',
        canJoin: true,
        isParticipant: true,
      });

    renderBubble({
      content: '[brmble-paint]{"sessionId":"session-1","hostUserId":7,"participantUserIds":[999],"channelId":5,"status":"active"}',
      currentUserId: 8,
      users: [{ session: 8, name: 'Bob', channelId: 5 }],
      onJoinPaint,
      onOpenPaint,
    });

    await user.click(await screen.findByRole('button', { name: 'Join paint' }));

    expect(onJoinPaint).toHaveBeenCalledWith('session-1');
    expect(onOpenPaint).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Open paint' }));

    expect(onOpenPaint).toHaveBeenCalledWith('session-1');
  });

  it('refreshes a paint invitation when the current user joins its voice channel', async () => {
    paint.getSummary.mockReset();
    paint.getSummary
      .mockRejectedValueOnce(new Error('not in voice channel'))
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        channelId: 5,
        hostUserId: 7,
        status: 'active',
        canJoin: true,
        isParticipant: false,
      });

    const paintProps = {
      content: '[brmble-paint]{"version":2,"sessionId":"session-1","channelId":5,"status":"active"}',
      currentUserId: 8,
      users: [{ session: 8, name: 'Bob', channelId: 2 }],
      onJoinPaint: vi.fn(),
      onOpenPaint: vi.fn(),
    };
    const { rerender } = renderBubble(paintProps);

    expect(await screen.findByText('Session is unavailable')).toBeInTheDocument();

    rerender(
      <ServiceStatusProvider>
        <MessageBubble
          {...baseMessage}
          {...paintProps}
          users={[{ session: 8, name: 'Bob', channelId: 5 }]}
        />
      </ServiceStatusProvider>,
    );

    await waitFor(() => expect(paint.getSummary).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Join paint' })).toBeEnabled();
  });
});
