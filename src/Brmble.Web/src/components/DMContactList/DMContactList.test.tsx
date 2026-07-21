import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
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

function renderList(
  contacts: DMContact[] = [matrixContact, mumbleContact],
  options: Partial<{
    visible: boolean;
    onToggleVisibility: () => void;
    selectedUserId: string | null;
  }> = {},
) {
  const onSelectContact = vi.fn();
  const onCloseConversation = vi.fn();
  const onToggleVisibility = options.onToggleVisibility ?? vi.fn();

  const view = render(
    <DMContactList
      contacts={contacts}
      selectedUserId={options.selectedUserId ?? null}
      onSelectContact={onSelectContact}
      onCloseConversation={onCloseConversation}
      onToggleVisibility={onToggleVisibility}
      visible={options.visible ?? true}
    />,
  );

  return { ...view, onSelectContact, onCloseConversation, onToggleVisibility };
}

function VisibilityHarness({
  contacts = [matrixContact],
  selectedUserId = matrixContact.id,
  onSelectContact = vi.fn(),
  onCloseConversation = vi.fn(),
  withExternalCollapseControl = false,
}: Partial<{
  contacts: DMContact[];
  selectedUserId: string | null;
  onSelectContact: (id: string, displayName: string) => void;
  onCloseConversation: (id: string) => void;
  withExternalCollapseControl: boolean;
}>) {
  const [visible, setVisible] = useState(true);

  return (
    <>
      {withExternalCollapseControl && (
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setVisible(false)}>
          Collapse externally
        </button>
      )}
      <DMContactList
        contacts={contacts}
        selectedUserId={selectedUserId}
        onSelectContact={onSelectContact}
        onCloseConversation={onCloseConversation}
        onToggleVisibility={() => setVisible((current) => !current)}
        visible={visible}
      />
    </>
  );
}

describe('DMContactList directory behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('volume_44', '100');
    localStorage.setItem('volume_33', '100');
  });

  it('expands the persistent Messages rail with Enter and restores the preserved search state', async () => {
    const user = userEvent.setup();
    render(<VisibilityHarness contacts={[matrixContact, mumbleContact]} />);

    const search = screen.getByPlaceholderText('Search users...');
    await user.type(search, 'val');
    await user.click(screen.getByRole('button', { name: 'Collapse Messages panel' }));

    const expand = screen.getByRole('button', { name: 'Expand Messages panel' });
    expect(expand.querySelector('polyline')).toHaveAttribute('points', '18 6 12 12 18 18');
    expand.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Collapse Messages panel' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search users...')).toHaveValue('val');
    expect(screen.getAllByText('Vanilla Val')).toHaveLength(2);
  });

  it('collapses the Messages panel with Space and updates the rail state', async () => {
    const user = userEvent.setup();
    render(<VisibilityHarness />);

    const collapse = screen.getByRole('button', { name: 'Collapse Messages panel' });
    expect(collapse.querySelector('polyline')).toHaveAttribute('points', '6 6 12 12 6 18');
    collapse.focus();
    await user.keyboard(' ');

    const expand = screen.getByRole('button', { name: 'Expand Messages panel' });
    expect(expand.querySelector('polyline')).toHaveAttribute('points', '18 6 12 12 18 18');
    expect(screen.getByPlaceholderText('Search users...').closest('.dm-contact-list-content')).toHaveAttribute('aria-hidden', 'true');
  });

  it('moves focus to the rail control when a focused contact collapses through a state transition', async () => {
    const user = userEvent.setup();
    render(<VisibilityHarness withExternalCollapseControl />);

    const contact = screen.getByRole('button', { name: /Vanilla Val/ });
    contact.focus();
    await user.click(screen.getByRole('button', { name: 'Collapse externally' }));

    expect(screen.getByRole('button', { name: 'Expand Messages panel' })).toHaveFocus();
  });

  it('hides contact unread badges when collapsed without adding a separate rail badge', async () => {
    const user = userEvent.setup();
    render(<VisibilityHarness contacts={[matrixContact, mumbleContact]} />);

    expect(screen.getAllByText('2')).toHaveLength(1);
    expect(screen.getAllByText('1')).toHaveLength(1);
    expect(screen.queryByLabelText('3 unread messages')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse Messages panel' }));

    expect(screen.queryByLabelText('3 unread messages')).not.toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('settles on the expanded state after rapid repeated rail toggles', async () => {
    const user = userEvent.setup();
    render(<VisibilityHarness />);

    const collapse = screen.getByRole('button', { name: 'Collapse Messages panel' });
    await user.dblClick(collapse);

    expect(screen.getByRole('button', { name: 'Collapse Messages panel' })).toBeInTheDocument();
  });

  it('closes a contact context menu when the panel collapses without selection or close side effects', async () => {
    const user = userEvent.setup();
    const onSelectContact = vi.fn();
    const onCloseConversation = vi.fn();
    render(<VisibilityHarness onSelectContact={onSelectContact} onCloseConversation={onCloseConversation} />);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Vanilla Val/ }));
    expect(screen.getByRole('button', { name: 'Send Direct Message' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse Messages panel' }));

    expect(screen.queryByRole('button', { name: 'Send Direct Message' })).not.toBeInTheDocument();
    expect(onSelectContact).not.toHaveBeenCalled();
    expect(onCloseConversation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Vanilla Val/, hidden: true })).toHaveClass('active');
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
