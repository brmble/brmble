import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { HARNESS_SERVER_ADDRESS, renderConnectedApp, resetAppHarness } from './testing/appHarness';
import { loadConversationTabs } from './workspace/conversationStorage';
import { conversationKey } from './workspace/conversation';

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

const storedKeys = () => loadConversationTabs(HARNESS_SERVER_ADDRESS, () => true).map(conversationKey);

describe('restoring persisted dm tabs', () => {
  it('drops a persisted dm tab whose contact no longer resolves', () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      persistedTabs: [{ kind: 'dm', contactId: '@2:localhost' }],
      dmContacts: [],
    });

    expect(screen.queryByRole('tab', { name: /@2:localhost/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('does not re-persist a dropped dm tab', () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      persistedTabs: [{ kind: 'dm', contactId: '@2:localhost' }],
      dmContacts: [],
    });

    expect(storedKeys()).not.toContain('dm:@2:localhost');
  });

  it('keeps a persisted dm tab whose contact only resolves after channels arrive', () => {
    const { setDmContacts, emitCredentials } = renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      persistedTabs: [{ kind: 'dm', contactId: '@alice:example.com' }],
      dmContacts: [],
      deferCredentials: true,
    });

    // Channels and presence have landed but no DM identity data has: validating now
    // would reject a perfectly good tab, so nothing may be dropped yet.
    expect(storedKeys()).toContain('dm:@alice:example.com');

    setDmContacts([{ id: '@alice:example.com', name: 'Alice' }]);
    emitCredentials();

    expect(screen.getByRole('tab', { name: /Alice/ })).toBeInTheDocument();
    expect(storedKeys()).toContain('dm:@alice:example.com');
  });

  it('keeps a persisted dm tab that resolves only through the server dm room map', () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      persistedTabs: [{ kind: 'dm', contactId: '@alice:example.com' }],
      dmContacts: [],
      dmRoomMap: { '@alice:example.com': '!alice:example.com' },
    });

    expect(storedKeys()).toContain('dm:@alice:example.com');
  });

  it('keeps a persisted dm tab that resolves only through the server directory', () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      persistedTabs: [{ kind: 'dm', contactId: '@alice:example.com' }],
      dmContacts: [],
      userMappings: { Alice: '@alice:example.com' },
    });

    expect(storedKeys()).toContain('dm:@alice:example.com');
  });

  it('drops a dm tab whose contact stops resolving after the restore', () => {
    const { setDmContacts } = renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      persistedTabs: [{ kind: 'dm', contactId: '@alice:example.com' }],
      dmContacts: [{ id: '@alice:example.com', name: 'Alice' }],
    });
    expect(screen.getByRole('tab', { name: /Alice/ })).toBeInTheDocument();

    setDmContacts([]);

    expect(screen.queryByRole('tab', { name: /Alice/ })).not.toBeInTheDocument();
    expect(storedKeys()).not.toContain('dm:@alice:example.com');
  });
});

describe('closing a dm contact', () => {
  it('invalidates its tab even when that tab is not the active one', () => {
    const { props } = renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Random' }],
      persistedTabs: [
        { kind: 'dm', contactId: '@alice:example.com' },
        { kind: 'channel', channelId: '9' },
      ],
      dmContacts: [{ id: '@alice:example.com', name: 'Alice' }],
    });

    expect(screen.getByRole('tab', { name: /Alice/ })).toHaveAttribute('aria-selected', 'false');

    const onCloseConversation = props('DMContactList')?.onCloseConversation as (id: string) => void;
    act(() => { onCloseConversation('@alice:example.com'); });

    expect(screen.queryByRole('tab', { name: /Alice/ })).not.toBeInTheDocument();
  });
});
