import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

class ResizeObserverMock {
  observe() {}
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

describe('ChatPanel typing indicator', () => {
  it('renders the active typing label in a polite status region', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="General"
        messages={[]}
        currentUsername="Me"
        onSendMessage={vi.fn()}
        matrixRoomId="!room:example.com"
        typingLabel="Alice is typing..."
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Alice is typing...');
  });

  it('renders an empty status region when nobody is typing', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="General"
        messages={[]}
        currentUsername="Me"
        onSendMessage={vi.fn()}
        matrixRoomId="!room:example.com"
        typingLabel=""
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
