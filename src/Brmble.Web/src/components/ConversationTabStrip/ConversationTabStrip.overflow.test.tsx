import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConversationTabStrip } from './ConversationTabStrip';

const tab = (n: number) => ({
  conversation: { kind: 'channel' as const, channelId: String(n) },
  key: `channel:${n}`, label: `channel-number-${n}`, isHome: false, unreadCount: 0, mentionCount: 0,
});
const home = {
  conversation: { kind: 'channel' as const, channelId: '0' },
  key: 'channel:0', label: 'General', isHome: true, unreadCount: 0, mentionCount: 0,
};

describe('ConversationTabStrip overflow', () => {
  it('keeps the home tab outside the scrolling container', () => {
    render(<ConversationTabStrip tabs={[home, ...Array.from({ length: 30 }, (_, i) => tab(i + 1))]}
      activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    const scroller = screen.getByTestId('conversation-tab-scroller');
    expect(within(scroller).queryByRole('tab', { name: /General/ })).not.toBeInTheDocument();
    expect(within(scroller).getAllByRole('tab')).toHaveLength(30);
  });

  it('exposes the scroller as horizontally scrollable and keyboard reachable', () => {
    render(<ConversationTabStrip tabs={[home, ...Array.from({ length: 30 }, (_, i) => tab(i + 1))]}
      activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    const scroller = screen.getByTestId('conversation-tab-scroller');
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(scroller).toHaveAttribute('aria-label', 'Scroll conversations');
  });

  it('truncates long labels rather than wrapping', () => {
    render(<ConversationTabStrip tabs={[home, tab(1)]} activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    const label = screen.getByText('channel-number-1');
    expect(label.className).toMatch(/text/);
  });

  it('still renders a single home tab without a scroller wrapper collapsing it', () => {
    render(<ConversationTabStrip tabs={[home]} activeKey="channel:0" onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /General/ })).toBeInTheDocument();
    expect(within(screen.getByTestId('conversation-tab-scroller')).queryAllByRole('tab')).toHaveLength(0);
  });
});
