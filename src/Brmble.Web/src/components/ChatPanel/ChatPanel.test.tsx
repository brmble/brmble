import { render, screen } from '@testing-library/react';
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
