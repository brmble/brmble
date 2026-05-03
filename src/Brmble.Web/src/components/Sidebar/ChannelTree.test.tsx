import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChannelTree } from './ChannelTree';
import type { ShareInfo } from '../../hooks/useScreenShare';

const { bridgeMock, usePermissionsMock } = vi.hoisted(() => ({
  bridgeMock: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
  },
  usePermissionsMock: vi.fn(() => ({
    hasPermission: vi.fn(() => false),
    Permission: {
      Move: 0x20,
      MakeChannel: 0x40,
      Write: 0x1,
      Kick: 0x10000,
      Ban: 0x20000,
      MuteDeafen: 0x10,
    },
    requestPermissions: vi.fn(),
  })),
}));

vi.mock('../ContextMenu/ContextMenu', () => ({
  ContextMenu: ({ items }: { items: Array<{ label?: string; type: string }> }) => (
    <div data-testid="context-menu">
      {items.map((item, index) =>
        item.type === 'item' ? <button key={`${item.label}-${index}`}>{item.label}</button> : <hr key={`divider-${index}`} />
      )}
    </div>
  ),
}));

vi.mock('../UserInfoDialog/UserInfoDialog', () => ({
  UserInfoDialog: () => null,
}));

vi.mock('../Tooltip/Tooltip', () => ({
  Tooltip: ({ children }: { children: unknown }) => <>{children}</>,
}));

vi.mock('../UserTooltip/UserTooltip', () => ({
  UserTooltip: ({ children }: { children: unknown }) => <>{children}</>,
}));

vi.mock('../EditChannelDialog/EditChannelDialog', () => ({
  EditChannelDialog: () => null,
}));

vi.mock('../RenameConfirmDialog/RenameConfirmDialog', () => ({
  RenameConfirmDialog: () => null,
}));

vi.mock('../Avatar/Avatar', () => ({
  default: ({ user }: { user: { name: string } }) => <div data-testid={`avatar-${user.name}`} />,
}));

vi.mock('../Icon/Icon', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <span data-icon={name} className={className} />
  ),
}));

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

vi.mock('../../hooks/usePrompt', () => ({
  prompt: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

const channels = [{ id: 1, name: 'General' }];

const makeShare = (overrides: Partial<ShareInfo> = {}): ShareInfo => ({
  roomName: 'channel-1',
  userName: 'Alice',
  userId: 42,
  matrixUserId: '@alice:example.com',
  sessionId: 2,
  ...overrides,
});

describe('ChannelTree screen share behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows local sharing without watch controls or watch actions', () => {
    const onWatchScreenShare = vi.fn();

    render(
      <ChannelTree
        channels={channels}
        users={[
          { session: 1, name: 'Me', channelId: 1, self: true },
        ]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        onWatchScreenShare={onWatchScreenShare}
        sharingUserSession={1}
      />
    );

    const row = screen.getByText('Me').closest('.user-row');
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row!);

    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(screen.queryByLabelText('Watch screen share from Me')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Watching screen share from Me')).not.toBeInTheDocument();
    expect(row?.querySelector('.user-status-area [data-icon="monitor"]')).toBeNull();
    expect(row?.querySelector('.sharing-indicator [data-icon="monitor"]')).not.toBeNull();
    expect(onWatchScreenShare).not.toHaveBeenCalled();
  });

  it('does not expose remote watch behavior when self also appears in active shares', () => {
    const onWatchScreenShare = vi.fn();
    const selfShare = makeShare({
      userName: 'Me',
      userId: 1,
      sessionId: 1,
      matrixUserId: '@me:example.com',
    });

    render(
      <ChannelTree
        channels={channels}
        users={[
          { session: 1, name: 'Me', channelId: 1, self: true, matrixUserId: '@me:example.com' },
        ]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        onWatchScreenShare={onWatchScreenShare}
        sharingUserSession={1}
        activeShares={[selfShare]}
        watchingShares={[selfShare]}
      />
    );

    const row = screen.getByText('Me').closest('.user-row');
    expect(row).not.toBeNull();

    fireEvent.doubleClick(row!);
    fireEvent.contextMenu(row!);

    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(screen.queryByLabelText('Watch screen share from Me')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Watching screen share from Me')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch Stream')).not.toBeInTheDocument();
    expect(row?.querySelector('.user-status-icon-btn')).toBeNull();
    expect(row?.querySelector('.user-status-icon--watching')).toBeNull();
    expect(onWatchScreenShare).not.toHaveBeenCalled();
  });

  it('keeps remote watch behavior and leaves mute and deafen in the status area', () => {
    const onWatchScreenShare = vi.fn();
    const share = makeShare();

    render(
      <ChannelTree
        channels={channels}
        users={[
          { session: 2, name: 'Alice', channelId: 1, muted: true, deafened: true, matrixUserId: '@alice:example.com' },
        ]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        onWatchScreenShare={onWatchScreenShare}
        activeShares={[share]}
      />
    );

    const row = screen.getByText('Alice').closest('.user-row');
    expect(row).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Watch screen share from Alice'));

    expect(onWatchScreenShare).toHaveBeenCalledWith('channel-1', 42, '@alice:example.com');
    expect(row?.querySelector('.user-status-area [data-icon="monitor"]')).toBeNull();
    expect(row?.querySelector('.sharing-indicator [data-icon="monitor"]')).not.toBeNull();
    expect(row?.querySelector('.user-status-area .user-status-icon--muted')).not.toBeNull();
    expect(row?.querySelector('.user-status-area .user-status-icon--deaf')).not.toBeNull();
  });

  it('still lets remote watched shares unwatch', () => {
    const onStopWatching = vi.fn();
    const share = makeShare();

    render(
      <ChannelTree
        channels={channels}
        users={[
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        onStopWatching={onStopWatching}
        activeShares={[share]}
        watchingShares={[share]}
      />
    );

    fireEvent.click(screen.getByLabelText('Watching screen share from Alice'));

    expect(onStopWatching).toHaveBeenCalledWith(42);
  });

  it('renders the Sharing text before the monitor icon', () => {
    const share = makeShare();

    render(
      <ChannelTree
        channels={channels}
        users={[
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        activeShares={[share]}
      />
    );

    const indicator = screen.getByText('Sharing').closest('.sharing-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator?.firstElementChild).toHaveTextContent('Sharing');
  });
});

describe('ChannelTree idle (moon) icon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render moon when voiceIdle is missing for the user', () => {
    render(
      <ChannelTree
        channels={channels}
        users={[{ session: 7, name: 'Bob', channelId: 1 }]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        voiceIdle={{}}
      />
    );
    const row = screen.getByText('Bob').closest('.user-row');
    expect(row?.querySelector('[data-icon="moon"]')).toBeNull();
  });

  it('does not render moon when voiceIdle is below threshold', () => {
    render(
      <ChannelTree
        channels={channels}
        users={[{ session: 7, name: 'Bob', channelId: 1 }]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        voiceIdle={{ 7: 599 }}
      />
    );
    const row = screen.getByText('Bob').closest('.user-row');
    expect(row?.querySelector('[data-icon="moon"]')).toBeNull();
  });

  it('renders moon icon when voiceIdle exceeds threshold', () => {
    render(
      <ChannelTree
        channels={channels}
        users={[{ session: 7, name: 'Bob', channelId: 1 }]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        voiceIdle={{ 7: 700 }}
      />
    );
    const row = screen.getByText('Bob').closest('.user-row');
    expect(row?.querySelector('.user-status-area [data-icon="moon"]')).not.toBeNull();
  });
});
