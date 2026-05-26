import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ChannelTree } from './ChannelTree';
import type { ShareInfo } from '../../hooks/useScreenShare';

const { bridgeMock, usePermissionsMock, editChannelDialogPropsRef, aclEditorDialogPropsRef, promptMock } = vi.hoisted(() => ({
  bridgeMock: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    once: vi.fn(),
  },
  usePermissionsMock: vi.fn(() => ({
    hasPermission: vi.fn((_channelId: number, _permission: number) => false),
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
  editChannelDialogPropsRef: { current: null as null | Record<string, unknown> },
  aclEditorDialogPropsRef: { current: null as null | Record<string, unknown> },
  promptMock: vi.fn(),
}));

vi.mock('../ContextMenu/ContextMenu', () => ({
  ContextMenu: ({ items }: { items: Array<{ label?: string; type: string; onClick?: () => void }> }) => (
    <div data-testid="context-menu">
      {items.map((item, index) =>
        item.type === 'item' ? <button key={`${item.label}-${index}`} onClick={item.onClick}>{item.label}</button> : <hr key={`divider-${index}`} />
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
  EditChannelDialog: (props: Record<string, unknown>) => {
    editChannelDialogPropsRef.current = props;
    return (
      <div>
        <button onClick={() => (props.onSave as (name: string, description: string, password: string) => void)('Secret', '', String(props.initialPassword ?? ''))}>
          Save Edit Channel
        </button>
      </div>
    );
  },
}));

vi.mock('../RenameConfirmDialog/RenameConfirmDialog', () => ({
  RenameConfirmDialog: () => null,
}));

vi.mock('../AclEditor/AclEditorDialog', () => ({
  AclEditorDialog: (props: Record<string, unknown>) => {
    aclEditorDialogPropsRef.current = props;
    return null;
  },
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
  prompt: promptMock,
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

  it('sorts sibling channels by Mumble position, then name, then id', () => {
    render(
      <ChannelTree
        channels={[
          { id: 4, name: 'Zulu', position: 5 },
          { id: 2, name: 'Bravo', position: 1 },
          { id: 3, name: 'Alpha', position: 1 },
          { id: 5, name: 'Alpha', position: 1 },
        ]}
        users={[]}
        onJoinChannel={vi.fn()}
      />
    );

    const labels = Array.from(document.querySelectorAll('.channel-name')).map(el => el.textContent);

    expect(labels).toEqual(['Alpha', 'Alpha', 'Bravo', 'Zulu']);
    expect(screen.getAllByText('Alpha')[0].closest('.channel-item')).toHaveAttribute('data-channel-id', '3');
  });

  it('shows channel sharing indicators for every active share room', () => {
    render(
      <ChannelTree
        channels={[
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ]}
        users={[]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        activeShares={[
          makeShare({ roomName: 'channel-1', userId: 10, userName: 'Alice' }),
          makeShare({ roomName: 'channel-2', userId: 20, userName: 'Bob' }),
        ]}
      />
    );

    const generalRow = screen.getByText('General').closest('.channel-row');
    const gamingRow = screen.getByText('Gaming').closest('.channel-row');

    expect(generalRow?.querySelector('.channel-icon [data-icon="monitor"]')).not.toBeNull();
    expect(gamingRow?.querySelector('.channel-icon [data-icon="monitor"]')).not.toBeNull();
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

describe('ChannelTree channel access locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no lock for unrestricted channels', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Open' }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Open').closest('.channel-row');
    expect(row?.querySelector('[data-icon="lock"]')).toBeNull();
    expect(row?.querySelector('[data-icon="unlock"]')).toBeNull();
  });

  it('renders an open lock for restricted channels the user can enter', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Allowed', isEnterRestricted: true, canEnter: true }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Allowed').closest('.channel-row');
    expect(row?.querySelector('[data-icon="unlock"]')).not.toBeNull();
    expect(row?.querySelector('[data-icon="lock"]')).toBeNull();
    expect(row?.querySelector('.channel-access-icon--blocked')).toBeNull();
  });

  it('renders a closed lock for restricted channels the user cannot enter', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Secret', isEnterRestricted: true, canEnter: false }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Secret').closest('.channel-row');
    expect(row?.querySelector('.channel-access-icon--blocked [data-icon="lock"]')).not.toBeNull();
  });

  it('renders a key icon for password-restricted channels even when enter metadata is missing', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Secret', hasPasswordRestriction: true }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Secret').closest('.channel-row');
    expect(row?.querySelector('.channel-access-icon--blocked [data-icon="key-round"]')).not.toBeNull();
  });

  it('does not highlight password icon when the user can enter', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Secret', hasPasswordRestriction: true, canEnter: true }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Secret').closest('.channel-row');
    expect(row?.querySelector('[data-icon="key-round"]')).not.toBeNull();
    expect(row?.querySelector('.channel-access-icon--blocked')).toBeNull();
  });

  it('renders channel access icons as the rightmost channel name sidebar icons', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Secret', isEnterRestricted: true, canEnter: false }]} users={[{ session: 1, name: 'Alice', channelId: 1 }]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Secret').closest('.channel-row');
    const accessIcon = row?.querySelector('.channel-access-icon');
    expect(accessIcon).not.toBeNull();
    expect(accessIcon?.nextElementSibling).toBeNull();
  });
});

