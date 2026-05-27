import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from './MessageBubble';
import { ServiceStatusProvider } from '../../hooks/useServiceStatus';

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
});
