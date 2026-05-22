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
  it('renders a deleted placeholder when message is redacted', () => {
    renderBubble({ content: '', redacted: true });
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
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
});
