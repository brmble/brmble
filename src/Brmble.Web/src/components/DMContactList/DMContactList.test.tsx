import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import bridge from '../../bridge';
import { DMContactList } from './DMContactList';
import type { DMContact } from '../../hooks/useDMStore';

vi.mock('../../bridge', () => ({
  default: {
    send: vi.fn(),
  },
}));

vi.mock('../Avatar/Avatar', () => ({
  default: ({ isMumbleOnly }: { isMumbleOnly?: boolean }) => (
    <span data-testid={isMumbleOnly ? 'mumble-avatar' : 'matrix-avatar'} />
  ),
}));

const matrixContact: DMContact = {
  id: '@val:example.com',
  displayName: 'Vanilla Val',
  unreadCount: 2,
  lastMessage: 'persistent preview',
  lastMessageTime: 1000,
  onlineSessionId: 33,
};

const offlineMatrixContact: DMContact = {
  id: '@offline:example.com',
  displayName: 'Offline Olive',
  unreadCount: 0,
};

const mumbleContact: DMContact = {
  id: 'cert-val',
  displayName: 'Vanilla Val',
  unreadCount: 1,
  lastMessage: 'ephemeral preview',
  lastMessageTime: 2000,
  isEphemeral: true,
  mumbleCertHash: 'cert-val',
  mumbleSessionId: 44,
};

function renderList(contacts: DMContact[] = [matrixContact, mumbleContact]) {
  const onSelectContact = vi.fn();
  const onCloseConversation = vi.fn();

  const view = render(
    <DMContactList
      contacts={contacts}
      selectedUserId={null}
      onSelectContact={onSelectContact}
      onCloseConversation={onCloseConversation}
      onToggleVisibility={vi.fn()}
      visible={true}
    />,
  );

  return { ...view, onSelectContact, onCloseConversation };
}

describe('DMContactList directory behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('volume_44', '100');
    localStorage.setItem('volume_33', '100');
  });

  it('renders a registered standard-Mumble user as two visually distinct route entries', () => {
    renderList();

    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
    expect(screen.getByText('Mumble users')).toBeInTheDocument();
    expect(screen.getAllByText('Vanilla Val')).toHaveLength(2);
    expect(screen.getByText('persistent preview')).toBeInTheDocument();
    expect(screen.getByText('ephemeral preview')).toBeInTheDocument();
    expect(screen.getByText('mumble')).toBeInTheDocument();
    expect(screen.getByTestId('matrix-avatar')).toBeInTheDocument();
    expect(screen.getByTestId('mumble-avatar')).toBeInTheDocument();
  });

  it('keeps search results in their route sections when both routes match', async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByPlaceholderText('Search users...'), 'val');

    expect(screen.getAllByText('Vanilla Val')).toHaveLength(2);
    expect(screen.getByText('Mumble users')).toBeInTheDocument();
  });

  it('uses user-focused empty copy while searching the directory', async () => {
    const user = userEvent.setup();
    renderList();

    await user.type(screen.getByPlaceholderText('Search users...'), 'nobody');

    expect(screen.getByText('No matching users')).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  });

  it('selects the exact route ID that was clicked', async () => {
    const user = userEvent.setup();
    const { onSelectContact } = renderList();

    const buttons = screen.getAllByRole('button', { name: /Vanilla Val/ });

    await user.click(buttons[0]);
    await user.click(buttons[1]);

    expect(onSelectContact).toHaveBeenNthCalledWith(1, '@val:example.com', 'Vanilla Val');
    expect(onSelectContact).toHaveBeenNthCalledWith(2, 'cert-val', 'Vanilla Val');
  });

  it('opens user info for a Mumble route with the active Mumble session and selects the certificate route from the real dialog', async () => {
    const user = userEvent.setup();
    const { onSelectContact } = renderList();

    const mumbleButton = screen.getAllByRole('button', { name: /Vanilla Val/ })[1];
    fireEvent.contextMenu(mumbleButton);
    await user.click(screen.getByRole('button', { name: 'User Information' }));

    expect(bridge.send).toHaveBeenCalledWith('voice.setVolume', { session: 44, volume: 100 });
    expect(bridge.send).toHaveBeenCalledWith('voice.setLocalMute', { session: 44, muted: false });

    await user.click(screen.getByRole('button', { name: /Send Direct Message/ }));

    expect(onSelectContact).toHaveBeenCalledWith('cert-val', 'Vanilla Val');
  });

  it('updates an open Mumble user info dialog to the current active session after reconnect', async () => {
    const user = userEvent.setup();
    localStorage.setItem('volume_55', '80');
    const { rerender } = renderList();

    const mumbleButton = screen.getAllByRole('button', { name: /Vanilla Val/ })[1];
    fireEvent.contextMenu(mumbleButton);
    await user.click(screen.getByRole('button', { name: 'User Information' }));

    expect(bridge.send).toHaveBeenCalledWith('voice.setVolume', { session: 44, volume: 100 });

    rerender(
      <DMContactList
        contacts={[matrixContact, { ...mumbleContact, mumbleSessionId: 55 }]}
        selectedUserId={null}
        onSelectContact={vi.fn()}
        onCloseConversation={vi.fn()}
        onToggleVisibility={vi.fn()}
        visible={true}
      />,
    );

    expect(bridge.send).toHaveBeenCalledWith('voice.setVolume', { session: 55, volume: 80 });
    expect(bridge.send).toHaveBeenCalledWith('voice.setLocalMute', { session: 55, muted: false });
  });

  it('opens user info for an online Matrix route with the real Mumble session and selects the Matrix route from the real dialog', async () => {
    const user = userEvent.setup();
    const { onSelectContact } = renderList([matrixContact]);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Vanilla Val/ }));
    await user.click(screen.getByRole('button', { name: 'User Information' }));

    expect(bridge.send).toHaveBeenCalledWith('voice.setVolume', { session: 33, volume: 100 });
    expect(bridge.send).toHaveBeenCalledWith('voice.setLocalMute', { session: 33, muted: false });

    await user.click(screen.getByRole('button', { name: /Send Direct Message/ }));

    expect(onSelectContact).toHaveBeenCalledWith('@val:example.com', 'Vanilla Val');
  });

  it('disables user info for an offline Matrix directory contact', () => {
    renderList([offlineMatrixContact]);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Offline Olive/ }));

    expect(screen.getByRole('button', { name: 'User Information' })).toBeDisabled();
  });

  it('disables user info for an offline Mumble route', () => {
    renderList([{ ...mumbleContact, mumbleSessionId: null }]);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Vanilla Val/ }));

    expect(screen.getByRole('button', { name: 'User Information' })).toBeDisabled();
  });
});
