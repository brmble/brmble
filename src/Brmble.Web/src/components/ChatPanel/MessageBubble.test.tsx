import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';

vi.mock('./ImageAttachment', () => ({
  ImageAttachment: () => <div data-testid="image-attachment" />,
}));

vi.mock('./LinkPreview', () => ({
  LinkPreview: () => <div data-testid="link-preview" />,
}));

vi.mock('../Avatar/Avatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

describe('MessageBubble redacted rendering', () => {
  it('renders a deleted placeholder and hides original content affordances', () => {
    render(
      <MessageBubble
        sender="Alice"
        content="secret https://example.com"
        timestamp={new Date('2026-05-14T10:00:00Z')}
        redacted
        media={[{ type: 'image', url: 'mxc://image' }]}
        replyToEventId="$parent"
        replyToSender="Bob"
        replyToContent="parent text"
        matrixClient={{} as never}
      />,
    );

    expect(screen.getByText('Message deleted')).toBeInTheDocument();
    expect(screen.queryByText('secret https://example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('parent text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-attachment')).not.toBeInTheDocument();
    expect(screen.queryByTestId('link-preview')).not.toBeInTheDocument();
  });
});
