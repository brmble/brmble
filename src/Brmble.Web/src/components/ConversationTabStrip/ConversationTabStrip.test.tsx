import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConversationTabStrip } from './ConversationTabStrip';

const home = {
  conversation: { kind: 'channel' as const, channelId: '7' },
  key: 'channel:7', label: 'General', isHome: true, unreadCount: 0, mentionCount: 0,
};
const browsed = {
  conversation: { kind: 'channel' as const, channelId: '9' },
  key: 'channel:9', label: 'Random', isHome: false, unreadCount: 3, mentionCount: 0,
};
const contact = {
  conversation: { kind: 'dm' as const, contactId: 'a' },
  key: 'dm:a', label: 'Alice', isHome: false, unreadCount: 0, mentionCount: 1,
};

const renderStrip = (overrides = {}) => {
  const props = { tabs: [home, browsed, contact], activeKey: 'channel:7', onActivate: vi.fn(), onClose: vi.fn(), ...overrides };
  render(<ConversationTabStrip {...props} />);
  return props;
};

describe('ConversationTabStrip', () => {
  it('renders every tab with the home tab first and selected state', () => {
    renderStrip();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual([
      expect.stringContaining('General'),
      expect.stringContaining('Random'),
      expect.stringContaining('Alice'),
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('gives the home tab no close control', () => {
    renderStrip();
    expect(screen.queryByRole('button', { name: 'Close General' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Random' })).toBeInTheDocument();
  });

  it('marks the home tab in its accessible name', () => {
    renderStrip();
    expect(screen.getByRole('tab', { name: /General \(you are here\)/ })).toBeInTheDocument();
  });

  it('activates on click', () => {
    const props = renderStrip();
    fireEvent.click(screen.getByRole('tab', { name: /Random/ }));
    expect(props.onActivate).toHaveBeenCalledWith('channel:9');
  });

  it('closes without activating', () => {
    const props = renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'Close Random' }));
    expect(props.onClose).toHaveBeenCalledWith('channel:9');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('shows unread and mention counts', () => {
    renderStrip();
    expect(screen.getByRole('tab', { name: /Random/ })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /Alice/ })).toHaveTextContent('@1');
  });

  it('hides a zero unread count', () => {
    renderStrip({ tabs: [home] });
    expect(screen.getByRole('tab', { name: /General/ })).not.toHaveTextContent('0');
  });

  it('moves between tabs with the arrow keys', () => {
    const props = renderStrip();
    fireEvent.keyDown(screen.getByRole('tab', { name: /General/ }), { key: 'ArrowRight' });
    expect(props.onActivate).toHaveBeenCalledWith('channel:9');
  });

  it('wraps at both ends', () => {
    const props = renderStrip({ activeKey: 'dm:a' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alice/ }), { key: 'ArrowRight' });
    expect(props.onActivate).toHaveBeenCalledWith('channel:7');
  });

  it('closes the focused tab with Delete but never the home tab', () => {
    const props = renderStrip({ activeKey: 'channel:9' });
    fireEvent.keyDown(screen.getByRole('tab', { name: /Random/ }), { key: 'Delete' });
    expect(props.onClose).toHaveBeenCalledWith('channel:9');
    fireEvent.keyDown(screen.getByRole('tab', { name: /General/ }), { key: 'Delete' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there are no tabs', () => {
    render(<ConversationTabStrip tabs={[]} activeKey={null} onActivate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