describe('ChannelTree ACL integration', () => {
  const bridgeHandlers = new Map<string, (data: unknown) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    bridgeHandlers.clear();
    editChannelDialogPropsRef.current = null;
    aclEditorDialogPropsRef.current = null;
    promptMock.mockReset();
    bridgeMock.on.mockImplementation((type: string, handler: (data: unknown) => void) => {
      bridgeHandlers.set(type, handler);
    });
    bridgeMock.send.mockImplementation((type: string, payload?: unknown) => {
      if (type === 'voice.getChannelPassword') {
        const request = payload as { channelId?: number; requestId?: string };
        bridgeHandlers.get('voice.channelPassword')?.({
          requestId: request.requestId,
          channelId: request.channelId,
          password: '',
        });
      }
    });
  });

  it('shows Edit Permissions for editable channel context menu', () => {
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn((channelId: number, permission: number) => channelId === 5 && permission === 0x01),
      Permission: { Write: 0x01, MakeChannel: 0x40, Move: 0x20, Kick: 0x10000, Ban: 0x20000, MuteDeafen: 0x10 },
      requestPermissions: vi.fn(),
    });

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0 }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );
    fireEvent.contextMenu(screen.getByText('Secret'));

    expect(screen.getByText('Edit Permissions')).toBeInTheDocument();
  });

  it('opens Edit Permissions without showing a debug alert', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn((channelId: number, permission: number) => channelId === 5 && permission === 0x01),
      Permission: { Write: 0x01, MakeChannel: 0x40, Move: 0x20, Kick: 0x10000, Ban: 0x20000, MuteDeafen: 0x10 },
      requestPermissions: vi.fn(),
    });

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, isEnterRestricted: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Permissions'));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(aclEditorDialogPropsRef.current).toMatchObject({
      channelId: 5,
      channelName: 'Secret',
      isNativePasswordProtected: true,
    });

    alertSpy.mockRestore();
  });

  it('loads the managed password for edit and does not rewrite it when unchanged', () => {
    const bridgeHandlers = new Map<string, (data: unknown) => void>();
    bridgeMock.on.mockImplementation((type: string, handler: (data: unknown) => void) => {
      bridgeHandlers.set(type, handler);
    });

    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn((channelId: number, permission: number) => channelId === 5 && (permission === 0x01 || permission === 0x40)),
      Permission: { Write: 0x01, MakeChannel: 0x40, Move: 0x20, Kick: 0x10000, Ban: 0x20000, MuteDeafen: 0x10 },
      requestPermissions: vi.fn(),
    });

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0 }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit'));

    expect(bridgeMock.send).toHaveBeenCalledWith('acl.getChannel', { channelId: 5 });

    act(() => {
      bridgeHandlers.get('acl.channel')?.({
        channelId: 5,
        body: JSON.stringify({
          snapshot: {
            channelId: 5,
            inheritAcls: true,
            groups: [],
            acls: [
              { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret-token', allow: 6, deny: 0 },
              { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret-token', allow: 0, deny: 0 },
            ],
            fetchedAt: '2026-05-15T12:00:00Z',
            stale: false,
            warning: null,
            snapshotHash: 'known-hash',
          },
        }),
      });
    });

    expect(editChannelDialogPropsRef.current?.initialPassword).toBe('secret-token');

    fireEvent.click(screen.getByText('Save Edit Channel'));

    expect(bridgeMock.send).not.toHaveBeenCalledWith('acl.setChannelPassword', expect.anything());
  });

  it('shows Edit Saved Password for password-protected channels without admin permission', () => {
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn(() => false),
      Permission: { Write: 0x01, MakeChannel: 0x40, Move: 0x20, Kick: 0x10000, Ban: 0x20000, MuteDeafen: 0x10 },
      requestPermissions: vi.fn(),
    });

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));

    expect(screen.getByText('Edit Saved Password')).toBeInTheDocument();
  });

  it('does not show Edit Saved Password for unrestricted channels', () => {
    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Open', parent: 0 }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Open'));

    expect(screen.queryByText('Edit Saved Password')).not.toBeInTheDocument();
  });

  it('saves a channel password through the saved-token bridge handler', async () => {
    promptMock.mockResolvedValue('new-secret');

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Saved Password'));

    await waitFor(() => expect(promptMock).toHaveBeenCalledWith({
      title: 'Saved Channel Password',
      message: 'Enter the password for Secret. Leave blank to forget the saved password. Save and reconnect to authenticate changes.',
      placeholder: 'Password',
      defaultValue: '',
      confirmLabel: 'Save & reconnect',
      cancelLabel: 'Cancel',
      isPassword: true,
    }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.saveChannelPassword', {
      channelId: 5,
      channelName: 'Secret',
      password: 'new-secret',
    });
    expect(bridgeMock.send).toHaveBeenCalledWith('voice.reconnect', { channelId: 5 });
    expect(bridgeMock.send).not.toHaveBeenCalledWith('acl.setChannelPassword', expect.anything());
  });

  it('prefills Edit Saved Password with the latest saved channel password', async () => {
    promptMock.mockResolvedValue('updated-secret');
    bridgeMock.send.mockImplementation((type: string, payload?: unknown) => {
      if (type === 'voice.getChannelPassword') {
        const request = payload as { channelId?: number; requestId?: string };
        bridgeHandlers.get('voice.channelPassword')?.({
          requestId: request.requestId,
          channelId: request.channelId,
          password: 'saved-secret',
        });
      }
    });

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Saved Password'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.getChannelPassword', {
      channelId: 5,
      requestId: expect.stringMatching(/^channel-password-5-/),
    });
    expect(promptMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Saved Channel Password',
      defaultValue: 'saved-secret',
    }));
  });

  it('removes a saved channel password when prompt is saved empty', async () => {
    promptMock.mockResolvedValue('');

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Saved Password'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.saveChannelPassword', {
      channelId: 5,
      channelName: 'Secret',
      password: '',
    });
    expect(bridgeMock.send).toHaveBeenCalledWith('voice.reconnect', { channelId: 5 });
  });

  it('does not save channel password when prompt is canceled', async () => {
    promptMock.mockResolvedValue(null);

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0, hasPasswordRestriction: true }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Edit Saved Password'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).not.toHaveBeenCalledWith('voice.saveChannelPassword', expect.anything());
  });

  it('uses the shared prompt flow before removing a channel', async () => {
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn((channelId: number, permission: number) => channelId === 5 && permission === 0x01),
      Permission: { Write: 0x01, MakeChannel: 0x40, Move: 0x20, Kick: 0x10000, Ban: 0x20000, MuteDeafen: 0x10 },
      requestPermissions: vi.fn(),
    });
    promptMock.mockResolvedValue('Remove');

    render(
      <ChannelTree
        channels={[{ id: 5, name: 'Secret', parent: 0 }]}
        users={[]}
        currentChannelId={5}
        onJoinChannel={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Secret'));
    fireEvent.click(screen.getByText('Remove'));

    expect(promptMock).toHaveBeenCalledWith({
      title: 'Remove Channel',
      message: 'Type "Remove" to confirm deleting "Secret".',
      placeholder: 'Remove',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.removeChannel', { channelId: 5 });
  });
});

