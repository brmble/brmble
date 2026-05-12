import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ShareInfo } from '../../hooks/useScreenShare';
import type { ServiceStatusMap } from '../../types';

const { bridgeMock, usePermissionsMock, useServiceStatusMock, useResizableMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
  },
  usePermissionsMock: vi.fn(() => ({
    hasPermission: vi.fn((_channelId: number, _permission: number) => false),
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
    } as ServiceStatusMap,
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

  it('shows server reconnect state through service dots', () => {
    useServiceStatusMock.mockReturnValue({
      statuses: {
        voice: { state: 'connected' },
        chat: { state: 'connected' },
        server: { state: 'connecting', error: 'Session reconnecting: connection-lost' },
        livekit: { state: 'disconnected', error: 'token-request-failed' },
      },
    });

    renderSidebar();

    expect(screen.getByLabelText(/Brmble: Connecting/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Screenshare: Disconnected/i)).toBeInTheDocument();
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

describe('Sidebar root user idle (moon) icon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render moon when voiceIdle is below threshold', () => {
    renderSidebar({
      users: [{ session: 7, name: 'Bob', channelId: 0 }],
      voiceIdle: { 7: 599 },
    });
    const row = screen.getByText('Bob').closest('.root-user-row');
    expect(row?.querySelector('[data-icon="moon"]')).toBeNull();
  });

  it('renders moon icon when voiceIdle exceeds threshold', () => {
    renderSidebar({
      users: [{ session: 7, name: 'Bob', channelId: 0 }],
      voiceIdle: { 7: 700 },
    });
    const row = screen.getByText('Bob').closest('.root-user-row');
    expect(row?.querySelector('.user-status-area [data-icon="moon"]')).not.toBeNull();
  });
});

describe('Sidebar root move drop targets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn((channelId: number, permission: number) => channelId === 0 && permission === 0x20),
      Permission: {
        Kick: 0x10000,
        Ban: 0x20000,
        MuteDeafen: 0x10,
        Move: 0x20,
        MakeChannel: 0x40,
        Write: 0x1,
      },
      requestPermissions: vi.fn(),
    });
  });

  const dragPayload = (session: string) => ({
    dataTransfer: {
      getData: vi.fn((type: string) => type === 'text/plain' ? session : ''),
      setData: vi.fn(),
      effectAllowed: 'move',
    },
  });

  it('moves a dragged user to root when dropped on the server info panel', () => {
    renderSidebar({
      channels: [
        { id: 0, name: 'Connected', parent: 0 },
        { id: 1, name: 'General' },
      ],
      users: [{ session: 7, name: 'Alice', channelId: 1 }],
      serverLabel: 'Test Server',
    });

    const panel = screen.getByText('Test Server').closest('.server-info-panel')!;
    const event = dragPayload('7');
    fireEvent.dragOver(panel, event);
    fireEvent.drop(panel, event);

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.move', { session: 7, channelId: 0 });
  });

  it('moves a dragged user to root when dropped on the Connected users panel', () => {
    renderSidebar({
      channels: [
        { id: 0, name: 'Connected', parent: 0 },
        { id: 1, name: 'General' },
      ],
      users: [
        { session: 7, name: 'Alice', channelId: 1 },
        { session: 8, name: 'RootUser', channelId: 0 },
      ],
      serverLabel: 'Test Server',
    });

    const panel = screen.getByText('RootUser').closest('.root-users-panel')!;
    const event = dragPayload('7');
    fireEvent.dragOver(panel, event);
    fireEvent.drop(panel, event);

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.move', { session: 7, channelId: 0 });
  });
});
