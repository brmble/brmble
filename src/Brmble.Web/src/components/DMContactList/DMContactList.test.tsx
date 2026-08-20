import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const dmContactListCss = readFileSync(
  join(process.cwd(), 'src', 'components', 'DMContactList', 'DMContactList.css'),
  'utf8',
);

function renderList(
  contacts: DMContact[] = [matrixContact, mumbleContact],
  options: Partial<{
    selectedUserId: string | null;
  }> = {},
) {
  const onSelectContact = vi.fn();
  const onCloseConversation = vi.fn();

  const view = render(
    <DMContactList
      contacts={contacts}
      selectedUserId={options.selectedUserId ?? null}
      onSelectContact={onSelectContact}
      onCloseConversation={onCloseConversation}
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

  it('collapses Brmble users without conversations into an Others section by default', () => {
    renderList([matrixContact, offlineMatrixContact, mumbleContact]);

    const othersToggle = screen.getByRole('button', { name: 'Others' });

    expect(othersToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('persistent preview')).toBeInTheDocument();
    expect(screen.queryByText('Offline Olive')).not.toBeInTheDocument();
    expect(screen.getByText('Mumble users')).toBeInTheDocument();
  });

  it('persists the expanded Others state after the section is toggled open', async () => {
    const user = userEvent.setup();
    const { unmount } = renderList([matrixContact, offlineMatrixContact]);

    await user.click(screen.getByRole('button', { name: 'Others' }));

    expect(screen.getByRole('button', { name: 'Others' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Offline Olive')).toBeInTheDocument();
    expect(localStorage.getItem('dm-others-expanded')).toBe('true');

    unmount();
    renderList([matrixContact, offlineMatrixContact]);

    expect(screen.getByRole('button', { name: 'Others' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Offline Olive')).toBeInTheDocument();
  });

  it('expands Others during search and returns to the saved collapsed state when search clears', async () => {
    const user = userEvent.setup();
    localStorage.setItem('dm-others-expanded', 'false');
    renderList([matrixContact, offlineMatrixContact]);

    await user.type(screen.getByPlaceholderText('Search users...'), 'olive');

    expect(screen.getByRole('button', { name: 'Others' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Offline Olive')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search users...'));

    expect(screen.getByRole('button', { name: 'Others' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Offline Olive')).not.toBeInTheDocument();
  });

  it('hides the Others header during search when no Others contacts match', async () => {
    const user = userEvent.setup();
    renderList([matrixContact, offlineMatrixContact]);

    await user.type(screen.getByPlaceholderText('Search users...'), 'vanilla');

    expect(screen.queryByRole('button', { name: 'Others' })).not.toBeInTheDocument();
    expect(screen.getByText('Vanilla Val')).toBeInTheDocument();
    expect(screen.queryByText('Offline Olive')).not.toBeInTheDocument();
  });

  it('does not render the Others section when every Brmble user has a conversation', () => {
    renderList([matrixContact, mumbleContact]);

    expect(screen.queryByRole('button', { name: 'Others' })).not.toBeInTheDocument();
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

  it('disables user info for an offline Matrix directory contact', async () => {
    const user = userEvent.setup();
    renderList([offlineMatrixContact]);

    await user.click(screen.getByRole('button', { name: 'Others' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: /Offline Olive/ }));

    expect(screen.getByRole('button', { name: 'User Information' })).toBeDisabled();
  });

  it('renders without a visibility toggle', () => {
    renderList();

    expect(screen.queryByRole('button', { name: /Collapse Messages panel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Expand Messages panel/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeInTheDocument();
  });

  it('always shows unread counts', () => {
    renderList([{ id: 'a', displayName: 'Alice', unreadCount: 4, lastMessageTime: 1000 }]);

    expect(screen.getByText('4')).toBeInTheDocument();
  });

  // The plan's third case set a `--force-narrow` custom property and re-asserted the
  // badge. jsdom does not evaluate media queries against imported stylesheets, so that
  // assertion is identical to the one above and proves nothing about the rail. The rail
  // is presentation-only, so its contract is asserted against the stylesheet source and
  // its rendered appearance is covered by the Task 20 manual checklist.
  it('keeps unread counts out of the narrow rail collapse rules', () => {
    expect(dmContactListCss).toContain('@media (max-width: 60rem)');
    expect(dmContactListCss).toContain('width: var(--dm-rail-width);');
    expect(dmContactListCss).not.toMatch(/\.dm-contact-unread\s*{[^}]*display:\s*none/);
  });

  // UI_GUIDE forbids `aria-label` on an element that also carries a visible unread badge
  // (it would replace the whole accessible name and silence the count), and forbids
  // `display: none` for text that must reach assistive technology. The rail therefore
  // visually hides `.dm-contact-name` with the `.sr-only` technique instead of removing it.
  it('keeps a rail-proof accessible name alongside the unread badge', () => {
    renderList([matrixContact]);

    const entry = screen.getByRole('button', { name: /Vanilla Val/ });
    expect(entry).toHaveAccessibleName(/2/);
    expect(dmContactListCss).not.toMatch(/\.dm-contact-name,/);
    expect(dmContactListCss).toContain('clip-path: inset(50%);');
  });

  it('disables user info for an offline Mumble route', () => {
    renderList([{ ...mumbleContact, mumbleSessionId: null }]);

    fireEvent.contextMenu(screen.getByRole('button', { name: /Vanilla Val/ }));

    expect(screen.getByRole('button', { name: 'User Information' })).toBeDisabled();
  });
});