describe('ChannelTree user move drag and drop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows admin drag and drop while self is in root', () => {
    const onMoveUser = vi.fn();
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn((channelId: number, permission: number) => channelId === 0 && permission === 0x20),
      Permission: {
        Move: 0x20,
        MakeChannel: 0x40,
        Write: 0x1,
        Kick: 0x10000,
        Ban: 0x20000,
        MuteDeafen: 0x10,
      },
      requestPermissions: vi.fn(),
    });

    render(
      <ChannelTree
        channels={[{ id: 1, name: 'General' }, { id: 2, name: 'Gaming' }]}
        users={[{ session: 7, name: 'Alice', channelId: 1 }]}
        currentChannelId={0}
        onJoinChannel={vi.fn()}
        onMoveUser={onMoveUser}
      />
    );

    const userRow = screen.getByText('Alice').closest('.user-row')!;
    const targetChannel = screen.getByText('Gaming').closest('.channel-row')!;
    const dragData = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: '',
      setData: vi.fn((type: string, value: string) => dragData.set(type, value)),
      getData: vi.fn((type: string) => dragData.get(type) ?? ''),
    };

    expect(userRow).toHaveAttribute('draggable', 'true');

    fireEvent.dragStart(userRow, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '7');
    fireEvent.dragOver(targetChannel, { dataTransfer });
    fireEvent.drop(targetChannel, { dataTransfer });
    expect(dataTransfer.getData).toHaveBeenCalledWith('text/plain');

    expect(onMoveUser).toHaveBeenCalledWith(7, 2);
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

describe('ChannelTree channel ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ChannelTree siblings using channel position instead of id order', () => {
    render(
      <ChannelTree
        channels={[
          { id: 0, name: 'Root', position: 0 },
          { id: 20, name: 'Raid', parent: 0, position: 0 },
          { id: 10, name: 'General', parent: 0, position: 1 },
        ]}
        users={[]}
        currentChannelId={0}
        onJoinChannel={vi.fn()}
      />,
    );

    const labels = screen.getAllByText(/Raid|General/).map(element => element.textContent);
    expect(labels).toEqual(['Raid', 'General']);
  });
});
