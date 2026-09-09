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

const ALICE = 'alice';
const BOB = 'bob';

function dmMessage(contactId: string, sender: string, content: string) {
  return {
    id: `${contactId}-${content}`,
    channelId: contactId,
    sender,
    content,
    timestamp: new Date('2024-01-01T00:00:00Z'),
    matrixEventId: `$${contactId}-${content}`,
  };
}

function openBothDms() {
  return renderConnectedApp({
    joinedChannelId: '7',
    channels: [{ id: 7, name: 'General' }],
    dmContacts: [
      { id: ALICE, name: 'Alice', isEphemeral: true, mumbleSessionId: 11 },
      { id: BOB, name: 'Bob', isEphemeral: true, mumbleSessionId: 22 },
    ],
    dmMessages: {
      [ALICE]: [dmMessage(ALICE, 'Alice', 'hello from alice')],
      [BOB]: [dmMessage(BOB, 'Bob', 'hello from bob')],
    },
  });
}

/**
 * Activating an existing DM tab used to move only `workspace.activeKey`. The DM store
 * kept whatever contact was selected last, so the tab said "Alice" while the store —
 * which owns the history, the outgoing send target and the reaction target — still
 * pointed at Bob.
 */
describe('DM tab activation drives the DM store', () => {
  it('renders the activated tab\'s history, not the last-selected contact\'s', async () => {
    const user = userEvent.setup();
    openBothDms();

    await user.click(screen.getByRole('button', { name: /^Alice/ }));
    expect(screen.getByText('hello from alice')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Bob/ }));
    expect(screen.getByText('hello from bob')).toBeInTheDocument();

    // Back to Alice's ALREADY OPEN tab: this is the path that only moved activeKey.
    await user.click(screen.getByRole('tab', { name: /Alice/ }));
    expect(screen.getByText('hello from alice')).toBeInTheDocument();
    expect(screen.queryByText('hello from bob')).not.toBeInTheDocument();
  });

  it('sends a message to the activated tab\'s contact', async () => {
    const user = userEvent.setup();
    const { dmSends } = openBothDms();

    await user.click(screen.getByRole('button', { name: /^Alice/ }));
    await user.click(screen.getByRole('button', { name: /^Bob/ }));
    await user.click(screen.getByRole('tab', { name: /Alice/ }));

    await user.type(screen.getByPlaceholderText('Message @Alice'), 'for alice only{Enter}');

    expect(dmSends).toEqual([{ content: 'for alice only', contactId: ALICE }]);
  });

  it('targets the activated tab\'s contact when toggling a reaction', async () => {
    const user = userEvent.setup();
    const { matrixClient, props } = renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      dmContacts: [
        { id: '@alice:example.com', name: 'Alice' },
        { id: '@bob:example.com', name: 'Bob' },
      ],
      dmRoomMap: {
        '@alice:example.com': '!alice:example.com',
        '@bob:example.com': '!bob:example.com',
      },
      dmMessages: {
        '@alice:example.com': [dmMessage('@alice:example.com', 'Alice', 'react to me')],
        '@bob:example.com': [dmMessage('@bob:example.com', 'Bob', 'not this one')],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Others' }));
    await user.click(screen.getByRole('button', { name: /^Alice/ }));
    await user.click(screen.getByRole('button', { name: /^Bob/ }));
    await user.click(screen.getByRole('tab', { name: /Alice/ }));

    const onToggleReaction = props('ChatPanel:dm')?.onToggleReaction as (
      channelId: string, messageId: string, emoji: string, reacted: boolean,
    ) => Promise<void>;
    expect(onToggleReaction).toBeTypeOf('function');
    await onToggleReaction('', '$alice-event', '👍', false);

    expect(matrixClient.sendReaction).toHaveBeenCalledWith('@alice:example.com', '$alice-event', '👍');
  });
});
