import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderConnectedApp, resetAppHarness } from './testing/appHarness';

// The real ChatPanel observes its scroller; jsdom ships neither observer.
beforeAll(() => {
  class ObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ObserverMock);
  vi.stubGlobal('IntersectionObserver', ObserverMock);
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  resetAppHarness();
  localStorage.clear();
});

describe('conversation region', () => {
  it('shows only the home tab on connect', () => {
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /General \(you are here\)/ })).toBeInTheDocument();
  });

  it('opens a tab when browsing another channel and switches the chat body', async () => {
    const user = userEvent.setup();
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }] });
    await user.click(screen.getByRole('button', { name: /Random/ }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /Random/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByPlaceholderText('Message #Random')).toBeInTheDocument();
  });

  it('opens a dm in the same strip', async () => {
    const user = userEvent.setup();
    renderConnectedApp({ joinedChannelId: '7', dmContacts: [{ id: 'a', name: 'Alice' }] });
    // Non-recent contacts live in the collapsed "Others" section.
    await user.click(screen.getByRole('button', { name: 'Others' }));
    await user.click(screen.getByRole('button', { name: /Alice/ }));
    expect(screen.getByRole('tab', { name: /Alice/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('replaces the home tab when the user moves voice channel', async () => {
    const { moveSelfToChannel } = renderConnectedApp({
      joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 12, name: 'Gaming' }],
    });
    moveSelfToChannel(12);
    expect(screen.getByRole('tab', { name: /Gaming \(you are here\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /General/ })).not.toBeInTheDocument();
  });

  it('keeps browsed tabs across a voice channel move', async () => {
    const user = userEvent.setup();
    const { moveSelfToChannel } = renderConnectedApp({
      joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }, { id: 12, name: 'Gaming' }],
    });
    await user.click(screen.getByRole('button', { name: /Random/ }));
    moveSelfToChannel(12);
    expect(screen.getByRole('tab', { name: /Random/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Gaming \(you are here\)/ })).toBeInTheDocument();
  });

  it('closes a tab and falls back to a neighbour', async () => {
    const user = userEvent.setup();
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }] });
    await user.click(screen.getByRole('button', { name: /Random/ }));
    await user.click(screen.getByRole('button', { name: 'Close Random' }));
    expect(screen.queryByRole('tab', { name: /Random/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /General/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('restores persisted tabs on reconnect and drops invalid ones', () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }],
      persistedTabs: [{ kind: 'channel', channelId: '9' }, { kind: 'channel', channelId: '404' }],
    });
    expect(screen.getByRole('tab', { name: /Random/ })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('keeps a browsed channel writable when the server permits it', async () => {
    const user = userEvent.setup();
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random', canSendChat: true }],
    });
    await user.click(screen.getByRole('button', { name: /Random/ }));
    expect(screen.getByPlaceholderText('Message #Random')).toBeEnabled();
  });

  it('blocks sending in a browsed channel the server disallows', async () => {
    const user = userEvent.setup();
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random', canSendChat: false }],
    });
    await user.click(screen.getByRole('button', { name: /Random/ }));
    expect(screen.getByRole('tab', { name: /Random/ })).toHaveAttribute('aria-selected', 'true');
    // MessageInput replaces the placeholder while disabled (pre-existing behaviour),
    // so the composer is identified by that copy rather than "Message #Random".
    expect(screen.getByPlaceholderText('User is offline')).toBeDisabled();
  });

  it('shows the root chat as the home tab at server root', () => {
    renderConnectedApp({ joinedChannelId: 'server-root', serverLabel: 'Brmble' });
    expect(screen.getByRole('tab', { name: /Brmble \(you are here\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });

  it('renders no unread badge on the root home tab', () => {
    renderConnectedApp({ joinedChannelId: 'server-root', serverLabel: 'Brmble' });
    const homeTab = screen.getByRole('tab', { name: /Brmble \(you are here\)/ });
    expect(homeTab.textContent).toBe('BrmbleBrmble (you are here)');
  });
});
