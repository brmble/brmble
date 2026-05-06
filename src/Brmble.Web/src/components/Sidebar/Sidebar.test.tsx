import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ShareInfo } from '../../hooks/useScreenShare';

const { bridgeMock, usePermissionsMock, useServiceStatusMock, useResizableMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
  },
  usePermissionsMock: vi.fn(() => ({
    hasPermission: vi.fn(() => false),
    Permission: {
      Kick: 0x10000,
      Ban: 0x20000,
      MuteDeafen: 0x10,
      Move: 0x20,
      MakeChannel: 0x40,
      Write: 0x1,
    },
    requestPermissions: vi.fn(),
  })),
  useServiceStatusMock: vi.fn(() => ({
    statuses: {
      voice: { state: 'idle' },
      chat: { state: 'idle' },
      server: { state: 'idle' },
      livekit: { state: 'idle' },
    },
  })),
  useResizableMock: vi.fn(() => ({
    width: 340,
    isDragging: false,
    handleProps: {
      ref: null,
      onPointerDown: vi.fn(),
      onDoubleClick: vi.fn(),
    },
  })),
}));

vi.mock('./ChannelTree', () => ({
  ChannelTree: () => <div data-testid="channel-tree" />,
}));

vi.mock('../ContextMenu/ContextMenu', () => ({
  ContextMenu: () => null,
}));

vi.mock('../UserInfoDialog/UserInfoDialog', () => ({
  UserInfoDialog: () => null,
}));

vi.mock('../UserTooltip/UserTooltip', () => ({
  UserTooltip: ({ children }: { children: unknown }) => <>{children}</>,
}));

vi.mock('../Tooltip/Tooltip', () => ({
  Tooltip: ({ children }: { children: unknown }) => <>{children}</>,
}));

vi.mock('../Avatar/Avatar', () => ({
  default: ({ user }: { user: { name: string } }) => <div data-testid={`avatar-${user.name}`} />,
}));

vi.mock('../Icon/Icon', () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => (
    <span data-icon={name} className={className} />
  ),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('../../hooks/useServiceStatus', () => ({
  useServiceStatus: () => useServiceStatusMock(),
}));

vi.mock('../../hooks/useResizable', () => ({
  useResizable: () => useResizableMock(),
}));

vi.mock('../../contexts/ProfileContext', () => ({
  useProfileFingerprint: () => 'fingerprint',
}));

vi.mock('../../hooks/usePrompt', () => ({
  prompt: vi.fn(),
}));

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

const channels = [{ id: 0, name: 'Connected', parent: 0 }];

const makeShare = (overrides: Partial<ShareInfo> = {}): ShareInfo => ({
  roomName: 'channel-0',
  userName: 'Alice',
  userId: 42,
  matrixUserId: '@alice:example.com',
  sessionId: 2,
  ...overrides,
});

function renderSidebar(props: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      channels={channels}
      users={[]}
      connectionStatus="connected"
      onJoinChannel={vi.fn()}
      onSelectChannel={vi.fn()}
      {...props}
    />
  );
}

describe('Sidebar root user screen share behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows local sharing without watch controls or watch actions', () => {
    const onWatchScreenShare = vi.fn();

    renderSidebar({
      users: [
        { session: 1, name: 'Me', channelId: 0, self: true },
      ],
      onWatchScreenShare,
      sharingUserSession: 1,
    });

    const row = screen.getByText('Me').closest('.root-user-row');
    expect(row).not.toBeNull();

    fireEvent.doubleClick(row!);

    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(screen.queryByLabelText('Watch screen share from Me')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Watching screen share from Me')).not.toBeInTheDocument();
    expect(row?.querySelector('.user-status-area [data-icon="monitor"]')).toBeNull();
    expect(row?.querySelector('.sharing-indicator [data-icon="monitor"]')).not.toBeNull();
    expect(onWatchScreenShare).not.toHaveBeenCalled();
  });

  it('does not expose watch behavior when self also appears in active shares', () => {
    const onWatchScreenShare = vi.fn();
    const selfShare = makeShare({
      userName: 'Me',
      userId: 1,
      sessionId: 1,
      matrixUserId: '@me:example.com',
    });

    renderSidebar({
      users: [
        { session: 1, name: 'Me', channelId: 0, self: true, matrixUserId: '@me:example.com' },
      ],
      onWatchScreenShare,
      sharingUserSession: 1,
      activeShares: [selfShare],
      watchingShares: [selfShare],
    });

    const row = screen.getByText('Me').closest('.root-user-row');
    expect(row).not.toBeNull();

    fireEvent.doubleClick(row!);

    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(screen.queryByLabelText('Watch screen share from Me')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Watching screen share from Me')).not.toBeInTheDocument();
    expect(row?.querySelector('.user-status-icon-btn')).toBeNull();
    expect(row?.querySelector('.user-status-icon--watching')).toBeNull();
    expect(onWatchScreenShare).not.toHaveBeenCalled();
  });

  it('shows root share badges as presence-only and does not start watching from root', () => {
    const onWatchScreenShare = vi.fn();
    const share = makeShare({ roomName: 'channel-1' });

    renderSidebar({
      users: [
        { session: 2, name: 'Alice', channelId: 0, matrixUserId: '@alice:example.com' },
      ],
      onWatchScreenShare,
      activeShares: [share],
    });

    const row = screen.getByText('Alice').closest('.root-user-row');
    expect(row).not.toBeNull();

    fireEvent.doubleClick(row!);

    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(screen.queryByLabelText('Watch screen share from Alice')).not.toBeInTheDocument();
    expect(row?.querySelector('.sharing-indicator [data-icon="monitor"]')).not.toBeNull();
    expect(onWatchScreenShare).not.toHaveBeenCalled();
  });

  it('stops watching a remote root user share when the watched control is clicked', () => {
    const onWatchScreenShare = vi.fn();
    const onStopWatching = vi.fn();
    const share = makeShare();

    renderSidebar({
      users: [
        { session: 2, name: 'Alice', channelId: 0, matrixUserId: '@alice:example.com' },
      ],
      onWatchScreenShare,
      onStopWatching,
      activeShares: [share],
      watchingShares: [share],
    });

    fireEvent.click(screen.getByLabelText('Watching screen share from Alice'));

    expect(onStopWatching).toHaveBeenCalledWith(42);
    expect(onWatchScreenShare).not.toHaveBeenCalled();
  });

  it('renders the Sharing text before the monitor icon', () => {
    const share = makeShare();

    renderSidebar({
      users: [
        { session: 2, name: 'Alice', channelId: 0, matrixUserId: '@alice:example.com' },
      ],
      activeShares: [share],
    });

    const indicator = screen.getByText('Sharing').closest('.sharing-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator?.firstElementChild).toHaveTextContent('Sharing');
  });
});
